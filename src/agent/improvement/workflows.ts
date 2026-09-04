import { randomUUID } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  candidateEvaluationSchema,
  candidateProposalSchema,
  improvementCandidateSchema,
  improvementTraceSchema,
  type ImprovementCandidateRecord,
  type ImprovementTraceRecord,
} from "./schemas.js";
import { ImprovementRepository } from "./repository.js";

const feedbackSchema = z.object({
  value: z.union([z.number(), z.string()]),
  comment: z.string().nullable().optional(),
});

function feedbackPrompt(
  trace: ImprovementTraceRecord,
  feedback: Array<z.infer<typeof feedbackSchema>>,
): string {
  return JSON.stringify(
    {
      trace,
      feedback,
      constraints: [
        "Propose only an application operating policy, never source-file edits.",
        "Do not include secrets, credentials, personal data, or raw chain-of-thought.",
        "Keep the instruction specific, testable, and reversible.",
      ],
    },
    null,
    2,
  );
}

function evaluationPrompt(
  candidate: ImprovementCandidateRecord,
  trace: ImprovementTraceRecord,
): string {
  return JSON.stringify(
    {
      candidate,
      trace,
      gate: {
        minimumScore: 0.75,
        requirements: [
          "The policy is tied to observable feedback or outcome evidence.",
          "The policy does not direct writes, command execution, or external side effects.",
          "The policy is scoped and can be rolled back by selecting another policy version.",
          "The policy contains no credential-like data.",
        ],
      },
    },
    null,
    2,
  );
}

export type ImprovementWorkflows = {
  capture: ReturnType<typeof createWorkflow>;
  createCandidate: ReturnType<typeof createWorkflow>;
  evaluateCandidate: ReturnType<typeof createWorkflow>;
  publishCandidate: ReturnType<typeof createWorkflow>;
};

/** Builds the durable Mastra workflow graph for the controlled improvement loop. */
export function createImprovementWorkflows(args: {
  repository: ImprovementRepository;
  analyst: Agent;
  evaluator: Agent;
}): ImprovementWorkflows {
  const captureTrace = createStep({
    id: "capture-improvement-trace",
    inputSchema: improvementTraceSchema.omit({ traceId: true }),
    outputSchema: improvementTraceSchema.omit({ traceId: true }),
    execute: async ({ inputData }) => inputData,
  });

  const draftCandidate = createStep({
    id: "draft-improvement-candidate",
    inputSchema: z.object({
      candidateId: z.string().min(1).max(256),
      trace: improvementTraceSchema,
      feedback: z.array(feedbackSchema).max(100),
    }),
    outputSchema: improvementCandidateSchema,
    execute: async ({ inputData }) => {
      const generated = await args.analyst.generate(
        feedbackPrompt(inputData.trace, inputData.feedback),
        {
          activeTools: [],
          maxSteps: 1,
          structuredOutput: {
            schema: candidateProposalSchema,
            errorStrategy: "strict",
            jsonPromptInjection: "auto",
          },
        },
      );
      if (!generated.object) {
        throw new Error("Mastra candidate workflow returned no structured proposal");
      }
      const proposal = candidateProposalSchema.parse(generated.object);
      const now = Date.now();
      return {
        id: inputData.candidateId,
        traceId: inputData.trace.traceId,
        title: proposal.title,
        summary: proposal.summary,
        instruction: proposal.instruction,
        status: "draft" as const,
        createdAt: now,
        updatedAt: now,
        feedbackCount: inputData.feedback.length,
      };
    },
  });

  const validateCandidate = createStep({
    id: "evaluate-improvement-candidate",
    inputSchema: z.object({
      candidate: improvementCandidateSchema,
      trace: improvementTraceSchema,
      evaluationId: z.string().min(1).max(256),
      experimentId: z.string().min(1).max(256),
    }),
    outputSchema: improvementCandidateSchema,
    execute: async ({ inputData }) => {
      const generated = await args.evaluator.generate(
        evaluationPrompt(inputData.candidate, inputData.trace),
        {
          activeTools: [],
          maxSteps: 1,
          structuredOutput: {
            schema: candidateEvaluationSchema,
            errorStrategy: "strict",
            jsonPromptInjection: "auto",
          },
        },
      );
      if (!generated.object) {
        throw new Error("Mastra evaluation workflow returned no structured verdict");
      }
      const verdict = candidateEvaluationSchema.parse(generated.object);
      const evaluation = {
        id: inputData.evaluationId,
        score: verdict.score,
        passed: verdict.passed && verdict.score >= 0.75,
        rationale: verdict.rationale,
        checkedAt: Date.now(),
        experimentId: inputData.experimentId,
      };
      const candidate = {
        ...inputData.candidate,
        status: evaluation.passed ? ("ready" as const) : ("draft" as const),
        updatedAt: Date.now(),
        evaluation,
      };
      await args.repository.persistEvaluationEvidence({
        candidate,
        trace: inputData.trace,
        evaluation,
      });
      return candidate;
    },
  });

  const publicationApproval = createStep({
    id: "approve-improvement-publication",
    inputSchema: z.object({ candidateId: z.string().min(1).max(256) }),
    outputSchema: z.object({ candidate: improvementCandidateSchema }),
    resumeSchema: z.object({ approved: z.boolean() }),
    suspendSchema: z.object({
      candidateId: z.string(),
      title: z.string(),
      summary: z.string(),
    }),
    execute: async ({ inputData, resumeData, suspend }) => {
      const candidate = await args.repository.candidate(inputData.candidateId);
      if (!candidate) throw new Error("Improvement candidate was not found");
      if (!candidate.evaluation?.passed) {
        throw new Error("Candidate must pass its Mastra evaluation before publication");
      }
      if (!resumeData) {
        return suspend({
          candidateId: candidate.id,
          title: candidate.title,
          summary: candidate.summary,
        });
      }
      if (!resumeData.approved) {
        const rejected = {
          ...candidate,
          status: "rejected" as const,
          updatedAt: Date.now(),
        };
        await args.repository.saveCandidate(rejected);
        return { candidate: rejected };
      }

      const activeCandidateId = await args.repository.activeCandidateId();
      if (activeCandidateId && activeCandidateId !== candidate.id) {
        const prior = await args.repository.candidate(activeCandidateId);
        if (prior) {
          await args.repository.saveCandidate({
            ...prior,
            status: "replaced",
            updatedAt: Date.now(),
          });
        }
      }
      const { publicationRunId: _publicationRunId, ...publishableCandidate } = candidate;
      const published = {
        ...publishableCandidate,
        status: "published" as const,
        updatedAt: Date.now(),
        publishedAt: Date.now(),
      };
      await args.repository.saveCandidate(published);
      await args.repository.setActiveCandidate(published.id);
      return { candidate: published };
    },
  });

  return {
    capture: createWorkflow({
      id: "improvement-trace-capture",
      inputSchema: improvementTraceSchema.omit({ traceId: true }),
      outputSchema: improvementTraceSchema.omit({ traceId: true }),
    })
      .then(captureTrace)
      .commit(),
    createCandidate: createWorkflow({
      id: "improvement-candidate-draft",
      inputSchema: z.object({
        candidateId: z.string().min(1).max(256),
        trace: improvementTraceSchema,
        feedback: z.array(feedbackSchema).max(100),
      }),
      outputSchema: improvementCandidateSchema,
    })
      .then(draftCandidate)
      .commit(),
    evaluateCandidate: createWorkflow({
      id: "improvement-candidate-evaluation",
      inputSchema: z.object({
        candidate: improvementCandidateSchema,
        trace: improvementTraceSchema,
        evaluationId: z.string().min(1).max(256),
        experimentId: z.string().min(1).max(256),
      }),
      outputSchema: improvementCandidateSchema,
    })
      .then(validateCandidate)
      .commit(),
    publishCandidate: createWorkflow({
      id: "improvement-candidate-publication",
      inputSchema: z.object({ candidateId: z.string().min(1).max(256) }),
      outputSchema: z.object({ candidate: improvementCandidateSchema }),
    })
      .then(publicationApproval)
      .commit(),
  };
}

export function newWorkflowId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

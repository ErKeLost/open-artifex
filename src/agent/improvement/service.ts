import { randomUUID } from "node:crypto";
import type { Agent } from "@mastra/core/agent";
import type { Mastra } from "@mastra/core";
import type { LibSQLStore } from "@mastra/libsql";
import type {
  ImprovementCandidate,
  ImprovementSnapshot,
  ImprovementTrace,
} from "../../shared/improvement-protocol.js";
import { ImprovementRepository } from "./repository.js";
import {
  createImprovementWorkflows,
  newWorkflowId,
  type ImprovementWorkflows,
} from "./workflows.js";
import {
  improvementCandidateSchema,
  type ImprovementCandidateRecord,
  type ImprovementTraceRecord,
} from "./schemas.js";

export type CapturedRun = Omit<ImprovementTraceRecord, "traceId">;

/**
 * Application-facing control plane for the Mastra improvement loop.
 *
 * It deliberately publishes only one app-owned instruction version at a time.
 * Candidate creation, evaluation, approval, and rollback never mutate a user's
 * selected workspace or change the base agent definition automatically.
 */
export class ImprovementService {
  readonly repository: ImprovementRepository;
  readonly workflows: ImprovementWorkflows;
  private readonly getMastra: () => Mastra;

  constructor(args: {
    getMastra: () => Mastra;
    storage: LibSQLStore;
    analyst: Agent;
    evaluator: Agent;
  }) {
    this.getMastra = args.getMastra;
    this.repository = new ImprovementRepository(args.getMastra, args.storage);
    this.workflows = createImprovementWorkflows({
      repository: this.repository,
      analyst: args.analyst,
      evaluator: args.evaluator,
    });
  }

  async captureRun(trace: CapturedRun): Promise<ImprovementTrace | undefined> {
    const run = await this.workflows.capture.createRun({
      runId: newWorkflowId("improvement-capture"),
    });
    const result = await run.start({
      inputData: trace,
      tracingOptions: {
        metadata: { runId: trace.id, threadId: trace.threadId },
        tags: ["improvement", "run-capture"],
      },
    });
    if (result.status !== "success" || !result.traceId) return undefined;
    // addFeedback(traceId) resolves persisted traces by ID, so flush the
    // storage exporter before the trace becomes visible in the desktop UI.
    await this.observability().flush();
    const captured: ImprovementTraceRecord = {
      ...result.result,
      traceId: result.traceId,
    };
    await this.repository.saveTrace(captured);
    return captured;
  }

  async snapshot(): Promise<ImprovementSnapshot> {
    return this.repository.snapshot();
  }

  async addFeedback(args: {
    traceId: string;
    rating: 1 | -1;
    comment?: string;
  }): Promise<void> {
    const trace = await this.repository.findTrace(args.traceId);
    if (!trace) throw new Error("Improvement trace was not found");
    const observability = this.observability();
    const addFeedback = observability.addFeedback;
    if (!addFeedback) throw new Error("Mastra observability feedback is unavailable");
    await addFeedback.call(observability, {
      traceId: args.traceId,
      feedback: {
        feedbackSource: "user",
        feedbackType: "rating",
        value: args.rating,
        ...(args.comment ? { comment: args.comment.slice(0, 4_000) } : {}),
        metadata: { domain: "improvement" },
      },
    });
    await observability.flush();
  }

  async createCandidate(traceId: string): Promise<ImprovementCandidate> {
    const trace = await this.repository.findTrace(traceId);
    if (!trace) throw new Error("Improvement trace was not found");
    const feedback = await this.repository.feedback(traceId);
    const run = await this.workflows.createCandidate.createRun({
      runId: newWorkflowId("improvement-candidate"),
    });
    const result = await run.start({
      inputData: { candidateId: randomUUID(), trace, feedback },
      tracingOptions: { tags: ["improvement", "candidate-draft"] },
    });
    if (result.status !== "success") {
      throw workflowFailure("Candidate workflow", result.status);
    }
    await this.observability().flush();
    const candidate = improvementCandidateSchema.parse(result.result);
    await this.repository.saveCandidate(candidate);
    return candidate;
  }

  async evaluateCandidate(candidateId: string): Promise<ImprovementCandidate> {
    const candidate = await this.requiredCandidate(candidateId);
    const trace = await this.repository.findTrace(candidate.traceId);
    if (!trace) throw new Error("The source trace for this candidate is missing");
    const evaluating = {
      ...candidate,
      status: "evaluating" as const,
      updatedAt: Date.now(),
    };
    await this.repository.saveCandidate(evaluating);
    const run = await this.workflows.evaluateCandidate.createRun({
      runId: newWorkflowId("improvement-evaluation"),
    });
    const result = await run.start({
      inputData: {
        candidate: evaluating,
        trace,
        evaluationId: randomUUID(),
        experimentId: newWorkflowId("improvement-experiment"),
      },
      tracingOptions: { tags: ["improvement", "candidate-evaluation"] },
    });
    if (result.status !== "success") {
      await this.repository.saveCandidate({
        ...candidate,
        status: "draft",
        updatedAt: Date.now(),
      });
      throw workflowFailure("Evaluation workflow", result.status);
    }
    await this.observability().flush();
    const evaluated = improvementCandidateSchema.parse(result.result);
    await this.repository.saveCandidate(evaluated);
    return evaluated;
  }

  async requestPublication(candidateId: string): Promise<ImprovementCandidate> {
    const candidate = await this.requiredCandidate(candidateId);
    if (!candidate.evaluation?.passed) {
      throw new Error("Candidate must pass evaluation before it can be submitted");
    }
    if (candidate.status === "published") return candidate;
    const publicationRunId = newWorkflowId("improvement-publication");
    const awaitingApproval = {
      ...candidate,
      status: "awaiting-approval" as const,
      publicationRunId,
      updatedAt: Date.now(),
    };
    await this.repository.saveCandidate(awaitingApproval);
    const run = await this.workflows.publishCandidate.createRun({
      runId: publicationRunId,
    });
    const result = await run.start({
      inputData: { candidateId },
      tracingOptions: { tags: ["improvement", "publication-approval"] },
    });
    if (result.status !== "suspended") {
      await this.repository.saveCandidate(candidate);
      throw workflowFailure("Publication workflow", result.status);
    }
    await this.observability().flush();
    return awaitingApproval;
  }

  async resolvePublication(
    candidateId: string,
    approved: boolean,
  ): Promise<ImprovementCandidate> {
    const candidate = await this.requiredCandidate(candidateId);
    if (!candidate.publicationRunId || candidate.status !== "awaiting-approval") {
      throw new Error("Candidate is not awaiting a publication decision");
    }
    const run = await this.workflows.publishCandidate.createRun({
      runId: candidate.publicationRunId,
    });
    const result = await run.resume({ resumeData: { approved } });
    if (result.status !== "success") {
      throw workflowFailure("Publication workflow", result.status);
    }
    await this.observability().flush();
    const published = improvementCandidateSchema.parse(result.result.candidate);
    return published;
  }

  async rollback(candidateId: string): Promise<ImprovementCandidate> {
    const candidate = await this.requiredCandidate(candidateId);
    const activeCandidateId = await this.repository.activeCandidateId();
    if (activeCandidateId !== candidate.id) {
      throw new Error("Only the currently published candidate can be rolled back");
    }
    const priorId = await this.repository.previousCandidateId(candidate.id);
    const rolledBack = {
      ...candidate,
      status: "rolled-back" as const,
      updatedAt: Date.now(),
      rolledBackAt: Date.now(),
    };
    await this.repository.saveCandidate(rolledBack);
    if (!priorId) {
      await this.repository.clearActiveCandidate();
      return rolledBack;
    }
    const prior = await this.requiredCandidate(priorId);
    const restored = {
      ...prior,
      status: "published" as const,
      updatedAt: Date.now(),
      publishedAt: Date.now(),
    };
    await this.repository.saveCandidate(restored);
    await this.repository.setActiveCandidate(restored.id);
    return rolledBack;
  }

  private observability() {
    const observability = this.getMastra().observability;
    if (!observability?.addFeedback) {
      throw new Error("Mastra observability feedback is unavailable");
    }
    return observability;
  }

  private async requiredCandidate(
    candidateId: string,
  ): Promise<ImprovementCandidateRecord> {
    const candidate = await this.repository.candidate(candidateId);
    if (!candidate) throw new Error("Improvement candidate was not found");
    return candidate;
  }
}

function workflowFailure(name: string, status: string): Error {
  return new Error(`${name} did not complete successfully (${status})`);
}

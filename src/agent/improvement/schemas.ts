import { z } from "zod";

export const improvementTraceSchema = z.object({
  id: z.string().min(1).max(256),
  traceId: z.string().min(1).max(256),
  threadId: z.string().min(1).max(256),
  model: z.string().min(1).max(256),
  status: z.enum(["completed", "cancelled", "failed"]),
  promptExcerpt: z.string().max(4_000),
  answerExcerpt: z.string().max(4_000).optional(),
  toolNames: z.array(z.string().min(1).max(128)).max(100),
  toolCount: z.number().int().nonnegative(),
  failedToolCount: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
});

export const improvementEvaluationSchema = z.object({
  id: z.string().min(1).max(256),
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  rationale: z.string().min(1).max(4_000),
  checkedAt: z.number().int().nonnegative(),
  experimentId: z.string().min(1).max(256),
});

export const improvementCandidateStatusSchema = z.enum([
  "draft",
  "evaluating",
  "ready",
  "awaiting-approval",
  "published",
  "rejected",
  "replaced",
  "rolled-back",
]);

export const improvementCandidateSchema = z.object({
  id: z.string().min(1).max(256),
  traceId: z.string().min(1).max(256),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(2_000),
  instruction: z.string().min(1).max(8_000),
  status: improvementCandidateStatusSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  feedbackCount: z.number().int().nonnegative(),
  evaluation: improvementEvaluationSchema.optional(),
  publicationRunId: z.string().min(1).max(256).optional(),
  publishedAt: z.number().int().nonnegative().optional(),
  rolledBackAt: z.number().int().nonnegative().optional(),
});

export const candidateProposalSchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(2_000),
  instruction: z.string().min(1).max(8_000),
});

export const candidateEvaluationSchema = z.object({
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  rationale: z.string().min(1).max(4_000),
});

export type ImprovementTraceRecord = z.infer<typeof improvementTraceSchema>;
export type ImprovementCandidateRecord = z.infer<
  typeof improvementCandidateSchema
>;
export type CandidateProposal = z.infer<typeof candidateProposalSchema>;
export type CandidateEvaluation = z.infer<typeof candidateEvaluationSchema>;

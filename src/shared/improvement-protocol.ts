import type { OpenRouterReasoningEffort } from "./openrouter-protocol.js";

export type ImprovementCandidateStatus =
  | "draft"
  | "evaluating"
  | "ready"
  | "awaiting-approval"
  | "published"
  | "rejected"
  | "replaced"
  | "rolled-back";

export interface ImprovementScope {
  workspacePath: string;
  model?: string;
  reasoningEffort?: OpenRouterReasoningEffort;
}

/** A privacy-filtered summary of one completed local agent run. */
export interface ImprovementTrace {
  id: string;
  traceId: string;
  threadId: string;
  model: string;
  status: "completed" | "cancelled" | "failed";
  promptExcerpt: string;
  answerExcerpt?: string;
  toolNames: string[];
  toolCount: number;
  failedToolCount: number;
  createdAt: number;
}

export interface ImprovementEvaluation {
  id: string;
  score: number;
  passed: boolean;
  rationale: string;
  checkedAt: number;
  experimentId: string;
}

/** A versioned, app-owned operating-policy proposal. It never changes workspace files. */
export interface ImprovementCandidate {
  id: string;
  traceId: string;
  title: string;
  summary: string;
  instruction: string;
  status: ImprovementCandidateStatus;
  createdAt: number;
  updatedAt: number;
  feedbackCount: number;
  evaluation?: ImprovementEvaluation;
  publicationRunId?: string;
  publishedAt?: number;
  rolledBackAt?: number;
}

export interface ImprovementSnapshot {
  traces: ImprovementTrace[];
  candidates: ImprovementCandidate[];
  activeCandidateId?: string;
}

export interface AddImprovementFeedbackInput extends ImprovementScope {
  traceId: string;
  rating: 1 | -1;
  comment?: string;
}

export interface CreateImprovementCandidateInput extends ImprovementScope {
  traceId: string;
}

export interface EvaluateImprovementCandidateInput extends ImprovementScope {
  candidateId: string;
}

export interface RequestImprovementPublicationInput extends ImprovementScope {
  candidateId: string;
}

export interface ResolveImprovementPublicationInput extends ImprovementScope {
  candidateId: string;
  approved: boolean;
}

export interface RollbackImprovementCandidateInput extends ImprovementScope {
  candidateId: string;
}

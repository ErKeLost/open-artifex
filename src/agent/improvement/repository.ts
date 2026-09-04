import type { Mastra } from "@mastra/core";
import type { LibSQLStore } from "@mastra/libsql";
import type {
  ImprovementCandidate,
  ImprovementSnapshot,
  ImprovementTrace,
} from "../../shared/improvement-protocol.js";
import {
  improvementCandidateSchema,
  improvementTraceSchema,
  type ImprovementCandidateRecord,
  type ImprovementTraceRecord,
} from "./schemas.js";

const TRACE_DATASET_ID = "improvement-run-traces";
const CANDIDATE_DATASET_ID = "improvement-candidates";
const EVALUATION_DATASET_ID = "improvement-evaluation-cases";
const CONTROL_THREAD_ID = "improvement-control-plane";
const ACTIVE_POLICY_STATE = "active-improvement-policy";

type ActivePolicyState = {
  activeCandidateId?: string;
  history: string[];
};

function isPaginated<Value>(
  value: Value[] | { items: Value[] },
): value is { items: Value[] } {
  return !Array.isArray(value);
}

function newestFirst<T extends { createdAt: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => right.createdAt - left.createdAt);
}

/**
 * All durable improvement records are stored through Mastra storage domains:
 * Dataset versions hold traces and candidate revisions, ThreadState holds the
 * published-policy pointer, and Observability stores feedback on trace IDs.
 */
export class ImprovementRepository {
  private traceDatasetHandle?: ReturnType<Mastra["datasets"]["create"]>;
  private candidateDatasetHandle?: ReturnType<Mastra["datasets"]["create"]>;
  private evaluationDatasetHandle?: ReturnType<Mastra["datasets"]["create"]>;

  constructor(
    private readonly getMastra: () => Mastra,
    private readonly storage: LibSQLStore,
  ) {}

  async saveTrace(trace: ImprovementTraceRecord): Promise<void> {
    const dataset = await this.traceDataset();
    const current = await this.traceItems();
    const existing = current.find((item) => item.value.id === trace.id);
    if (existing) {
      await dataset.updateItem({ itemId: existing.itemId, input: trace });
      return;
    }
    await dataset.addItem({
      externalId: trace.id,
      input: trace,
      source: { type: "trace", referenceId: trace.traceId },
    });
  }

  async findTrace(traceId: string): Promise<ImprovementTraceRecord | undefined> {
    return (await this.traces()).find((trace) => trace.traceId === traceId);
  }

  async traces(): Promise<ImprovementTrace[]> {
    return newestFirst((await this.traceItems()).map((item) => item.value));
  }

  async saveCandidate(candidate: ImprovementCandidateRecord): Promise<void> {
    const dataset = await this.candidateDataset();
    const current = await this.candidateItems();
    const existing = current.find((item) => item.value.id === candidate.id);
    if (existing) {
      await dataset.updateItem({ itemId: existing.itemId, input: candidate });
      return;
    }
    await dataset.addItem({
      externalId: candidate.id,
      input: candidate,
      source: { type: "llm", referenceId: candidate.traceId },
    });
  }

  async candidate(id: string): Promise<ImprovementCandidateRecord | undefined> {
    return (await this.candidateItems()).find((item) => item.value.id === id)
      ?.value;
  }

  async candidates(): Promise<ImprovementCandidate[]> {
    return newestFirst((await this.candidateItems()).map((item) => item.value));
  }

  async snapshot(): Promise<ImprovementSnapshot> {
    const [traces, candidates, activeCandidateId] = await Promise.all([
      this.traces(),
      this.candidates(),
      this.activeCandidateId(),
    ]);
    return {
      traces,
      candidates,
      ...(activeCandidateId ? { activeCandidateId } : {}),
    };
  }

  async feedbackCount(traceId: string): Promise<number> {
    const feedback = await this.feedback(traceId);
    return feedback.length;
  }

  async feedback(traceId: string): Promise<
    Array<{ value: number | string; comment?: string | null }>
  > {
    const store = await this.storage.getStore("observability");
    if (!store) return [];
    const result = await store.listFeedback({
      filters: { traceId },
      pagination: { page: 0, perPage: 100 },
    });
    return result.feedback.map((entry) => ({
      value: entry.value,
      comment: entry.comment,
    }));
  }

  async setActiveCandidate(candidateId: string): Promise<void> {
    const state = await this.controlState();
    const history = [candidateId, ...state.history.filter((id) => id !== candidateId)].slice(
      0,
      50,
    );
    const store = await this.requireThreadState();
    await store.setState({
      threadId: CONTROL_THREAD_ID,
      type: ACTIVE_POLICY_STATE,
      value: { activeCandidateId: candidateId, history } satisfies ActivePolicyState,
    });
  }

  async clearActiveCandidate(): Promise<void> {
    const state = await this.controlState();
    const store = await this.requireThreadState();
    await store.setState({
      threadId: CONTROL_THREAD_ID,
      type: ACTIVE_POLICY_STATE,
      value: { history: state.history } satisfies ActivePolicyState,
    });
  }

  async activeCandidateId(): Promise<string | undefined> {
    return (await this.controlState()).activeCandidateId;
  }

  async persistEvaluationEvidence(args: {
    candidate: ImprovementCandidateRecord;
    trace: ImprovementTraceRecord;
    evaluation: NonNullable<ImprovementCandidateRecord["evaluation"]>;
  }): Promise<void> {
    const dataset = await this.evaluationDataset();
    const item = await dataset.addItem({
      externalId: args.evaluation.id,
      input: {
        candidate: args.candidate,
        trace: args.trace,
      },
      groundTruth: {
        minimumScore: 0.75,
        requiresHumanApproval: true,
        prohibitsWorkspaceMutation: true,
      },
      source: { type: "candidate-screener", referenceId: args.candidate.id },
    });
    const experiment = await dataset.createExperiment({
      id: args.evaluation.experimentId,
      name: `Candidate evaluation ${args.candidate.id}`,
      description: "Caller-owned evaluation result submitted by the Mastra workflow.",
      grouping: {
        experimentSetId: "improvement-policy-evaluations",
        comparisonId: args.candidate.id,
        variantId: "candidate",
      },
      version: item.datasetVersion,
    });
    await dataset.submitExperimentResult({
      experimentId: experiment.experimentId,
      itemId: item.id,
      output: args.evaluation,
      traceId: args.trace.traceId,
      scores: [
        {
          scorerId: "improvement-policy-safety-gate",
          scorerName: "Improvement policy safety gate",
          score: args.evaluation.score,
          reason: args.evaluation.rationale,
          metadata: {
            passed: args.evaluation.passed,
            candidateId: args.candidate.id,
          },
        },
      ],
    });
    await dataset.finalizeExperiment({ experimentId: experiment.experimentId });
  }

  async previousCandidateId(currentCandidateId: string): Promise<string | undefined> {
    const state = await this.controlState();
    return state.history.find((id) => id !== currentCandidateId);
  }

  private async controlState(): Promise<ActivePolicyState> {
    const store = await this.requireThreadState();
    const value = await store.getState<ActivePolicyState>({
      threadId: CONTROL_THREAD_ID,
      type: ACTIVE_POLICY_STATE,
    });
    return {
      ...(typeof value?.activeCandidateId === "string"
        ? { activeCandidateId: value.activeCandidateId }
        : {}),
      history: Array.isArray(value?.history)
        ? value.history.filter((id): id is string => typeof id === "string")
        : [],
    };
  }

  private async requireThreadState() {
    const store = await this.storage.getStore("threadState");
    if (!store) throw new Error("Mastra thread-state storage is unavailable");
    return store;
  }

  private async traceDataset() {
    return (this.traceDatasetHandle ??= this.getMastra().datasets.create({
      id: TRACE_DATASET_ID,
      name: "Improvement run traces",
      description: "Privacy-filtered local agent run summaries.",
      metadata: { domain: "improvement" },
      targetType: "workflow",
    }));
  }

  private async candidateDataset() {
    return (this.candidateDatasetHandle ??= this.getMastra().datasets.create({
      id: CANDIDATE_DATASET_ID,
      name: "Improvement candidates",
      description: "Versioned operator-reviewed runtime policy proposals.",
      metadata: { domain: "improvement" },
      targetType: "workflow",
    }));
  }

  private async evaluationDataset() {
    return (this.evaluationDatasetHandle ??= this.getMastra().datasets.create({
      id: EVALUATION_DATASET_ID,
      name: "Improvement evaluation cases",
      description: "Versioned evidence used to validate candidate policies.",
      metadata: { domain: "improvement" },
    }));
  }

  private async traceItems(): Promise<
    Array<{ itemId: string; value: ImprovementTraceRecord }>
  > {
    const values = await (await this.traceDataset()).listItems({ perPage: 200 });
    const items = isPaginated(values) ? values.items : values;
    return items.flatMap((item) => {
      const parsed = improvementTraceSchema.safeParse(item.input);
      return parsed.success ? [{ itemId: item.id, value: parsed.data }] : [];
    });
  }

  private async candidateItems(): Promise<
    Array<{ itemId: string; value: ImprovementCandidateRecord }>
  > {
    const values = await (await this.candidateDataset()).listItems({ perPage: 200 });
    const items = isPaginated(values) ? values.items : values;
    return items.flatMap((item) => {
      const parsed = improvementCandidateSchema.safeParse(item.input);
      return parsed.success ? [{ itemId: item.id, value: parsed.data }] : [];
    });
  }
}

import {
  ArrowCounterClockwise,
  CheckCircle,
  Flask,
  Sparkle,
  ThumbsDown,
  ThumbsUp,
  UploadSimple,
  XCircle,
} from "@phosphor-icons/react";
import { useState } from "react";
import type {
  ImprovementCandidate,
  ImprovementSnapshot,
  ImprovementTrace,
} from "../../../shared/improvement-protocol.js";
import { Button } from "../../components/ui/button";
import "./improvement.css";

export interface ImprovementViewProps {
  snapshot: ImprovementSnapshot;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  onFeedback: (trace: ImprovementTrace, rating: 1 | -1) => Promise<void>;
  onCreateCandidate: (trace: ImprovementTrace) => Promise<void>;
  onEvaluate: (candidate: ImprovementCandidate) => Promise<void>;
  onRequestPublication: (candidate: ImprovementCandidate) => Promise<void>;
  onResolvePublication: (
    candidate: ImprovementCandidate,
    approved: boolean,
  ) => Promise<void>;
  onRollback: (candidate: ImprovementCandidate) => Promise<void>;
}

function dateTime(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function statusLabel(candidate: ImprovementCandidate): string {
  const labels: Record<ImprovementCandidate["status"], string> = {
    draft: "草稿",
    evaluating: "评测中",
    ready: "可提交",
    "awaiting-approval": "待确认",
    published: "已发布",
    rejected: "已拒绝",
    replaced: "已替换",
    "rolled-back": "已回滚",
  };
  return labels[candidate.status];
}

export function ImprovementView({
  snapshot,
  status,
  error,
  onFeedback,
  onCreateCandidate,
  onEvaluate,
  onRequestPublication,
  onResolvePublication,
  onRollback,
}: ImprovementViewProps) {
  const [busyId, setBusyId] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const perform = async (id: string, action: () => Promise<void>) => {
    if (busyId) return;
    setBusyId(id);
    setActionError(undefined);
    try {
      await action();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <section className="oa-improvement" aria-label="改进中心">
      <div className="oa-improvement__content">
        <header className="oa-improvement__header">
          <Sparkle aria-hidden="true" size={18} weight="regular" />
          <div>
            <h1>改进中心</h1>
            <p>运行记录、评测和已发布策略均由本地 Mastra 存储管理。</p>
          </div>
        </header>

        {actionError || error ? (
          <p className="oa-improvement__error" role="alert">
            {actionError ?? error}
          </p>
        ) : null}

        <section className="oa-improvement__section" aria-label="最近运行">
          <h2>最近运行</h2>
          {status === "loading" ? <p className="oa-improvement__muted">正在加载运行记录</p> : null}
          {status === "ready" && snapshot.traces.length === 0 ? (
            <p className="oa-improvement__muted">完成一次对话后，这里会出现脱敏运行记录。</p>
          ) : null}
          <div className="oa-improvement__list">
            {snapshot.traces.map((trace) => (
              <article className="oa-improvement-trace" key={trace.traceId}>
                <div className="oa-improvement-trace__copy">
                  <p>{trace.promptExcerpt || "未记录任务摘要"}</p>
                  <span>
                    {dateTime(trace.createdAt)} · {trace.model} · {trace.toolCount} 个工具调用
                    {trace.failedToolCount ? ` · ${trace.failedToolCount} 个失败` : ""}
                  </span>
                </div>
                <div className="oa-improvement-trace__actions">
                  <Button
                    aria-label="此结果有帮助"
                    disabled={Boolean(busyId)}
                    onClick={() => void perform(`up-${trace.traceId}`, () => onFeedback(trace, 1))}
                    size="icon"
                    title="此结果有帮助"
                    type="button"
                    variant="ghost"
                  >
                    <ThumbsUp aria-hidden="true" size={15} weight="regular" />
                  </Button>
                  <Button
                    aria-label="此结果需要改进"
                    disabled={Boolean(busyId)}
                    onClick={() => void perform(`down-${trace.traceId}`, () => onFeedback(trace, -1))}
                    size="icon"
                    title="此结果需要改进"
                    type="button"
                    variant="ghost"
                  >
                    <ThumbsDown aria-hidden="true" size={15} weight="regular" />
                  </Button>
                  <Button
                    aria-label="基于此运行生成候选策略"
                    disabled={Boolean(busyId)}
                    onClick={() => void perform(`draft-${trace.traceId}`, () => onCreateCandidate(trace))}
                    size="icon"
                    title="生成候选策略"
                    type="button"
                    variant="ghost"
                  >
                    <Sparkle aria-hidden="true" size={15} weight="regular" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="oa-improvement__section" aria-label="候选策略">
          <h2>候选策略</h2>
          {status === "ready" && snapshot.candidates.length === 0 ? (
            <p className="oa-improvement__muted">还没有候选策略。</p>
          ) : null}
          <div className="oa-improvement__list">
            {snapshot.candidates.map((candidate) => (
              <article className="oa-improvement-candidate" key={candidate.id}>
                <div className="oa-improvement-candidate__copy">
                  <div className="oa-improvement-candidate__title">
                    <p>{candidate.title}</p>
                    <span data-status={candidate.status}>{statusLabel(candidate)}</span>
                  </div>
                  <p className="oa-improvement-candidate__summary">{candidate.summary}</p>
                  <pre>{candidate.instruction}</pre>
                  {candidate.evaluation ? (
                    <span>
                      评测 {Math.round(candidate.evaluation.score * 100)}% · {candidate.evaluation.rationale}
                    </span>
                  ) : null}
                </div>
                <div className="oa-improvement-candidate__actions">
                  {candidate.status === "draft" ? (
                    <Button
                      aria-label="评测候选策略"
                      disabled={Boolean(busyId)}
                      onClick={() => void perform(`eval-${candidate.id}`, () => onEvaluate(candidate))}
                      size="icon"
                      title="评测候选策略"
                      type="button"
                      variant="ghost"
                    >
                      <Flask aria-hidden="true" size={15} weight="regular" />
                    </Button>
                  ) : null}
                  {candidate.status === "ready" ? (
                    <Button
                      aria-label="提交发布确认"
                      disabled={Boolean(busyId)}
                      onClick={() => void perform(`submit-${candidate.id}`, () => onRequestPublication(candidate))}
                      size="icon"
                      title="提交发布确认"
                      type="button"
                      variant="ghost"
                    >
                      <UploadSimple aria-hidden="true" size={15} weight="regular" />
                    </Button>
                  ) : null}
                  {candidate.status === "awaiting-approval" ? (
                    <>
                      <Button
                        aria-label="批准发布"
                        disabled={Boolean(busyId)}
                        onClick={() => void perform(`approve-${candidate.id}`, () => onResolvePublication(candidate, true))}
                        size="icon"
                        title="批准发布"
                        type="button"
                        variant="ghost"
                      >
                        <CheckCircle aria-hidden="true" size={15} weight="regular" />
                      </Button>
                      <Button
                        aria-label="拒绝发布"
                        disabled={Boolean(busyId)}
                        onClick={() => void perform(`reject-${candidate.id}`, () => onResolvePublication(candidate, false))}
                        size="icon"
                        title="拒绝发布"
                        type="button"
                        variant="ghost"
                      >
                        <XCircle aria-hidden="true" size={15} weight="regular" />
                      </Button>
                    </>
                  ) : null}
                  {candidate.status === "published" ? (
                    <Button
                      aria-label="回滚已发布策略"
                      disabled={Boolean(busyId)}
                      onClick={() => void perform(`rollback-${candidate.id}`, () => onRollback(candidate))}
                      size="icon"
                      title="回滚已发布策略"
                      type="button"
                      variant="ghost"
                    >
                      <ArrowCounterClockwise aria-hidden="true" size={15} weight="regular" />
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

import { ArrowUp, Plus, ShieldCheck, Stop } from "@phosphor-icons/react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type {
  OpenRouterModel,
  OpenRouterReasoningEffort,
} from "../../../shared/openrouter-protocol.js";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { ModelPicker, type ModelCatalogStatus } from "../model";
import "./composer.css";

export interface ComposerProps {
  className?: string;
  disabled?: boolean;
  running?: boolean;
  placeholder?: string;
  model?: string;
  models?: readonly OpenRouterModel[];
  modelCatalogStatus?: ModelCatalogStatus;
  modelCatalogError?: string;
  reasoningEffort?: OpenRouterReasoningEffort;
  onAttach?: () => void;
  onStop?: () => void;
  onSubmit?: (message: string) => void | Promise<void>;
  onSelectModel?: (modelId: string) => void;
  onSelectReasoningEffort?: (effort?: OpenRouterReasoningEffort) => void;
  onRefreshModels?: () => void | Promise<void>;
}

export function Composer({
  className,
  disabled = false,
  running = false,
  placeholder = "随心输入",
  model,
  models = [],
  modelCatalogStatus = "idle",
  modelCatalogError,
  reasoningEffort,
  onAttach,
  onStop,
  onSubmit,
  onSelectModel,
  onSelectReasoningEffort,
  onRefreshModels,
}: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSubmit = Boolean(
    onSubmit && draft.trim() && !disabled && !running && !submitting,
  );

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
  }, [draft]);

  const submit = async () => {
    const message = draft.trim();
    if (!canSubmit || !onSubmit) return;

    setError(undefined);
    setSubmitting(true);
    try {
      await onSubmit(message);
      setDraft("");
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "任务发送失败",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    void submit();
  };

  return (
    <form
      className={["oa-composer", className].filter(Boolean).join(" ")}
      onSubmit={handleSubmit}
    >
      <Textarea
        aria-label="给 Open Artifex 的消息"
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={draft}
      />

      <div className="oa-composer__footer">
        <div className="oa-composer__left">
          <Button
            aria-label="添加上下文"
            className="oa-composer__tool"
            disabled={!onAttach || disabled}
            onClick={onAttach}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Plus aria-hidden="true" size={17} weight="regular" />
          </Button>
          <span className="oa-composer__permission">
            <ShieldCheck aria-hidden="true" size={14} weight="regular" />
            <span>完全访问</span>
          </span>
        </div>

        <div className="oa-composer__right">
          {onSelectModel && onSelectReasoningEffort && onRefreshModels ? (
            <ModelPicker
              disabled={disabled || running}
              error={modelCatalogError}
              models={models}
              onRefresh={onRefreshModels}
              onSelectModel={onSelectModel}
              onSelectReasoningEffort={onSelectReasoningEffort}
              reasoningEffort={reasoningEffort}
              status={modelCatalogStatus}
              value={model}
            />
          ) : model ? (
            <span>{model}</span>
          ) : null}
          {running ? (
            <Button
              aria-label="停止运行"
              className="oa-composer__submit oa-composer__submit--stop"
              disabled={!onStop}
              onClick={onStop}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Stop aria-hidden="true" size={12} weight="fill" />
            </Button>
          ) : (
            <Button
              aria-label="发送消息"
              className="oa-composer__submit"
              disabled={!canSubmit}
              size="icon"
              type="submit"
              variant="ghost"
            >
              <ArrowUp aria-hidden="true" size={15} weight="bold" />
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <div className="oa-composer__error" role="alert">
          {error}
        </div>
      ) : null}
    </form>
  );
}

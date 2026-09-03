import { Check, ChevronDown, RefreshCw, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  OpenRouterModel,
  OpenRouterReasoningEffort,
} from "../../../shared/openrouter-protocol.js";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import "./model-picker.css";

export type ModelCatalogStatus = "idle" | "loading" | "ready" | "error";

export interface ModelPickerProps {
  className?: string;
  disabled?: boolean;
  models: readonly OpenRouterModel[];
  status: ModelCatalogStatus;
  error?: string;
  value?: string;
  reasoningEffort?: OpenRouterReasoningEffort;
  onSelectModel(modelId: string): void;
  onSelectReasoningEffort(effort?: OpenRouterReasoningEffort): void;
  onRefresh(): void | Promise<void>;
}

function selectedModel(
  models: readonly OpenRouterModel[],
  value: string | undefined,
): OpenRouterModel | undefined {
  return models.find((model) => model.id === value);
}

function compactModelName(model: OpenRouterModel | undefined, value?: string) {
  if (!model) return value ?? "选择模型";
  return model.name.replace(/^[^:]+:\s*/, "");
}

export function ModelPicker({
  className,
  disabled = false,
  models,
  status,
  error,
  value,
  reasoningEffort,
  onSelectModel,
  onSelectReasoningEffort,
  onRefresh,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const activeModel = selectedModel(models, value);
  const efforts = activeModel?.reasoning?.supportedEfforts ?? [];
  const visibleModels = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return models;
    return models.filter((model) =>
      `${model.name} ${model.id}`.toLocaleLowerCase().includes(keyword),
    );
  }, [models, query]);

  const chooseModel = (modelId: string) => {
    onSelectModel(modelId);
    setOpen(false);
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <Button
        aria-label="选择模型与推理强度"
        className={["oa-model-picker__trigger", className]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        onClick={() => setOpen(true)}
        title="选择模型与推理强度"
        type="button"
        variant="ghost"
      >
        <span>{compactModelName(activeModel, value)}</span>
        {reasoningEffort ? (
          <span className="oa-model-picker__effort">{reasoningEffort}</span>
        ) : null}
        <ChevronDown aria-hidden="true" size={14} />
      </Button>

      <DialogContent className="oa-model-picker" showCloseButton={false}>
        <DialogHeader className="oa-model-picker__header">
          <div>
            <DialogTitle>模型</DialogTitle>
            <span>
              {models.length ? `${models.length} 个可用模型` : "模型目录"}
            </span>
          </div>
          <div className="oa-model-picker__header-actions">
            <Button
              aria-label="刷新模型目录"
              disabled={status === "loading"}
              onClick={() => void onRefresh()}
              size="icon-sm"
              title="刷新模型目录"
              type="button"
              variant="ghost"
            >
              <RefreshCw
                aria-hidden="true"
                className={
                  status === "loading" ? "oa-model-picker__spin" : undefined
                }
              />
            </Button>
            <Button
              aria-label="关闭模型选择"
              onClick={() => setOpen(false)}
              size="icon-sm"
              title="关闭模型选择"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        </DialogHeader>

        <label className="oa-model-picker__search">
          <Search aria-hidden="true" size={15} />
          <span className="sr-only">搜索模型</span>
          <Input
            autoFocus
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索模型"
            value={query}
          />
        </label>

        <div className="oa-model-picker__body">
          <ScrollArea className="oa-model-picker__models">
            <div className="oa-model-picker__model-list">
              {status === "loading" && !models.length ? (
                <p className="oa-model-picker__message">正在加载模型目录</p>
              ) : null}
              {status === "error" ? (
                <p className="oa-model-picker__message oa-model-picker__message--error">
                  {error ?? "模型目录暂时不可用"}
                </p>
              ) : null}
              {status !== "loading" && !visibleModels.length ? (
                <p className="oa-model-picker__message">没有匹配的模型</p>
              ) : null}
              {visibleModels.map((model) => {
                const active = model.id === value;
                return (
                  <Button
                    aria-pressed={active}
                    className={`oa-model-picker__model${active ? " is-selected" : ""}`}
                    key={model.id}
                    onClick={() => chooseModel(model.id)}
                    type="button"
                    variant="ghost"
                  >
                    <span className="oa-model-picker__model-copy">
                      <strong>{model.name}</strong>
                      <small>{model.id}</small>
                    </span>
                    <span className="oa-model-picker__model-meta">
                      {model.reasoning?.supportedEfforts.length ? "推理" : null}
                      {active ? <Check aria-hidden="true" size={15} /> : null}
                    </span>
                  </Button>
                );
              })}
            </div>
          </ScrollArea>

          <aside className="oa-model-picker__settings" aria-label="模型设置">
            <div className="oa-model-picker__selected-name">
              <strong>{activeModel?.name ?? value ?? "未选择模型"}</strong>
              {activeModel ? <span>{activeModel.id}</span> : null}
            </div>
            <label className="oa-model-picker__effort-control">
              <span>推理强度</span>
              <Select
                disabled={!efforts.length}
                onValueChange={(next) =>
                  onSelectReasoningEffort(next ?? undefined)
                }
                value={reasoningEffort}
              >
                <SelectTrigger>
                  <SelectValue placeholder="此模型不支持" />
                </SelectTrigger>
                <SelectContent>
                  {efforts.map((effort) => (
                    <SelectItem key={effort} value={effort}>
                      {effort}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <dl className="oa-model-picker__details">
              <div>
                <dt>上下文</dt>
                <dd>
                  {activeModel?.contextLength
                    ? activeModel.contextLength.toLocaleString()
                    : "-"}
                </dd>
              </div>
              <div>
                <dt>输出</dt>
                <dd>{activeModel?.outputModalities.join(", ") || "-"}</dd>
              </div>
            </dl>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

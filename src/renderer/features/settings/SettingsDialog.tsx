import { Eye, EyeSlash, Key, Trash, X } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import type { CredentialStatus } from "../../../shared/desktop-api.js";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import "./settings.css";

export interface SettingsDialogProps {
  open: boolean;
  credentials?: CredentialStatus;
  onClose(): void;
  onSave(apiKey: string): Promise<void>;
  onClear(): Promise<void>;
}

const sourceLabel: Record<CredentialStatus["source"], string> = {
  "safe-storage": "系统凭据存储",
  session: "当前会话",
  environment: "环境变量",
  missing: "尚未配置",
};

export function SettingsDialog({
  open,
  credentials,
  onClose,
  onSave,
  onClear,
}: SettingsDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) {
      setApiKey("");
      setError(undefined);
      setShowKey(false);
    }
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim() || pending) return;
    setPending(true);
    setError(undefined);
    try {
      await onSave(apiKey.trim());
      setApiKey("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存密钥失败");
    } finally {
      setPending(false);
    }
  };

  const clear = async () => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await onClear();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "清除密钥失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
    >
      <DialogContent
        className="oa-settings"
        showCloseButton={false}
      >
        <DialogHeader className="oa-settings__header">
          <div>
            <Key aria-hidden="true" size={18} weight="regular" />
            <DialogTitle>设置</DialogTitle>
          </div>
          <Button
            aria-label="关闭设置"
            className="oa-icon-button"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" size={16} weight="regular" />
          </Button>
        </DialogHeader>

        <form className="oa-settings__form" onSubmit={submit}>
          <div className="oa-settings__status">
            <span>OpenRouter API 密钥</span>
            <strong>{sourceLabel[credentials?.source ?? "missing"]}</strong>
          </div>
          <label>
            <span className="sr-only">OpenRouter API 密钥</span>
            <Input
              autoComplete="off"
              disabled={pending}
              onChange={(event) => setApiKey(event.currentTarget.value)}
              placeholder="sk-or-v1-..."
              spellCheck={false}
              type={showKey ? "text" : "password"}
              value={apiKey}
            />
          </label>
          <div className="oa-settings__actions">
            <Button
              aria-label={showKey ? "隐藏密钥" : "显示密钥"}
              className="oa-icon-button"
              onClick={() => setShowKey((visible) => !visible)}
              title={showKey ? "隐藏密钥" : "显示密钥"}
              size="icon"
              type="button"
              variant="ghost"
            >
              {showKey ? (
                <EyeSlash aria-hidden="true" size={16} weight="regular" />
              ) : (
                <Eye aria-hidden="true" size={16} weight="regular" />
              )}
            </Button>
            <Button
              className="oa-settings__save"
              disabled={!apiKey.trim() || pending}
              type="submit"
              variant="default"
            >
              {pending ? "验证中" : "保存并验证"}
            </Button>
            <Button
              aria-label="清除密钥"
              className="oa-icon-button"
              disabled={!credentials?.configured || pending}
              onClick={() => void clear()}
              title="清除密钥"
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash aria-hidden="true" size={16} weight="regular" />
            </Button>
          </div>
          {error ? <p className="oa-settings__error">{error}</p> : null}
          <p className="oa-settings__hint">
            {credentials?.secureStorageAvailable
              ? "密钥会保存在系统凭据存储中。"
              : "系统凭据存储不可用，密钥仅在当前会话中保留。"}
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

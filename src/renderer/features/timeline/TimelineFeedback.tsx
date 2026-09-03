import { Info, WarningCircle } from "@phosphor-icons/react";
import TerminalLoader from "../../components/ui/TerminalLoader";

export function TimelineLoading() {
  return (
    <div
      aria-label="正在加载工具调用"
      aria-live="polite"
      className="oa-timeline-feedback oa-timeline-feedback--loading"
      role="status"
    >
      <span>正在准备工具调用…</span>
      <span aria-hidden="true">
        <TerminalLoader
          bgColor="bg-neutral-500"
          blockWidth={1}
          charEmpty="·"
          charTrail={["·"]}
          className="oa-terminal-loader text-neutral-500 dark:text-neutral-500"
          color="text-neutral-500"
          cols={13}
          rows={1}
          speed={140}
        />
      </span>
    </div>
  );
}

export function TimelineEmpty() {
  return (
    <div className="oa-timeline-feedback" role="status">
      <Info aria-hidden="true" size={17} />
      <span>还没有工具调用</span>
    </div>
  );
}

export function TimelineError({ message }: { message?: string }) {
  return (
    <div
      aria-live="polite"
      className="oa-timeline-feedback oa-timeline-feedback--error"
      role="alert"
    >
      <WarningCircle aria-hidden="true" size={17} weight="fill" />
      <span>{message ?? "工具调用记录加载失败"}</span>
    </div>
  );
}

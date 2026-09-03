import { ArrowClockwise, GitBranch, GitPullRequest, Plugs } from "@phosphor-icons/react";
import type { GitOverview, PluginSummary } from "../../../shared/desktop-api.js";
import { Button } from "../../components/ui/button";
import type { InventoryStatus } from "./inventory-store";
import "./inventory.css";

type InventoryViewProps = {
  status: InventoryStatus;
  error?: string;
  onRefresh?: () => void;
};

export function PullRequestsView({
  overview,
  status,
  error,
  onRefresh,
}: InventoryViewProps & { overview?: GitOverview }) {
  return (
    <section className="oa-inventory" aria-label="拉取请求">
      <header className="oa-inventory__header">
        <div>
          <GitPullRequest aria-hidden="true" size={19} weight="regular" />
          <h1>拉取请求</h1>
        </div>
        <Button
          aria-label="刷新拉取请求"
          className="oa-icon-button"
          disabled={!onRefresh || status === "loading"}
          onClick={onRefresh}
          title="刷新"
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowClockwise aria-hidden="true" size={16} weight="regular" />
        </Button>
      </header>

      {status === "loading" ? <p className="oa-inventory__muted">正在读取工作区</p> : null}
      {status === "error" ? <p className="oa-inventory__error">{error}</p> : null}
      {status === "ready" && overview && !overview.isRepository ? (
        <p className="oa-inventory__muted">当前工作区不是 Git 仓库</p>
      ) : null}
      {status === "ready" && overview?.isRepository ? (
        <div className="oa-inventory__content">
          <div className="oa-inventory__metadata">
            <span>
              <GitBranch aria-hidden="true" size={15} weight="regular" />
              {overview.branch ?? "未命名分支"}
            </span>
            {overview.remote ? <span title={overview.remote}>{overview.remote}</span> : null}
          </div>

          {overview.pullRequestsMessage ? (
            <p className="oa-inventory__muted">{overview.pullRequestsMessage}</p>
          ) : null}
          {!overview.pullRequestsMessage && overview.pullRequests.length === 0 ? (
            <p className="oa-inventory__muted">没有开放的拉取请求</p>
          ) : null}
          <div className="oa-inventory__list">
            {overview.pullRequests.map((pullRequest) => (
              <a
                className="oa-inventory__row"
                href={pullRequest.url}
                key={pullRequest.url}
                rel="noreferrer"
                target="_blank"
              >
                <span className="oa-inventory__number">#{pullRequest.number}</span>
                <span className="oa-inventory__row-copy">
                  <strong>{pullRequest.title}</strong>
                  <small>{pullRequest.branch}</small>
                </span>
                <span className="oa-inventory__state">{pullRequest.state}</span>
              </a>
            ))}
          </div>

          <section className="oa-inventory__changes" aria-label="工作区改动">
            <h2>工作区改动</h2>
            {overview.changes.length ? (
              <pre>{overview.changes.join("\n")}</pre>
            ) : (
              <p className="oa-inventory__muted">没有未提交的改动</p>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}

export function PluginsView({
  plugins,
  status,
  error,
  onRefresh,
}: InventoryViewProps & { plugins: readonly PluginSummary[] }) {
  return (
    <section className="oa-inventory" aria-label="插件">
      <header className="oa-inventory__header">
        <div>
          <Plugs aria-hidden="true" size={19} weight="regular" />
          <h1>插件</h1>
        </div>
        <Button
          aria-label="刷新插件"
          className="oa-icon-button"
          disabled={!onRefresh || status === "loading"}
          onClick={onRefresh}
          title="刷新"
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowClockwise aria-hidden="true" size={16} weight="regular" />
        </Button>
      </header>
      {status === "loading" ? <p className="oa-inventory__muted">正在扫描插件目录</p> : null}
      {status === "error" ? <p className="oa-inventory__error">{error}</p> : null}
      {status === "ready" && plugins.length === 0 ? (
        <p className="oa-inventory__muted">当前工作区没有已发现的插件</p>
      ) : null}
      <div className="oa-inventory__list">
        {plugins.map((plugin) => (
          <article className="oa-inventory__row" key={plugin.path}>
            <span className="oa-inventory__row-copy">
              <strong>{plugin.name}</strong>
              <small title={plugin.path}>{plugin.path}</small>
            </span>
            {plugin.version ? <span className="oa-inventory__state">v{plugin.version}</span> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

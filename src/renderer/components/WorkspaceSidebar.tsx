import {
  Bell,
  CalendarDots,
  CaretDown,
  FolderSimple,
  GearSix,
  GitPullRequest,
  MagnifyingGlass,
  PencilSimpleLine,
  Plugs,
  Plus,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { WorkspaceSelection } from "../../shared/desktop-api.js";
import { Button } from "./ui/button";
import type { SessionThread } from "../session/session-store";

export interface WorkspaceSidebarProps {
  workspaceName?: string;
  workspacePath?: string;
  workspaces?: readonly WorkspaceSelection[];
  threads?: readonly SessionThread[];
  activeThreadId?: string;
  onNewTask?: () => void;
  onSelectThread?: (threadId: string) => void;
  onSelectWorkspace?: (path?: string) => void;
  onOpenSchedules?: () => void;
  onOpenPullRequests?: () => void;
  onOpenPlugins?: () => void;
  onOpenSettings?: () => void;
}

export function WorkspaceSidebar({
  workspaceName = "open-artifex",
  workspacePath,
  workspaces = [],
  threads = [],
  activeThreadId,
  onNewTask,
  onSelectThread,
  onSelectWorkspace,
  onOpenSchedules,
  onOpenPullRequests,
  onOpenPlugins,
  onOpenSettings,
}: WorkspaceSidebarProps) {
  return (
    <aside className="oa-sidebar" aria-label="会话导航">
      <div className="oa-sidebar__topline">
        <Button
          aria-label="切换工作区"
          className="oa-sidebar__product"
          type="button"
          variant="ghost"
        >
          <span>Open Artifex</span>
          <CaretDown aria-hidden="true" size={12} weight="regular" />
        </Button>
        <div className="oa-sidebar__top-actions">
          <Button aria-label="搜索" size="icon" type="button" variant="ghost">
            <MagnifyingGlass aria-hidden="true" size={16} weight="regular" />
          </Button>
          <Button aria-label="通知" size="icon" type="button" variant="ghost">
            <Bell aria-hidden="true" size={16} weight="regular" />
          </Button>
        </div>
      </div>

      <nav className="oa-sidebar__nav" aria-label="主导航">
        <Button disabled={!onNewTask} onClick={onNewTask} type="button" variant="ghost">
          <PencilSimpleLine aria-hidden="true" size={16} weight="regular" />
          <span>新对话</span>
        </Button>
        <Button
          disabled={!onOpenPullRequests}
          onClick={onOpenPullRequests}
          type="button"
          variant="ghost"
        >
          <GitPullRequest aria-hidden="true" size={16} weight="regular" />
          <span>拉取请求</span>
        </Button>
        <Button
          disabled={!onOpenSchedules}
          onClick={onOpenSchedules}
          type="button"
          variant="ghost"
        >
          <CalendarDots aria-hidden="true" size={16} weight="regular" />
          <span>定时任务</span>
        </Button>
        <Button disabled={!onOpenPlugins} onClick={onOpenPlugins} type="button" variant="ghost">
          <Plugs aria-hidden="true" size={16} weight="regular" />
          <span>插件</span>
        </Button>
      </nav>

      <SidebarSection label="置顶">
        {threads.slice(0, 1).map((thread) => (
          <Button
            className="oa-sidebar__conversation"
            key={thread.id}
            onClick={() => onSelectThread?.(thread.id)}
            type="button"
            variant="ghost"
          >
            <span>{thread.title}</span>
          </Button>
        ))}
      </SidebarSection>

      <SidebarSection label="项目" className="oa-sidebar__projects">
        <Button
          className="oa-sidebar__project"
          disabled={!onSelectWorkspace}
          onClick={() => onSelectWorkspace?.()}
          title={workspacePath}
          type="button"
          variant="ghost"
        >
          <FolderSimple aria-hidden="true" size={16} weight="regular" />
          <span>{workspaceName}</span>
        </Button>
        {threads
          .filter((thread) => thread.id === activeThreadId)
          .map((thread) => (
            <Button
              className="oa-sidebar__conversation oa-sidebar__conversation--active"
              key={thread.id}
              onClick={() => onSelectThread?.(thread.id)}
              type="button"
              variant="ghost"
            >
              <span>{thread.title}</span>
              <i aria-label="当前会话" />
            </Button>
          ))}
        {workspaces
          .filter((project) => project.path !== workspacePath)
          .map((project) => (
            <Button
              className="oa-sidebar__project"
              key={project.path}
              onClick={() => onSelectWorkspace?.(project.path)}
              title={project.path}
              type="button"
              variant="ghost"
            >
              <FolderSimple aria-hidden="true" size={16} weight="regular" />
              <span>{project.name}</span>
            </Button>
          ))}
      </SidebarSection>

      <SidebarSection label="最近" className="oa-sidebar__recent">
        {threads.length > 1 ? (
          threads.slice(1).map((thread) => (
            <Button
              className="oa-sidebar__conversation"
              key={thread.id}
              onClick={() => onSelectThread?.(thread.id)}
              type="button"
              variant="ghost"
            >
              <span>{thread.title}</span>
            </Button>
          ))
        ) : (
          <span className="oa-sidebar__empty">暂无更多会话</span>
        )}
      </SidebarSection>

      <div className="oa-sidebar__spacer" />
      <div className="oa-sidebar__account">
        <Button
          aria-label="设置"
          disabled={!onOpenSettings}
          onClick={onOpenSettings}
          size="icon"
          type="button"
          variant="ghost"
        >
          <GearSix aria-hidden="true" size={15} weight="regular" />
        </Button>
        <span>本地模式</span>
        <Button
          aria-label="新建任务"
          disabled={!onNewTask}
          onClick={onNewTask}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden="true" size={15} weight="bold" />
        </Button>
      </div>
    </aside>
  );
}

function SidebarSection({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={["oa-sidebar__section", className].filter(Boolean).join(" ")}
    >
      <h2>{label}</h2>
      <div>{children}</div>
    </section>
  );
}

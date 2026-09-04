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
  Sparkle,
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
  onOpenImprovement?: () => void;
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
  onOpenImprovement,
  onOpenSettings,
}: WorkspaceSidebarProps) {
  const projectThreads = threads;

  return (
    <aside className="oa-sidebar" aria-label="会话导航">
      <div className="oa-sidebar__topline">
        <Button
          aria-label="切换工作区"
          className="oa-sidebar__product"
          onClick={() => onSelectWorkspace?.()}
          disabled={!onSelectWorkspace}
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
        <Button
          disabled={!onOpenImprovement}
          onClick={onOpenImprovement}
          type="button"
          variant="ghost"
        >
          <Sparkle aria-hidden="true" size={16} weight="regular" />
          <span>改进中心</span>
        </Button>
        <Button disabled={!onOpenPlugins} onClick={onOpenPlugins} type="button" variant="ghost">
          <Plugs aria-hidden="true" size={16} weight="regular" />
          <span>插件</span>
        </Button>
      </nav>

      <SidebarSection
        action={
          onNewTask ? (
            <Button
              aria-label="在当前项目中新建对话"
              onClick={onNewTask}
              size="icon-xs"
              title="新建对话"
              type="button"
              variant="ghost"
            >
              <Plus aria-hidden="true" size={14} weight="bold" />
            </Button>
          ) : undefined
        }
        label="项目"
        className="oa-sidebar__projects"
      >
        <Button
          className="oa-sidebar__project oa-sidebar__project--current"
          disabled={!onSelectWorkspace}
          onClick={() => onSelectWorkspace?.()}
          title={workspacePath}
          type="button"
          variant="ghost"
        >
          <FolderSimple aria-hidden="true" size={16} weight="regular" />
          <span>{workspaceName}</span>
        </Button>
        <div className="oa-sidebar__project-tasks">
          {projectThreads.map((thread) => (
            <Button
              className={`oa-sidebar__conversation${
                thread.id === activeThreadId
                  ? " oa-sidebar__conversation--active"
                  : ""
              }`}
              key={thread.id}
              onClick={() => onSelectThread?.(thread.id)}
              type="button"
              variant="ghost"
            >
              <span>{thread.title}</span>
              {thread.id === activeThreadId ? <i aria-label="当前会话" /> : null}
            </Button>
          ))}
          {projectThreads.length === 0 ? (
            <span className="oa-sidebar__empty oa-sidebar__empty--nested">
              暂无会话
            </span>
          ) : null}
        </div>
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
        <span className="oa-sidebar__empty">暂无其他项目会话</span>
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
  action,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section
      className={["oa-sidebar__section", className].filter(Boolean).join(" ")}
    >
      <div className="oa-sidebar__section-header">
        <h2>{label}</h2>
        {action}
      </div>
      <div>{children}</div>
    </section>
  );
}

import { FileVersionTracker } from "./file-version-tracker";
import { WorkspacePolicy } from "./workspace-policy";

export type ToolFactoryContext = {
  workspace: WorkspacePolicy;
  versions: FileVersionTracker;
  requireApproval: boolean;
};

export async function createToolFactoryContext(
  workspaceRoot: string,
  requireApproval = true,
): Promise<ToolFactoryContext> {
  return {
    workspace: await WorkspacePolicy.create(workspaceRoot),
    versions: new FileVersionTracker(),
    requireApproval,
  };
}

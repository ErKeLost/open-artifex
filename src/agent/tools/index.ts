import type { ToolFactoryContext } from "../core/tool-context";
import { createApplyPatchTool } from "./apply-patch";
import { createBashTool } from "./bash";
import { createEditTool } from "./edit";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";
import { createReadTool } from "./read";
import { createWriteTool } from "./write";

export function createCodingTools(context: ToolFactoryContext) {
  return {
    read: createReadTool(context),
    glob: createGlobTool(context),
    grep: createGrepTool(context),
    edit: createEditTool(context),
    write: createWriteTool(context),
    apply_patch: createApplyPatchTool(context),
    bash: createBashTool(context),
  };
}

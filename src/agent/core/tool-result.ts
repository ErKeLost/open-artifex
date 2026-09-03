import { z } from "zod";

export const toolResultSchema = z.object({
  title: z.string(),
  output: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  diff: z.string().optional(),
});

export type ToolResult = z.infer<typeof toolResultSchema>;

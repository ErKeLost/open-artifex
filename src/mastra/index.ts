import { Mastra } from "@mastra/core";
import { openArtifexAgent } from "./agent";
import storage from "./storage";

export const mastra = new Mastra({
  storage,
  agents: {
    openArtifexAgent,
  },
});

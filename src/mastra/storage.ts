import { LibSQLStore } from "@mastra/libsql";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dataDirectory } from "./paths";

mkdirSync(dataDirectory, { recursive: true });

const databaseUrl = pathToFileURL(
  path.join(dataDirectory, "open-artifex.db"),
).href;

const storage = new LibSQLStore({
  id: "open-artifex-storage",
  url: databaseUrl,
});

export default storage;

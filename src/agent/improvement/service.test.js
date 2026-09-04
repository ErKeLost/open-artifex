import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { MastraStorageExporter, Observability } from "@mastra/observability";
import { ImprovementService } from "./service.js";

const resources = [];
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    resources.splice(0).map(async (mastra) => {
      await mastra.observability.flush();
      await mastra.shutdown();
    }),
  );
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function createService() {
  const directory = mkdtempSync(path.join(tmpdir(), "open-artifex-improvement-"));
  temporaryDirectories.push(directory);
  const storage = new LibSQLStore({
    id: `improvement-service-test-${Date.now()}`,
    url: pathToFileURL(path.join(directory, "state.db")).href,
  });
  await storage.init();
  let mastra;
  const unavailableModel = {
    generate: async () => {
      throw new Error("model generation is not expected in this test");
    },
  };
  const service = new ImprovementService({
    getMastra: () => mastra,
    storage,
    analyst: unavailableModel,
    evaluator: unavailableModel,
  });
  mastra = new Mastra({
    storage,
    workflows: service.workflows,
    observability: new Observability({
      configs: {
        default: {
          serviceName: "improvement-service-test",
          exporters: [new MastraStorageExporter()],
        },
      },
    }),
  });
  resources.push(mastra);
  return service;
}

describe("ImprovementService", () => {
  test("persists a redacted real workflow trace through Mastra storage", async () => {
    const service = await createService();

    const captured = await service.captureRun({
      id: "run-1",
      threadId: "thread-1",
      model: "provider/model",
      status: "completed",
      promptExcerpt: "Use api_key=[redacted]",
      answerExcerpt: "Completed safely",
      toolNames: ["read"],
      toolCount: 1,
      failedToolCount: 0,
      createdAt: 1,
    });

    expect(captured?.traceId).toBeString();
    expect((await service.snapshot()).traces).toEqual([captured]);
  });

  test("requires an explicit workflow resume before publishing or rolling back", async () => {
    const service = await createService();
    const trace = await service.captureRun({
      id: "run-publication",
      threadId: "thread-publication",
      model: "provider/model",
      status: "completed",
      promptExcerpt: "Review the changed files",
      toolNames: ["read"],
      toolCount: 1,
      failedToolCount: 0,
      createdAt: 2,
    });
    await service.repository.saveCandidate({
      id: "candidate-1",
      traceId: trace.traceId,
      title: "Require verification evidence",
      summary: "Keep reports tied to completed checks.",
      instruction: "Report only verified command or test outcomes.",
      status: "ready",
      createdAt: 3,
      updatedAt: 3,
      feedbackCount: 1,
      evaluation: {
        id: "evaluation-1",
        score: 0.9,
        passed: true,
        rationale: "The instruction is scoped and reversible.",
        checkedAt: 3,
        experimentId: "experiment-1",
      },
    });

    const awaiting = await service.requestPublication("candidate-1");
    expect(awaiting.status).toBe("awaiting-approval");
    expect(await service.repository.activeCandidateId()).toBeUndefined();

    const published = await service.resolvePublication("candidate-1", true);
    expect(published.status).toBe("published");
    expect(await service.repository.activeCandidateId()).toBe("candidate-1");

    const rolledBack = await service.rollback("candidate-1");
    expect(rolledBack.status).toBe("rolled-back");
    expect(await service.repository.activeCandidateId()).toBeUndefined();
  });
});

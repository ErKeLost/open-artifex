import { describe, expect, test } from "bun:test";
import { redactForImprovement } from "./redaction.js";

describe("redactForImprovement", () => {
  test("removes common credential-shaped values before persistence", () => {
    const value = redactForImprovement(
      "Authorization: Bearer sk-or-v1-abcdefghijklmnopqrstuv api_key=secret-value password: hunter2",
      4_000,
    );

    expect(value).not.toContain("sk-or-v1-abcdefghijklmnopqrstuv");
    expect(value).not.toContain("secret-value");
    expect(value).not.toContain("hunter2");
    expect(value).toContain("[redacted]");
  });

  test("bounds persisted excerpts without splitting the redaction policy", () => {
    expect(redactForImprovement("a".repeat(100), 12)).toBe("aaaaaaaaa...");
  });
});

import { describe, expect, it } from "vitest";
import { denoiseTurn } from "../src/refine/denoise.js";
import type { RawTurn } from "../src/refine/types.js";

describe("denoiseTurn", () => {
  it("compresses user intent and preserves assistant conclusion", () => {
    const turn: RawTurn = {
      turnId: 7,
      timestamp: "2026-07-07T10:00:00Z",
      user: "Can you fix the auth bug? The login fails on Safari.",
      agentText: "Decision: use httpOnly cookie instead of localStorage.\n\nI'll investigate the Safari auth issue.",
      agent: "Decision: use httpOnly cookie instead of localStorage.\n\nI'll investigate the Safari auth issue.",
      actions: [
        { name: "read_file", args: { path: "src/auth.ts" } },
        { name: "tool", args: {}, result: "file content here" },
      ],
    };

    const denoised = denoiseTurn(turn, { sessionId: "session-A", source: "fold" });

    expect(denoised.turnId).toBe(7);
    expect(denoised.sessionId).toBe("session-A");
    expect(denoised.source).toBe("fold");
    expect(denoised.userIntent).toContain("fix the auth bug");
    expect(denoised.assistantConclusion).toContain("httpOnly cookie");
    expect(denoised.toolsCalled).toHaveLength(2);
    expect(denoised.toolsCalled[0]).toEqual({ name: "read_file", args: { path: "src/auth.ts" } });
    expect(denoised.files).toContain("src/auth.ts");
    expect(denoised.rawTurnId).toBe(7);
  });

  it("drops verbose tool results while keeping tool names", () => {
    const turn: RawTurn = {
      turnId: 3,
      user: "Show me the logs.",
      agentText: "Here are the recent logs.",
      actions: [
        { name: "run_command", args: { command: "cat logs.txt" }, result: "\n".repeat(5000) },
      ],
    };

    const denoised = denoiseTurn(turn, { sessionId: "session-B", source: "search" });

    expect(denoised.toolsCalled[0]!.name).toBe("run_command");
    expect(denoised.toolsCalled[0]!.args).toEqual({ command: "cat logs.txt" });
    expect(denoised.toolsCalled[0]!.result).toBeUndefined();
  });

  it("extracts file and error entities", () => {
    const turn: RawTurn = {
      turnId: 5,
      user: "Debug build.",
      agentText: "Build failed.",
      actions: [
        { name: "read_file", args: { path: "src/index.ts" }, result: "ERROR: Module not found" },
      ],
    };

    const denoised = denoiseTurn(turn, { sessionId: "session-C", source: "fold" });

    expect(denoised.files).toContain("src/index.ts");
    expect(denoised.errors.length).toBeGreaterThan(0);
    expect(denoised.errors[0]).toContain("ERROR");
  });
});

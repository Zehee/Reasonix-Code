import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendSessionMessage, sessionPath } from "../src/memory/session.js";
import { ToolRegistry } from "../src/tools.js";
import { registerRefineTools } from "../src/tools/refine.js";

describe("load_turns_context", () => {
  let tmp: string;
  const realHome = process.env.USERPROFILE ?? process.env.HOME;
  let registry: ToolRegistry;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "reasonix-load-turns-"));
    vi.stubEnv("USERPROFILE", tmp);
    vi.stubEnv("HOME", tmp);
    registry = new ToolRegistry();
    registerRefineTools(registry);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (realHome) {
      process.env.USERPROFILE = realHome;
      process.env.HOME = realHome;
    }
  });

  it("returns full messages by default", async () => {
    appendSessionMessage("test", { role: "user", content: "fix auth" });
    appendSessionMessage("test", {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"src/auth.ts"}' },
        },
      ],
    });
    appendSessionMessage("test", {
      role: "tool",
      content: "export function auth() {}",
      tool_call_id: "call-1",
    });

    const tool = registry.get("load_turns_context")!;
    const result = JSON.parse(
      await tool.fn({ references: [{ sessionName: "test", turnId: 1 }] }, undefined),
    );

    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].messages).toHaveLength(3);
    expect(result.rounds[0].messages.map((m: { role: string }) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);
  });

  it("mode=material returns only tool calls and tool results", async () => {
    appendSessionMessage("test", { role: "user", content: "fix auth" });
    appendSessionMessage("test", {
      role: "assistant",
      content: "let me read the file",
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"src/auth.ts"}' },
        },
      ],
    });
    appendSessionMessage("test", {
      role: "tool",
      content: "export function auth() {}",
      tool_call_id: "call-1",
    });

    const tool = registry.get("load_turns_context")!;
    const result = JSON.parse(
      await tool.fn(
        { references: [{ sessionName: "test", turnId: 1 }], mode: "material" },
        undefined,
      ),
    );

    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].messages).toHaveLength(2);
    expect(result.rounds[0].messages[0].role).toBe("assistant");
    expect(result.rounds[0].messages[0].tool_calls).toHaveLength(1);
    expect(result.rounds[0].messages[1].role).toBe("tool");
  });

  it("restores archived tool results", async () => {
    appendSessionMessage("test", { role: "user", content: "fix auth" });
    appendSessionMessage("test", {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"src/auth.ts"}' },
        },
      ],
    });
    appendSessionMessage("test", {
      role: "tool",
      content: "[archived: read_file (1234 chars, 45 lines) — 已降噪]",
      tool_call_id: "call-1",
    });

    const cachePath = `${sessionPath("test")}.toolcache.jsonl`;
    writeFileSync(
      cachePath,
      `${JSON.stringify({
        toolCallId: "call-1",
        content: "export const auth = () => {};",
      })}\n`,
    );

    const tool = registry.get("load_turns_context")!;
    const result = JSON.parse(
      await tool.fn(
        { references: [{ sessionName: "test", turnId: 1 }], mode: "material" },
        undefined,
      ),
    );

    const toolMsg = result.rounds[0].messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMsg.content).toBe("export const auth = () => {};");
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../src/types.js";

async function loadManager() {
  const { RefinedManager } = await import("../src/refine/refined-manager");
  const { registerRefineTools } = await import("../src/tools/refine");
  const { ToolRegistry } = await import("../src/tools");
  return { RefinedManager, registerRefineTools, ToolRegistry };
}

const sampleMessages: ChatMessage[] = [
  { role: "user", content: "auth bug: login fails on Safari" },
  { role: "assistant", content: "Decision: use httpOnly cookie." },
  { role: "user", content: "progress 100% done" },
  { role: "user", content: "path: a\\b\\c" },
  { role: "user", content: "underscore_value" },
];

describe("refine-store: SQL LIKE escaping", () => {
  let tmp: string;
  let counter = 0;
  beforeEach(() => {
    counter++;
    tmp = mkdtempSync(join(tmpdir(), `reasonix-refine-${counter}-`));
    process.env.REASONIX_WORKSPACE = tmp;
    process.env.HOME = tmp;
    process.env.USERPROFILE = tmp;
  });
  afterEach(() => {
    process.env.REASONIX_WORKSPACE = undefined;
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* Windows locks SQLite file; OS will reclaim */
    }
  });

  it("finds a turn whose summary contains a literal backslash", async () => {
    const { RefinedManager, registerRefineTools, ToolRegistry } = await loadManager();
    const refinedRoot = join(tmp, "refined");
    const manager = new RefinedManager(refinedRoot);
    await manager.saveDenoisedTurns([
      {
        turnId: 1,
        timestamp: "2026-07-07T10:00:00Z",
        sessionId: "sess-1",
        sessionName: "sess-1",
        summary: "Decided on path a\\b\\c",
        facts: [],
        intent: "fix path handling",
        conclusion: "use path.join",
        toolsCalled: [],
        files: [],
        rawTurnId: 1,
      },
    ]);

    const registry = new ToolRegistry();
    registerRefineTools(registry);
    const res = await registry.dispatch(
      "search_context",
      JSON.stringify({ query: "a\\b\\c", limit: 10 }),
    );
    expect(res.toLowerCase()).toContain("a\\b\\c");
  });

  it("does not treat % and _ as wildcards when searching", async () => {
    const { RefinedManager, registerRefineTools, ToolRegistry } = await loadManager();
    const refinedRoot = join(tmp, "refined2");
    const manager = new RefinedManager(refinedRoot);
    await manager.saveDenoisedTurns([
      {
        turnId: 1,
        timestamp: "2026-07-07T10:00:00Z",
        sessionId: "sess-2",
        sessionName: "sess-2",
        summary: "100% complete",
        facts: [],
        intent: "finish task",
        conclusion: "done",
        toolsCalled: [],
        files: [],
        rawTurnId: 1,
      },
    ]);

    const registry = new ToolRegistry();
    registerRefineTools(registry);
    const res = await registry.dispatch(
      "search_context",
      JSON.stringify({ query: "100%", limit: 10 }),
    );
    expect(res.toLowerCase()).toContain("100%");
  });
});

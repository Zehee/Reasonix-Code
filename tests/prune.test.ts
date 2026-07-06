import { describe, expect, it } from "vitest";
import { pruneStaleToolResults } from "../src/context-manager.js";
import type { ChatMessage } from "../src/types.js";

describe("pruneStaleToolResults", () => {
  function toolMsg(content: string, name?: string): ChatMessage {
    return { role: "tool", content, name };
  }

  it("leaves small tool results untouched", () => {
    const msgs: ChatMessage[] = [toolMsg("ok")];
    const saved = pruneStaleToolResults(msgs, 1024);
    expect(saved).toBe(0);
    expect(msgs[0]!.content).toBe("ok");
  });

  it("prunes large tool results", () => {
    const large = "x".repeat(2000);
    const msgs: ChatMessage[] = [toolMsg(large, "read_file")];
    const saved = pruneStaleToolResults(msgs, 1024);
    expect(saved).toBeGreaterThan(0);
    expect(msgs[0]!.content).toContain("[elided tool result — read_file");
    expect(msgs[0]!.content!.length).toBeLessThan(200);
  });

  it("skips already-pruned messages", () => {
    const msgs: ChatMessage[] = [
      toolMsg("[elided tool result — read_file, 2000 bytes dropped — re-run if data is needed again]", "read_file"),
    ];
    const saved = pruneStaleToolResults(msgs, 1024);
    expect(saved).toBe(0);
  });

  it("prunes multiple large results", () => {
    const msgs: ChatMessage[] = [
      toolMsg("a".repeat(2000), "read_file"),
      toolMsg("b".repeat(3000), "search_content"),
      toolMsg("small"),
    ];
    const saved = pruneStaleToolResults(msgs, 1024);
    expect(saved).toBeGreaterThan(0);
    expect(msgs[0]!.content!.length).toBeLessThan(200);
    expect(msgs[1]!.content!.length).toBeLessThan(200);
    expect(msgs[2]!.content).toBe("small");
  });

  it("skips non-tool messages", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "x".repeat(2000) },
      { role: "assistant", content: "y".repeat(2000) },
    ];
    const saved = pruneStaleToolResults(msgs, 1024);
    expect(saved).toBe(0);
  });
});

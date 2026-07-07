import { describe, expect, it, vi } from "vitest";
import { DeepSeekClient } from "../src/client.js";
import { CacheFirstLoop } from "../src/loop.js";
import { ImmutablePrefix } from "../src/memory/runtime.js";

function abortableNeverFetch(): typeof fetch {
  return vi.fn((_url: unknown, init: { signal?: AbortSignal } | undefined) => {
    const signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  }) as unknown as typeof fetch;
}

function seedTurns(loop: CacheFirstLoop, n: number): void {
  for (let i = 0; i < n; i++) {
    loop.log.append({
      role: "user",
      content: `question ${i}: ${"context padding for fold timeout regression ".repeat(8)}`,
    });
    loop.log.append({
      role: "assistant",
      content: `answer ${i}: ${"more context padding for fold timeout regression ".repeat(8)}`,
    });
  }
}

describe("ContextManager fold timeout", () => {
  it("falls back to the deterministic cluster summary when the summarizer request hangs", async () => {
    const prevTimeout = process.env.REASONIX_FOLD_SUMMARY_TIMEOUT_MS;
    process.env.REASONIX_FOLD_SUMMARY_TIMEOUT_MS = "50";
    try {
      const client = new DeepSeekClient({ apiKey: "sk-test", fetch: abortableNeverFetch() });
      const loop = new CacheFirstLoop({
        client,
        prefix: new ImmutablePrefix({ system: "s" }),
        stream: false,
      });
      seedTurns(loop, 6);
      const beforeMessages = loop.log.length;

      const result = await loop.compactHistory({ keepRecentTokens: 40 });

      expect(result).toMatchObject({
        folded: true,
        beforeMessages,
        afterMessages: expect.any(Number),
        summaryChars: expect.any(Number),
      });
      // The log is rewritten with the cluster-based fallback summary.
      const hasSummary = loop.log.entries.some(
        (m) => typeof m.content === "string" && m.content.includes("HISTORY SUMMARY"),
      );
      const hasClusters = loop.log.entries.some(
        (m) => typeof m.content === "string" && m.content.includes("Decision clusters:"),
      );
      expect(hasSummary).toBe(true);
      expect(hasClusters).toBe(true);
    } finally {
      if (prevTimeout === undefined) {
        process.env.REASONIX_FOLD_SUMMARY_TIMEOUT_MS = undefined;
      } else {
        process.env.REASONIX_FOLD_SUMMARY_TIMEOUT_MS = prevTimeout;
      }
    }
  }, 5_000);
});

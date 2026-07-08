import { describe, expect, it, vi } from "vitest";
import { DeepSeekClient } from "../src/client.js";
import { CacheFirstLoop } from "../src/loop.js";
import { ImmutablePrefix } from "../src/memory/runtime.js";

interface FakeResponseShape {
  content?: string;
  reasoning_content?: string;
}

function fakeFetch(responses: FakeResponseShape[]): typeof fetch {
  let i = 0;
  return vi.fn(async (_url: unknown, _init: { body?: string } | undefined) => {
    const resp = responses[i++] ?? responses[responses.length - 1]!;
    return new Response(
      JSON.stringify({
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: resp.content ?? "",
              reasoning_content: resp.reasoning_content,
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

function makeClient(responses: FakeResponseShape[]) {
  return new DeepSeekClient({ apiKey: "sk-test", fetch: fakeFetch(responses) });
}

function findSummary(entries: readonly { content?: string | null; role?: string }[]):
  | {
      content?: string | null;
      role?: string;
      reasoning_content?: string | null;
    }
  | undefined {
  return entries.find(
    (m) =>
      m.role === "assistant" && typeof m.content === "string" && m.content.startsWith("<!-- fold:"),
  );
}

function seedTurns(loop: CacheFirstLoop, n: number): void {
  for (let i = 0; i < n; i++) {
    loop.log.append({ role: "user", content: `q${i} bulk text padding to weigh the turn` });
    loop.log.append({
      role: "assistant",
      content: `a${i} bulk text padding to weigh the turn`,
      reasoning_content: `r${i} thinking trace`,
    });
  }
}

describe("ContextManager fold preserves reasoning_content for thinking-mode (#1042)", () => {
  it("stamps reasoning_content on the epoch summary when the summarizer returns it", async () => {
    const client = makeClient([
      { content: "epoch summary for second fold.", reasoning_content: "thought" },
    ]);
    const loop = new CacheFirstLoop({
      client,
      prefix: new ImmutablePrefix({ system: "s" }),
      model: "deepseek-v4-flash",
      stream: false,
    });
    seedTurns(loop, 8);
    const r1 = await loop.compactHistory({ keepRecentTokens: 40 });
    expect(r1.folded).toBe(true);
    expect(findSummary(loop.log.entries)).toBeUndefined();

    seedTurns(loop, 8);
    const r2 = await loop.compactHistory({ keepRecentTokens: 40 });
    expect(r2.folded).toBe(true);

    const head = findSummary(loop.log.entries)!;
    expect(head.role).toBe("assistant");
    expect(head.content).toMatch(/<!-- fold:/);
    expect(head.reasoning_content).toBeDefined();
    expect(head.reasoning_content).toBe("thought");
  });

  it("omits reasoning_content when the summarizer response omitted it (Go v2 omits empty fields)", async () => {
    const client = makeClient([{ content: "epoch summary for second fold." }]);
    const loop = new CacheFirstLoop({
      client,
      prefix: new ImmutablePrefix({ system: "s" }),
      model: "deepseek-v4-flash",
      stream: false,
    });
    seedTurns(loop, 8);
    await loop.compactHistory({ keepRecentTokens: 40 });
    seedTurns(loop, 8);
    await loop.compactHistory({ keepRecentTokens: 40 });

    const head = findSummary(loop.log.entries)!;
    expect(head.reasoning_content).toBeUndefined();
  });

  it("omits reasoning_content for non-thinking-mode session models when summarizer returned none", async () => {
    const client = makeClient([{ content: "epoch summary for second fold." }]);
    const loop = new CacheFirstLoop({
      client,
      prefix: new ImmutablePrefix({ system: "s" }),
      model: "deepseek-chat",
      stream: false,
    });
    seedTurns(loop, 8);
    await loop.compactHistory({ keepRecentTokens: 40 });
    seedTurns(loop, 8);
    await loop.compactHistory({ keepRecentTokens: 40 });

    const head = findSummary(loop.log.entries)!;
    expect(head.reasoning_content).toBeUndefined();
  });
});

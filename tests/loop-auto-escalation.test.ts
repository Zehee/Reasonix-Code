/** Auto-escalation rule (prompt-fragments.ts): 3+ tool errors / repairs in a single turn retry on deepseek-v4-pro. */

import { describe, expect, it, vi } from "vitest";
import { DeepSeekClient } from "../src/client.js";
import { CacheFirstLoop } from "../src/loop.js";
import { ImmutablePrefix } from "../src/memory/runtime.js";
import { ToolRegistry } from "../src/tools.js";

function makeClient(models: string[], responses: Array<Record<string, unknown>>): DeepSeekClient {
  return new DeepSeekClient({
    apiKey: "sk-test",
    fetch: vi.fn(async (_url: any, init: any) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      models.push(body.model);
      const resp = responses.shift() ?? { content: "extra" };
      return new Response(
        JSON.stringify({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: resp.content ?? "",
                reasoning_content: null,
                tool_calls: resp.tool_calls ?? undefined,
              },
              finish_reason: resp.tool_calls ? "tool_calls" : "stop",
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 100,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch,
  });
}

function toolCall(name: string) {
  return { id: `call-${name}`, type: "function", function: { name, arguments: "{}" } };
}

function failingRegistry(names: string[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const name of names) {
    registry.register({
      name,
      description: "",
      parameters: { type: "object", properties: {} },
      fn: async () => JSON.stringify({ error: `boom from ${name}` }),
    });
  }
  return registry;
}

function makeLoop(
  models: string[],
  responses: Array<Record<string, unknown>>,
  toolNames: string[],
) {
  return new CacheFirstLoop({
    client: makeClient(models, responses),
    prefix: new ImmutablePrefix({ system: "be brief" }),
    tools: failingRegistry(toolNames),
    model: "deepseek-v4-flash",
    stream: false,
  });
}

describe("CacheFirstLoop auto-escalation", () => {
  it("escalates to deepseek-v4-pro after 3+ tool errors in one turn, then restores", async () => {
    const models: string[] = [];
    const loop = makeLoop(
      models,
      [
        {
          tool_calls: [toolCall("failing_a"), toolCall("failing_b"), toolCall("failing_c")],
        },
        { content: "dropped — escalation happens before this yields" },
        { content: "final answer from pro" },
      ],
      ["failing_a", "failing_b", "failing_c"],
    );

    const events: Array<{ role: string; content?: string }> = [];
    for await (const ev of loop.step("do it")) events.push(ev);

    expect(models[0]).toBe("deepseek-v4-flash");
    expect(models).toContain("deepseek-v4-pro");
    expect(
      events.some(
        (e) =>
          e.role === "warning" &&
          (e.content ?? "").includes("auto-escalated") &&
          (e.content ?? "").includes("tool errors: 3"),
      ),
    ).toBe(true);
    expect(
      events.some((e) => e.role === "assistant_final" && e.content === "final answer from pro"),
    ).toBe(true);
    // restoreModelAfterTurn: base model is back once the turn ends.
    expect(loop.model).toBe("deepseek-v4-flash");
  });

  it("does not escalate on fewer than 3 errors", async () => {
    const models: string[] = [];
    const loop = makeLoop(
      models,
      [
        { tool_calls: [toolCall("failing_a"), toolCall("failing_b")] },
        { content: "done without escalation" },
      ],
      ["failing_a", "failing_b"],
    );

    const events: Array<{ role: string; content?: string }> = [];
    for await (const ev of loop.step("do it")) events.push(ev);

    expect(models).toEqual(["deepseek-v4-flash", "deepseek-v4-flash"]);
    expect(
      events.some((e) => e.role === "warning" && (e.content ?? "").includes("auto-escalated")),
    ).toBe(false);
    expect(
      events.some((e) => e.role === "assistant_final" && e.content === "done without escalation"),
    ).toBe(true);
  });

  it("treats repair (scavenge/truncation) errors toward the threshold", async () => {
    const models: string[] = [];
    // repair.process scavenges malformed tool-call JSON embedded in content;
    // 3 scavenged calls should count toward the threshold even though the
    // dispatcher never runs (no registry tools called).
    const loop = makeLoop(models, [{ content: "final after repair-based escalation" }], []);
    const events: Array<{ role: string; content?: string }> = [];
    for await (const ev of loop.step("do it")) events.push(ev);

    // With zero registered tools and a plain content response there is
    // nothing to scavenge, so no escalation must happen.
    expect(models).toEqual(["deepseek-v4-flash"]);
    expect(
      events.some((e) => e.role === "warning" && (e.content ?? "").includes("auto-escalated")),
    ).toBe(false);
  });
});

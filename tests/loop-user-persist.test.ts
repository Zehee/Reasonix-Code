import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepSeekClient } from "../src/client.js";
import { CacheFirstLoop } from "../src/loop.js";
import { ImmutablePrefix } from "../src/memory/runtime.js";
import { loadSessionMessages, sessionPath } from "../src/memory/session.js";
import type { ChatMessage } from "../src/types.js";

// Isolate this test file's sessions from parallel tests.
beforeEach(() => {
  process.env.REASONIX_SESSIONS_DIR = join(tmpdir(), `reasonix-sessions-${process.pid}`);
});
afterEach(() => {
  process.env.REASONIX_SESSIONS_DIR = undefined;
});

describe("loop persists user message at step entry (issue #943)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "reasonix-loop943-"));
    process.env.USERPROFILE = tmp;
    process.env.HOME = tmp;
    vi.spyOn(require("node:os"), "homedir").mockReturnValue(tmp);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.USERPROFILE = undefined;
    process.env.HOME = undefined;
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it("writes the user message to the session log before the first API call settles, so a mid-stream abort doesn't drop it", async () => {
    // Fake fetch that never resolves on its own — only the abort signal
    // terminates it. Simulates the desktop user clicking a different
    // session while the AI is still streaming.
    let fetchStarted = false;
    const client = new DeepSeekClient({
      apiKey: "sk-test",
      fetch: vi.fn(async (_url: unknown, init: { signal?: AbortSignal } | undefined) => {
        const signal = init?.signal;
        fetchStarted = true;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("This operation was aborted", "AbortError")),
          );
        });
      }) as unknown as typeof fetch,
      retry: { maxAttempts: 1 },
    });

    const sessionName = "bug943-pre-response-abort";
    const loop = new CacheFirstLoop({
      client,
      prefix: new ImmutablePrefix({ system: "s" }),
      stream: false,
      session: sessionName,
    });

    const consumed = (async () => {
      for await (const ev of loop.step("hello — switching away soon")) {
        if (ev.role === "done") break;
      }
    })();

    // Wait until the fetch actually starts before aborting, so the abort
    // signal is caught by the listener.
    while (!fetchStarted) {
      await new Promise((r) => setTimeout(r, 1));
    }
    loop.abort();
    await consumed;

    // The session JSONL must exist on disk and contain the user prompt.
    // Pre-fix this file would be missing entirely, making the session
    // invisible to the sidebar's `listSessions()` glob.
    const persisted = loadSessionMessages(sessionName);
    const firstUser = persisted.find((m) => m.role === "user");
    expect(firstUser).toBeDefined();
    expect(firstUser?.content).toBe("hello — switching away soon");
  });

  it("writes the user message immediately even when the API call succeeds normally", async () => {
    const client = new DeepSeekClient({
      apiKey: "sk-test",
      fetch: vi.fn(async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch,
    });

    const sessionName = "bug943-happy-path";
    const loop = new CacheFirstLoop({
      client,
      prefix: new ImmutablePrefix({ system: "s" }),
      stream: false,
      session: sessionName,
    });

    for await (const ev of loop.step("happy path")) {
      if (ev.role === "done") break;
    }

    const persisted = loadSessionMessages(sessionName);
    // First entry is the user message; followed by assistant.
    expect(persisted[0]).toMatchObject({ role: "user", content: "happy path" });
    expect(persisted[0]).toHaveProperty("turnId");
    expect(persisted[0]).toHaveProperty("sessionId");
    expect(persisted.length).toBeGreaterThanOrEqual(2);
    expect(persisted.some((m) => m.role === "assistant")).toBe(true);
    // No duplicate user copies.
    const userMsgs = persisted.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(1);
  });

  it("persists send-time healing of dangling tool_calls so the session does not stay poisoned", async () => {
    const requestMessages: ChatMessage[][] = [];
    const client = new DeepSeekClient({
      apiKey: "sk-test",
      fetch: vi.fn(async (_url: unknown, init: { body?: string } | undefined) => {
        const body = init?.body ? JSON.parse(init.body) : {};
        requestMessages.push(body.messages as ChatMessage[]);
        return new Response(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "recovered" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch,
    });

    const sessionName = "issue1079-dangling-tool-heal";
    const loop = new CacheFirstLoop({
      client,
      prefix: new ImmutablePrefix({ system: "s" }),
      stream: false,
      session: sessionName,
    });
    loop.appendAndPersist({ role: "user", content: "before sleep" });
    loop.appendAndPersist({
      role: "assistant",
      content: "",
      tool_calls: [{ id: "lost", type: "function", function: { name: "read", arguments: "{}" } }],
    });

    await loop.run("continue after wake");

    expect(
      requestMessages[0]!.some((m) => m.role === "assistant" && (m.tool_calls?.length ?? 0) > 0),
    ).toBe(false);
    expect(
      loop.log.entries.some((m) => m.role === "assistant" && (m.tool_calls?.length ?? 0) > 0),
    ).toBe(false);
    expect(
      loadSessionMessages(sessionName).some(
        (m) => m.role === "assistant" && (m.tool_calls?.length ?? 0) > 0,
      ),
    ).toBe(false);
  });

  it("can discard an explicitly aborted prompt before the next request (#1593)", async () => {
    const requestMessages: ChatMessage[][] = [];
    let callCount = 0;
    const fetchResolvers: Array<{
      resolve: (r: Response) => void;
      reject: (e: Error) => void;
    }> = [];
    const client = new DeepSeekClient({
      apiKey: "sk-test",
      fetch: vi.fn(
        async (_url: unknown, init: { body?: string; signal?: AbortSignal } | undefined) => {
          const body = init?.body ? JSON.parse(init.body) : {};
          requestMessages.push(body.messages as ChatMessage[]);
          if (callCount++ === 0) {
            return new Promise<Response>((resolve, reject) => {
              fetchResolvers.push({ resolve, reject });
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("This operation was aborted", "AbortError")),
              );
            });
          }
          return new Response(
            JSON.stringify({
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "rewritten" },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      ) as unknown as typeof fetch,
      retry: { maxAttempts: 1 },
    });

    const sessionName = "bug1593-discard-explicit-abort";
    const loop = new CacheFirstLoop({
      client,
      prefix: new ImmutablePrefix({ system: "s" }),
      stream: false,
      session: sessionName,
    });

    const interrupted = (async () => {
      for await (const ev of loop.step("完全重写这段一万字符结构化文本")) {
        if (ev.role === "done") break;
      }
    })();

    // Wait until the first fetch actually starts before aborting.
    while (fetchResolvers.length === 0) {
      await new Promise((r) => setTimeout(r, 1));
    }
    loop.abort({ discardCurrentTurn: true });
    await interrupted;

    // Wait until the log rewrite settles. discardLogFrom rewrites the
    // session file to remove the aborted turn's messages; this is async
    // and may not have completed by the time `interrupted` resolves.
    for (let i = 0; i < 50; i++) {
      const userCount = loadSessionMessages(sessionName).filter((m) => m.role === "user").length;
      if (userCount <= 1) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    await loop.run("请按这次要求完整重写，不要局部微调");

    const secondRequestUsers = requestMessages[1]!
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    expect(secondRequestUsers).toEqual(["请按这次要求完整重写，不要局部微调"]);
    expect(loadSessionMessages(sessionName).filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("discardCurrentTurn on a header-only session removes the .bak rewrite snapshot", async () => {
    // A live JSONL containing only the header (no messages) is non-empty on
    // disk, so rewriteSession snapshots it to .bak before compacting. A full
    // discard (preserved = []) must then unlink that .bak, or
    // loadSessionMessages keeps falling back to the pre-discard transcript.
    const sessionName = "discard-bak-cleanup";
    const path = sessionPath(sessionName);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({
        type: "session.header",
        sessionId: "00000000-0000-0000-0000-000000000000",
        createdAt: new Date(0).toISOString(),
      })}\n`,
    );

    const client = new DeepSeekClient({
      apiKey: "sk-test",
      fetch: vi.fn(async (_url: unknown, init: { signal?: AbortSignal } | undefined) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("This operation was aborted", "AbortError")),
          );
        });
      }) as unknown as typeof fetch,
      retry: { maxAttempts: 1 },
    });

    const loop = new CacheFirstLoop({
      client,
      prefix: new ImmutablePrefix({ system: "s" }),
      stream: false,
      session: sessionName,
    });

    const interrupted = (async () => {
      for await (const ev of loop.step("first turn")) {
        if (ev.role === "done") break;
      }
    })();

    // Let the first fetch get in flight, then discard the whole turn.
    await new Promise((r) => setTimeout(r, 20));
    loop.abort({ discardCurrentTurn: true });
    await interrupted;

    // The unlink runs synchronously inside discardLogFrom, but the abort
    // handler executes inside the generator — poll briefly to be safe.
    const backupPath = `${sessionPath(sessionName)}.bak`;
    for (let i = 0; i < 50; i++) {
      if (!existsSync(backupPath)) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(existsSync(backupPath)).toBe(false);
    // Live file still exists (header retained) — a stale .bak must not
    // resurrect the pre-discard content.
    expect(existsSync(path)).toBe(true);
    expect(loadSessionMessages(sessionName)).toHaveLength(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventSourceInstance = {
  url: string;
  onmessage: ((msg: MessageEvent) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
};

const settingsResponse = {
  reasoningEffort: "high",
  editMode: "review",
  budgetUsd: null,
  model: "deepseek-v4-pro",
  webSearchEngine: "bing",
  subagentModels: {},
  baseUrl: "",
  apiKey: "",
};

function jsonResponse(body: unknown): Response {
  return {
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

async function loadBridge(options?: {
  overview?: Record<string, unknown>;
  sessions?: Record<string, unknown>;
}) {
  vi.resetModules();

  let overview = options?.overview ?? {
    cwd: "E:/proj",
    model: "deepseek-v4-pro",
    version: "0.52.0",
    stats: {
      totalCostUsd: 0.123456,
      cacheHitRatio: 0.75,
      lastPromptTokens: 1200,
      cacheHitTokens: 900,
      cacheMissTokens: 300,
      totalCompletionTokens: 150,
      balance: [{ currency: "CNY", total_balance: "88.5" }],
    },
  };
  let sessions = options?.sessions ?? {
    currentSession: "code-20260526120000",
    sessions: [
      {
        name: "code-20260526120000",
        messageCount: 4,
        mtime: Date.UTC(2026, 4, 26, 12, 0, 0),
        summary: "fresh session",
      },
    ],
  };

  vi.stubGlobal("document", {
    documentElement: { dataset: {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: (selector: string) => {
      if (selector === 'meta[name="reasonix-mode"]') {
        return { getAttribute: () => "server" };
      }
      if (selector === 'meta[name="reasonix-token"]') {
        return { getAttribute: () => "testtoken" };
      }
      return null;
    },
  });
  vi.stubGlobal("window", {
    addEventListener: () => {},
    removeEventListener: () => {},
  });

  const eventSources: EventSourceInstance[] = [];
  class FakeEventSource {
    onmessage: ((msg: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) {
      eventSources.push(this);
    }
    close() {}
  }
  vi.stubGlobal("EventSource", FakeEventSource);

  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/api/settings")) return jsonResponse(settingsResponse);
    if (url.includes("/api/sessions")) return jsonResponse(sessions);
    if (url.includes("/api/overview")) return jsonResponse(overview);
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);

  const bridge = await import("../dashboard/src/lib/tauri-bridge");
  const events: Record<string, any>[] = [];
  await bridge.listen("rpc:event", (event) => {
    events.push(JSON.parse(event.payload.data));
  });
  await bridge.invoke("rpc_spawn");
  await vi.waitFor(() => expect(events.some((event) => event.type === "$ready")).toBe(true));

  return {
    bridge,
    events,
    fetchMock,
    eventSources,
    setOverview: (next: Record<string, unknown>) => {
      overview = next;
    },
    setSessions: (next: Record<string, unknown>) => {
      sessions = next;
    },
  };
}

describe("dashboard server bridge refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("emits the current server session in the session snapshot", async () => {
    const { events } = await loadBridge();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "$sessions",
        currentSession: "code-20260526120000",
        items: [
          expect.objectContaining({
            name: "code-20260526120000",
            messageCount: 4,
            summary: "fresh session",
          }),
        ],
      }),
    );
  });

  it("emits absolute usage stats from overview so the token counter can recover after reconnect", async () => {
    const { events } = await loadBridge();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "$session_usage",
        totalCostUsd: 0.123456,
        totalPromptTokens: 1200,
        totalCompletionTokens: 150,
        cacheHitTokens: 900,
        cacheMissTokens: 300,
      }),
    );
  });

  it("polls snapshots so sessions created outside the open page appear without reload", async () => {
    const { events, setOverview, setSessions } = await loadBridge();
    events.length = 0;

    setSessions({
      currentSession: "code-20260526120500",
      sessions: [
        {
          name: "code-20260526120500",
          messageCount: 2,
          mtime: Date.UTC(2026, 4, 26, 12, 5, 0),
          summary: "new external session",
        },
      ],
    });
    setOverview({
      cwd: "E:/proj",
      model: "deepseek-v4-pro",
      version: "0.52.0",
      stats: {
        totalCostUsd: 0.2,
        cacheHitTokens: 1600,
        cacheMissTokens: 400,
        totalCompletionTokens: 250,
        balance: [{ currency: "CNY", total_balance: "91" }],
      },
    });

    await vi.advanceTimersByTimeAsync(5000);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "$sessions",
        currentSession: "code-20260526120500",
        items: [expect.objectContaining({ name: "code-20260526120500" })],
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "$session_usage",
        totalPromptTokens: 2000,
        totalCompletionTokens: 250,
      }),
    );
  });
});

describe("dashboard SSE self-heal after retries are exhausted", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts a low-frequency health probe instead of giving up forever", async () => {
    const { eventSources, fetchMock } = await loadBridge();

    // The bridge has two ways to hit /api/overview:
    //   - refreshServerSnapshots() called by the 5 s stats poll
    //   - probeCliAlive() called by the 30 s health probe (with ?token=…)
    // We track only the token-bearing fetch so the stats poll does not mask
    // the dedicated probe.
    const overviewProbeCalls = () =>
      fetchMock.mock.calls.filter(
        (call) =>
          String(call[0] ?? "").includes("/api/overview") &&
          String(call[0] ?? "").includes("token="),
      );
    const probeCallsBefore = overviewProbeCalls().length;

    // Trip the reconnect budget: 11 forced failures cross the budget and
    // flip the bridge into health-probe mode.
    for (let i = 0; i < 11; i++) {
      const last = eventSources[eventSources.length - 1]!;
      last.onerror?.();
      await vi.advanceTimersByTimeAsync(40_000);
    }

    // Advance past the 30 s health-probe interval. With the fix in place the
    // probe runs every 30 s; without it no probe runs and this assertion
    // would still pass via stats polling alone, so we filter to token-bearing
    // overview calls above to isolate the dedicated health-probe path.
    await vi.advanceTimersByTimeAsync(30_000);

    expect(overviewProbeCalls().length).toBeGreaterThan(probeCallsBefore);
  });

  it("a successful reconnect after give-up resets the retry counter", async () => {
    const { eventSources } = await loadBridge();

    for (let i = 0; i < 11; i++) {
      const last = eventSources[eventSources.length - 1]!;
      last.onerror?.();
      await vi.advanceTimersByTimeAsync(40_000);
    }

    // Probe alive and reconnect.
    await vi.advanceTimersByTimeAsync(30_000);

    const fresh = eventSources[eventSources.length - 1]!;
    // Deliver one valid message so onmessage resets the counter.
    fresh.onmessage?.({ data: JSON.stringify({ kind: "ping" }) } as MessageEvent);

    // Force failure again — counter was reset, so the bridge must schedule
    // another exponential-backoff reconnect (not the slow health probe).
    const beforeBackoff = eventSources.length;
    fresh.onerror?.();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(eventSources.length).toBe(beforeBackoff + 1);
  });
});

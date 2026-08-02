import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventSourceInstance = {
  url: string;
  onmessage: ((msg: MessageEvent) => void) | null;
  onerror: ((err?: any) => void) | null;
  close: () => void;
};

function jsonResponse(body: unknown): Response {
  return { status: 200, text: async () => JSON.stringify(body) } as Response;
}

async function loadBridge(): Promise<{
  events: Array<Record<string, any>>;
  setActiveTabIdInBridge: (id: string) => void;
}> {
  vi.resetModules();
  vi.stubGlobal("document", {
    documentElement: { dataset: {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: (sel: string) => {
      if (sel === 'meta[name="reasonix-mode"]') return { getAttribute: () => "server" };
      if (sel === 'meta[name="reasonix-token"]') return { getAttribute: () => "testtoken" };
      return null;
    },
  });
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  const evs: EventSourceInstance[] = [];
  class FE {
    onmessage: ((m: MessageEvent) => void) | null = null;
    onerror: ((err?: any) => void) | null = null;
    constructor(public url: string) {
      evs.push(this);
      // Expose for tests that need to drive SSE events without going
      // through the public API.
      (globalThis as any).__eventSources = evs;
    }
    close() {}
  }
  vi.stubGlobal("EventSource", FE);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({})),
  );

  const bridge = await import("../dashboard/src/lib/tauri-bridge");
  const events: Array<Record<string, any>> = [];
  await bridge.listen("rpc:event", (event) => {
    events.push(JSON.parse(event.payload.data));
  });
  await bridge.invoke("rpc_spawn");
  await vi.waitFor(() => expect(events.some((e) => e.type === "$ready")).toBe(true));
  events.length = 0;
  return {
    events,
    setActiveTabIdInBridge: bridge.setActiveTabIdInBridge,
  };
}

describe("dashboard multi-tab routing via setActiveTabIdInBridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stamps the active tabId onto events that the bridge routes through emitEvent", async () => {
    const { events, setActiveTabIdInBridge } = await loadBridge();
    setActiveTabIdInBridge("tab-A");

    // Drive an SSE message into the bridge's onmessage handler. The
    // sseToIncoming → emitEvent chain must stamp the active tabId because
    // bridge-emitted events no longer hard-code one.
    const eventSources = (globalThis as { __eventSources?: EventSourceInstance[] })?.__eventSources;
    expect(eventSources?.length).toBeGreaterThan(0);
    const source = eventSources![0]!;
    source.onmessage?.({ data: JSON.stringify({ kind: "status", text: "hello" }) } as MessageEvent);

    await vi.waitFor(() => expect(events.some((e) => e.type === "status")).toBe(true));
    const stamped = events.find((e) => e.type === "status");
    expect(stamped?.tabId).toBe("tab-A");
  });

  it("defaults to tab-1 when setActiveTabIdInBridge was never called", async () => {
    const { events } = await loadBridge();

    const eventSources = (globalThis as { __eventSources?: EventSourceInstance[] })?.__eventSources;
    const source = eventSources![0]!;
    source.onmessage?.({ data: JSON.stringify({ kind: "status", text: "hello" }) } as MessageEvent);

    await vi.waitFor(() => expect(events.some((e) => e.type === "status")).toBe(true));
    const stamped = events.find((e) => e.type === "status");
    expect(stamped?.tabId).toBe("tab-1");
  });

  it("routes subsequent events to the latest active tabId", async () => {
    const { events, setActiveTabIdInBridge } = await loadBridge();
    setActiveTabIdInBridge("tab-A");
    setActiveTabIdInBridge("tab-B");

    const eventSources = (globalThis as { __eventSources?: EventSourceInstance[] })?.__eventSources;
    const source = eventSources![0]!;
    source.onmessage?.({ data: JSON.stringify({ kind: "status", text: "hello" }) } as MessageEvent);

    await vi.waitFor(() => expect(events.some((e) => e.type === "status")).toBe(true));
    const stamped = events.find((e) => e.type === "status");
    expect(stamped?.tabId).toBe("tab-B");
  });
});

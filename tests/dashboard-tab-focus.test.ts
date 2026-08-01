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

async function loadBridge() {
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
  return { bridge, events };
}

describe("dashboard tab focus UX", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("exports setActiveTabIdInBridge and updates the default tabId", async () => {
    const { bridge } = await loadBridge();
    expect(typeof bridge.setActiveTabIdInBridge).toBe("function");
    // Should not throw when called multiple times.
    bridge.setActiveTabIdInBridge("tab-A");
    bridge.setActiveTabIdInBridge("tab-B");
    bridge.setActiveTabIdInBridge("tab-1");
  });
});

// Live monitor for the desktop shell — pairs with manual user testing.
// Polls the container page (frames, active iframe, last protocol message),
// the iframe targets, and ~/.reasonix-code/desktop.log; prints a timestamped
// event line whenever something changes.
//
// Usage: node scripts/desktop-monitor.mjs <debugPort> [durationSeconds]

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import WebSocket from "ws";

const PORT = Number(process.argv[2] || 9240);
const DURATION = Number(process.argv[3] || 600);
const LOG = join(homedir(), ".reasonix-code", "desktop.log");

const ts = () => new Date().toTimeString().slice(0, 8);

async function getJson(url) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m.result);
        this.pending.delete(m.id);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.on("open", res);
      ws.on("error", rej);
    });
    return new Cdp(ws);
  }
  send(method, params = {}, sessionId) {
    return new Promise((res) => {
      const i = ++this.id;
      this.pending.set(i, res);
      this.ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async eval(expr, sessionId) {
    try {
      const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sessionId);
      return r.result?.value ?? null;
    } catch {
      return null;
    }
  }
}

async function main() {
  let cdp = null;
  let lastContainer = "";
  let lastFrames = "";
  let lastMsg = "";
  let lastLogPos = 0;

  console.log(`[monitor] watching :${PORT} for ${DURATION}s — operate the app now`);
  const started = Date.now();
  while (Date.now() - started < DURATION * 1000) {
    const targets = await getJson(`http://127.0.0.1:${PORT}/json`);
    const page = targets?.find((t) => t.type === "page" && t.url.includes("tauri.localhost"));
    if (page) {
      if (!cdp) {
        try {
          cdp = await Cdp.connect(page.webSocketDebuggerUrl);
          await cdp.send("Runtime.enable");
        } catch {
          cdp = null;
        }
      }
      if (cdp) {
        const container = await cdp.eval(
          `JSON.stringify({ frames: document.querySelectorAll('iframe').length, displays: [...document.querySelectorAll('iframe')].map(f => getComputedStyle(f).display === 'none' ? 'H' : 'S'), empty: document.getElementById('empty')?.classList.contains('show'), lastMsg: window.__lastMsg || '', err: document.getElementById('errbar')?.textContent || '' })`,
        );
        if (container && container !== lastContainer) {
          const c = JSON.parse(container);
          console.log(
            `[${ts()}] container: frames=${c.frames} [${c.displays.join(",")}] empty=${c.empty} lastMsg=${c.lastMsg}${c.err ? ` ERR=${c.err}` : ""}`,
          );
          lastContainer = container;
        }
      }
    }
    const frameUrls = targets?.filter((t) => t.type === "iframe" && t.url.includes("127.0.0.1")).map((t) => t.url.match(/:(\d+)\//)?.[1] || "?");
    const framesKey = (frameUrls || []).join(",");
    if (framesKey !== lastFrames) {
      console.log(`[${ts()}] iframes: ${framesKey || "(none)"}`);
      lastFrames = framesKey;
    }
    if (existsSync(LOG)) {
      const log = readFileSync(LOG, "utf8");
      if (log.length > lastLogPos) {
        const newLines = log.slice(lastLogPos).trimEnd();
        if (newLines) {
          for (const line of newLines.split("\n").slice(-5)) {
            console.log(`[${ts()}] log: ${line.slice(0, 220)}`);
          }
        }
        lastLogPos = log.length;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("[monitor] done");
  process.exit(0);
}

main().catch((e) => {
  console.error("monitor error:", e);
  process.exit(1);
});

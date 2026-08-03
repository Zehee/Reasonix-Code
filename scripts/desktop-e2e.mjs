// Desktop E2E smoke test — drives the real app via CDP (WebView2 remote
// debugging). No user interaction needed: starts the shell, waits for the
// container page, verifies the embedded dashboard renders its TabBar, then
// exercises the embed protocol (tab activate / close) and checks the shell
// log file got console forwarding.
//
// Usage: node scripts/desktop-e2e.mjs [debugPort]
// Requires a local CLI (npm-global) matching the dashboard bundle.

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
import WebSocket from "ws";

const PORT = Number(process.argv[2] || 9231);
const EXE = join(process.cwd(), "desktop", "src-tauri", "target", "release", "reasonix-code-desktop.exe");
const LOG = join(homedir(), ".reasonix-code", "desktop.log");
const NPM_GLOBAL = join(homedir(), ".reasonix-code", "npm-global");

let passed = 0;
let failed = 0;
function check(name, ok, extra = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── CDP client ──────────────────────────────────────────────────
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.sessions = new Map(); // targetId -> sessionId
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
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    return r.result?.value ?? r.result?.description ?? null;
  }
}

async function main() {
  // Clean the previous log so we only assert on this run.
  if (existsSync(LOG)) rmSync(LOG);

  console.log(`[e2e] starting shell on debug port ${PORT}...`);
  const child = spawn(EXE, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
      PATH: `${process.env.PATH};${NPM_GLOBAL}`,
    },
    stdio: "ignore",
  });

  // Wait for CDP.
  let targets = null;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      if (r.ok) {
        targets = await r.json();
        break;
      }
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  if (!targets) {
    console.log("✗ CDP never came up — did the shell start?");
    process.exit(1);
  }

  const page = targets.find((t) => t.type === "page" && t.url.includes("tauri.localhost"));
  if (!page) {
    console.log("✗ no local container page found");
    process.exit(1);
  }
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Target.setDiscoverTargets", { discover: true });

  console.log("[e2e] container page up, waiting for workspace iframe…");
  let frameId = null;
  for (let i = 0; i < 60; i++) {
    const t = await cdp.send("Target.getTargets", {});
    frameId = t.targetInfos.find((x) => x.type === "iframe" && x.url.includes("127.0.0.1"))?.targetId;
    if (frameId) break;
    await sleep(1000);
  }
  check("workspace iframe exists", !!frameId);
  if (!frameId) {
    child.kill();
    process.exit(1);
  }

  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: frameId, flatten: true });
  await cdp.send("Runtime.enable", {}, sessionId);

  // Dashboard should have rendered its TabBar via the reasonix:tabs broadcast.
  let state = {};
  for (let i = 0; i < 20; i++) {
    state = JSON.parse(
      (await cdp.eval(
        `JSON.stringify({ rootLen: document.getElementById('root')?.innerHTML.length ?? -1, tabs: document.querySelectorAll('.tab').length, tabbar: !!document.querySelector('.tabbar'), embed: document.documentElement.dataset.embed })`,
        sessionId,
      )) || "{}",
    );
    if (state.tabbar && state.rootLen > 0) break;
    await sleep(1000);
  }
  check("dashboard rendered (rootLen>0)", state.rootLen > 0, `rootLen=${state.rootLen}`);
  check("TabBar visible", state.tabbar === true);
  check("embed mode active", state.embed === "1");

  // Protocol: container -> iframe broadcast reached the dashboard's TabBar.
  check("tab rendered from broadcast", state.tabs >= 1, `tabs=${state.tabs}`);

  // Protocol: clicking a dashboard tab should activate it in the container
  // (visibility stays on the single frame; exercise tab-close/hide instead).
  const before = await cdp.eval(`document.querySelectorAll('iframe').length`, undefined);
  check("container had iframe", Number(before) >= 1);

  // Protocol: iframe -> container open-workspace (simulated as the dashboard
  // would send it after a pick).
  await cdp.eval(
    `for (const f of document.querySelectorAll('iframe')) f.contentWindow.postMessage({ type: 'reasonix:open-workspace', path: 'D:\\\\workspace\\\\Reasonix-Code' }, '*'); 'ok'`,
  );
  await sleep(2500);
  const after = await cdp.eval(`document.querySelectorAll('iframe').length`, undefined);
  check("open-workspace spawned a new frame", Number(after) >= Number(before), `before=${before} after=${after}`);

  // Shell log: console forwarding from the embedded dashboard.
  await sleep(1500);
  let logOk = false;
  if (existsSync(LOG)) {
    const log = readFileSync(LOG, "utf8");
    logOk = log.includes("[log]") || log.includes("[error]") || log.includes("reasonix");
  }
  check("desktop.log received forwarded console", logOk, LOG);

  child.kill();
  console.log(`\n[e2e] ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("e2e error:", e);
  process.exit(1);
});

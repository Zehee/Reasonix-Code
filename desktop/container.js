// Container page: hosts one iframe per workspace. The dashboards render
// their own TabBar (driven via postMessage); this page only manages the
// iframe registry, visibility and the bridge to the shell.

const tauri = typeof window !== "undefined" ? window.__TAURI__ : undefined;

const framesEl = document.getElementById("frames");
const emptyEl = document.getElementById("empty");
const errbarEl = document.getElementById("errbar");
const particlesEl = document.getElementById("particles");
const btnLast = document.getElementById("btn-last");
const btnChoose = document.getElementById("btn-choose");

function invoke(cmd, args) {
  return tauri.core.invoke(cmd, args);
}

function listen(event, handler) {
  if (tauri?.event?.listen) {
    tauri.event.listen(event, (ev) => handler(ev.payload));
  }
}

function showError(text) {
  errbarEl.textContent = String(text);
  errbarEl.style.display = "block";
  setTimeout(() => {
    errbarEl.style.display = "none";
  }, 6000);
}

/** iframe src = dashboard URL + embed=1 (dashboard hides its own chrome). */
function frameSrc(url) {
  return url + (url.includes("?") ? "&" : "?") + "embed=1";
}

function baseName(path) {
  if (!path) return "workspace";
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

// ── Frame registry ──────────────────────────────────────────────
// Map<id, { id, path, url, iframe, hidden }>
const frames = new Map();
let activeId = null;

/** Tell every iframe's dashboard to render/activate the tab list. */
function broadcastTabs() {
  const tabs = [...frames.values()]
    .filter((f) => !f.hidden)
    .map((f) => ({ id: f.id, path: f.path, active: f.id === activeId }));
  for (const f of frames.values()) {
    try {
      f.iframe.contentWindow.postMessage({ type: "reasonix:tabs", tabs }, "*");
    } catch {
      /* frame not ready */
    }
  }
}

function addFrame(ws) {
  // Hot reopen: same absolute path -> restore the hidden iframe as-is.
  // But DOM state isn't truth — the backend may have died externally.
  // Probe first; if gone, drop the stale frame and respawn.
  if (ws.path) {
    const hidden = [...frames.values()].find((f) => f.hidden && f.path === ws.path);
    if (hidden) {
      return restoreHiddenFrame(hidden, ws);
    }
  }
  if (frames.has(ws.id)) {
    updateFrame(ws);
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.className = "ws-frame";
  iframe.dataset.wsId = String(ws.id);
  iframe.dataset.path = ws.path || ""; // absolute path hook for pairing
  if (ws.url) iframe.src = frameSrc(ws.url);
  else
    iframe.srcdoc =
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-family:system-ui;font-size:13px;color:#8a9198">Starting…</div>';
  framesEl.appendChild(iframe);

  frames.set(ws.id, { id: ws.id, path: ws.path, url: ws.url, iframe, hidden: false });
  iframe.addEventListener("load", () => broadcastTabs());
  renderEmptyState();
  broadcastTabs();
}

async function restoreHiddenFrame(hidden, ws) {
  let alive = true;
  try {
    alive = await invoke("workspace_alive", { id: hidden.id });
  } catch {
    /* probe failed — assume alive, next open re-checks */
  }
  if (!alive) {
    const path = hidden.path;
    removeFrame(hidden.id);
    showError(`Workspace "${baseName(path)}" was stopped — restarting it.`);
    spawnAt(path); // respawn; workspace-opened/cli:url will rebuild the frame
    return;
  }
  frames.delete(hidden.id);
  const restored = {
    ...hidden,
    id: ws.id,
    url: ws.url ?? hidden.url,
    hidden: false,
  };
  restored.iframe.dataset.wsId = String(ws.id);
  restored.iframe.dataset.path = ws.path;
  if (ws.url && ws.url !== restored.url) restored.iframe.src = frameSrc(ws.url);
  frames.set(ws.id, restored);
  renderEmptyState();
  broadcastTabs();
  activate(ws.id);
}

function updateFrame(ws) {
  const f = frames.get(ws.id);
  if (!f) return;
  if (ws.path && ws.path !== f.path) {
    f.path = ws.path;
    f.iframe.dataset.path = ws.path;
  }
  if (ws.url && ws.url !== f.url) {
    f.url = ws.url;
    f.iframe.src = frameSrc(ws.url);
  }
  broadcastTabs();
}

/** Remove a frame entirely (workspace really died). */
function removeFrame(id) {
  const f = frames.get(id);
  if (!f) return;
  f.iframe.remove();
  frames.delete(id);
  if (activeId === id) {
    const visible = [...frames.values()].filter((x) => !x.hidden);
    activeId = visible.length ? visible[visible.length - 1].id : null;
    if (activeId) activate(activeId);
    else renderEmptyState();
  }
  broadcastTabs();
}

/** Close a tab: hide the iframe, keep the CLI process + dashboard alive. */
function hideFrame(id) {
  const f = frames.get(id);
  if (!f) return;
  f.hidden = true;
  f.iframe.style.display = "none";
  if (activeId === id) {
    const visible = [...frames.values()].filter((x) => !x.hidden);
    activeId = visible.length ? visible[visible.length - 1].id : null;
    if (activeId) activate(activeId);
    else renderEmptyState();
  }
  broadcastTabs();
}

function activate(id) {
  activeId = id;
  for (const [fid, f] of frames) {
    f.iframe.style.display = fid === id ? "" : "none";
  }
  emptyEl.classList.remove("show");
  broadcastTabs();
}

function renderEmptyState() {
  const show = frames.size === 0;
  emptyEl.classList.toggle("show", show);
  // Ambient particles only make sense behind the picker; hide them once
  // a dashboard iframe is up.
  if (particlesEl) particlesEl.style.visibility = show ? "visible" : "hidden";
}

// ── Liveness (reopen-time only, no heartbeat) ───────────────────
async function checkFrameAlive(f) {
  if (!f.url) return; // still starting
  try {
    const alive = await invoke("workspace_alive", { id: f.id });
    if (!alive) {
      const name = baseName(f.path);
      removeFrame(f.id);
      showError(`Workspace "${name}" stopped — reopen it to restart.`);
    }
  } catch {
    /* probe failed — leave the frame */
  }
}

// ── Workspace creation ──────────────────────────────────────────
async function spawnAt(path) {
  try {
    await invoke("launch_backend", { cwd: path });
  } catch (e) {
    showError(`Failed to start workspace: ${e}`);
  }
}

async function pickWorkspace() {
  try {
    await invoke("pick_workspace");
  } catch (e) {
    showError(`Failed to pick folder: ${e}`);
  }
}

// ── Ambient particles (picker background) ──────────────────────
// Small green motes drifting upward behind the workspace picker.
function initParticles() {
  const canvas = document.getElementById("particles");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  let W = 0;
  let H = 0;
  const parts = [];
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);
  const COUNT = 36;
  for (let i = 0; i < COUNT; i++) {
    parts.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 2.2 + 1.2,
      v: Math.random() * 0.35 + 0.12,
      o: Math.random() * 0.35 + 0.35,
      p: Math.random() * Math.PI * 2,
    });
  }
  function tick() {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.y -= p.v;
      p.p += 0.01;
      if (p.y < -6) {
        p.y = H + 6;
        p.x = Math.random() * W;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle =
        "rgba(94, 200, 110, " + p.o * (0.6 + 0.4 * Math.sin(p.p)) + ")";
      ctx.fill();
    }
    requestAnimationFrame(tick);
  }
  tick();
}
initParticles();

// ── Boot ────────────────────────────────────────────────────────
async function init() {
  // Shell versions go in the native window title.
  try {
    const build = await invoke("desktop_build");
    const env = await invoke("check_environment");
    const parts = ["Reasonix Code"];
    parts.push(build === "dev" ? "dev" : `build ${build}`);
    if (env?.cli_version) parts.push(`cli ${env.cli_version}`);
    await invoke("set_window_title", { title: parts.join(" · ") });
  } catch {
    /* non-Tauri shell — keep default title */
  }

  let list = [];
  try {
    list = await invoke("list_workspaces");
  } catch (e) {
    showError(`list_workspaces failed: ${e}`);
  }
  for (const ws of list) await addFrame(ws);
  if (list.length) {
    const first = list.find((w) => w.url) ?? list[0];
    activate(first.id);
  } else {
    // No running instances: show the workspace picker instead of
    // auto-resuming, so the user chooses which workspace to open.
    let lastPath = null;
    try {
      lastPath = await invoke("last_workspace");
    } catch {
      /* no last workspace */
    }
    const recentWrap = document.getElementById("recent-wrap");
    if (lastPath) {
      recentWrap.style.display = "";
      document.getElementById("last-name").textContent = baseName(lastPath);
      document.getElementById("last-path").textContent = lastPath;
      btnLast.dataset.path = lastPath;
    } else {
      recentWrap.style.display = "none";
    }
    renderEmptyState();
  }
}

// ── Messages from the embedded dashboards ───────────────────────
const CHILD_ORIGIN_OK = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

window.addEventListener("message", (ev) => {
  if (!CHILD_ORIGIN_OK.test(ev.origin)) return;
  const msg = ev.data;
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

  switch (msg.type) {
    case "reasonix:tab-activate":
      if (msg.id != null && frames.has(msg.id)) activate(msg.id);
      break;
    case "reasonix:tab-new":
      pickWorkspace();
      break;
    case "reasonix:tab-close":
      if (msg.id != null && frames.has(msg.id)) hideFrame(msg.id);
      break;
    case "reasonix:open-workspace":
      if (typeof msg.path === "string" && msg.path) spawnAt(msg.path);
      break;
    case "reasonix:iframe-ready":
      // Dashboard mounted and its listener is live — (re)send the tab
      // snapshot. The iframe-load broadcast can race the React mount.
      broadcastTabs();
      break;
    case "reasonix:console":
      // Relay embedded-dashboard console output to the shell log.
      if (typeof msg.level === "string" && typeof msg.msg === "string") {
        invoke("log_console", { level: msg.level, msg: msg.msg }).catch(() => {});
      }
      break;
    default:
      break;
  }
});

// ── Events from the shell ───────────────────────────────────────
listen("cli:url", (payload) => {
  if (!payload?.id || !payload?.url) return;
  addFrame({ id: payload.id, url: payload.url, path: payload.path });
  activate(payload.id);
});
listen("workspace-opened", (payload) => {
  if (!payload?.id || !payload?.url) return;
  addFrame({ id: payload.id, url: payload.url, path: payload.path });
  activate(payload.id);
});
listen("workspace-closed", (payload) => {
  if (payload?.id != null) removeFrame(payload.id);
});
listen("cli:exit", (payload) => {
  if (payload?.id != null && activeId === payload.id) {
    const visible = [...frames.values()].filter((x) => !x.hidden && x.id !== payload.id);
    if (visible.length) activate(visible[visible.length - 1].id);
    else renderEmptyState();
  }
});
listen("cli:error", (payload) => {
  showError(String(payload ?? "Failed to start Reasonix"));
});

// ── UI wiring ───────────────────────────────────────────────────
btnChoose.addEventListener("click", pickWorkspace);
btnLast.addEventListener("click", async () => {
  const path = btnLast.dataset.path;
  if (!path) return;
  spawnAt(path);
});

init();

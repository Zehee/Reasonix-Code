// Container page: iframes = workspace tabs. The main webview never
// navigates; each workspace runs as one background CLI process and its
// dashboard lives in a dedicated iframe. Switching tabs is show/hide.
//
// Closing a tab hides its iframe (DOM kept, dashboard/SSE state intact)
// and the CLI process stays alive — reopening the same folder matches by
// the absolute path hook on the iframe (data-path) and just un-hides it.

const tauri = typeof window !== "undefined" ? window.__TAURI__ : undefined;

const tabbarEl = document.getElementById("tabbar");
const framesEl = document.getElementById("frames");
const emptyEl = document.getElementById("empty");
const errbarEl = document.getElementById("errbar");
const versionsEl = document.getElementById("versions");
const btnNew = document.getElementById("btn-new");
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

// ── Frame/tab registry ──────────────────────────────────────────
// Map<id, { id, path, url, iframe, tabEl, hidden }>
const frames = new Map();
let activeId = null;

function makeTabEl(f) {
  const tabEl = document.createElement("button");
  tabEl.type = "button";
  tabEl.className = "ws-tab";
  tabEl.dataset.path = f.path || "";
  tabEl.innerHTML = `<span class="name"></span><span class="x" title="Close tab (workspace keeps running)">×</span>`;
  tabEl.querySelector(".name").textContent = baseName(f.path);
  tabEl.addEventListener("click", () => activate(f.id));
  tabEl.querySelector(".x").addEventListener("click", (e) => {
    e.stopPropagation();
    hideFrame(f.id);
  });
  return tabEl;
}

function ensureTab(f) {
  if (f.tabEl && f.tabEl.isConnected) return;
  f.tabEl = makeTabEl(f);
  tabbarEl.insertBefore(f.tabEl, tabbarEl.querySelector(".grow"));
}

function addFrame(ws) {
  // Hot reopen: same absolute path -> restore the hidden iframe as-is
  // (dashboard state, SSE, scroll — everything is still alive in it).
  if (ws.path) {
    const hidden = [...frames.values()].find((f) => f.hidden && f.path === ws.path);
    if (hidden) {
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
      ensureTab(restored);
      activate(ws.id);
      return;
    }
  }
  if (frames.has(ws.id)) {
    updateFrame(ws);
    ensureTab(frames.get(ws.id));
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

  const f = { id: ws.id, path: ws.path, url: ws.url, iframe, tabEl: null, hidden: false };
  frames.set(ws.id, f);
  ensureTab(f);
  renderEmptyState();
}

function updateFrame(ws) {
  const f = frames.get(ws.id);
  if (!f) return;
  if (ws.path && ws.path !== f.path) {
    f.path = ws.path;
    f.iframe.dataset.path = ws.path;
    if (f.tabEl) {
      f.tabEl.dataset.path = ws.path;
      f.tabEl.querySelector(".name").textContent = baseName(ws.path);
    }
  }
  if (ws.url && ws.url !== f.url) {
    f.url = ws.url;
    f.iframe.src = frameSrc(ws.url);
  }
}

/** Remove a frame entirely (workspace really died). */
function removeFrame(id) {
  const f = frames.get(id);
  if (!f) return;
  f.iframe.remove();
  f.tabEl?.remove();
  frames.delete(id);
  if (activeId === id) {
    const visible = [...frames.values()].filter((x) => !x.hidden);
    activeId = visible.length ? visible[visible.length - 1].id : null;
    if (activeId) activate(activeId);
    else renderEmptyState();
  }
}

/** Close a tab: hide the iframe, keep the CLI process + dashboard alive. */
function hideFrame(id) {
  const f = frames.get(id);
  if (!f) return;
  f.hidden = true;
  f.iframe.style.display = "none";
  f.tabEl?.remove();
  if (activeId === id) {
    const visible = [...frames.values()].filter((x) => !x.hidden);
    activeId = visible.length ? visible[visible.length - 1].id : null;
    if (activeId) activate(activeId);
    else renderEmptyState();
  }
}

function activate(id) {
  activeId = id;
  for (const [fid, f] of frames) {
    const show = fid === id;
    f.iframe.style.display = show ? "" : "none";
    if (f.tabEl) f.tabEl.classList.toggle("active", show);
  }
  emptyEl.classList.remove("show");
}

function renderEmptyState() {
  emptyEl.classList.toggle("show", frames.size === 0);
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

// ── Boot ────────────────────────────────────────────────────────
async function init() {
  try {
    const build = await invoke("desktop_build");
    const env = await invoke("check_environment");
    const parts = [];
    parts.push(build === "dev" ? "dev" : `build ${build}`);
    if (env?.cli_version) parts.push(`cli ${env.cli_version}`);
    versionsEl.textContent = parts.join(" · ");
  } catch {
    /* non-Tauri shell — skip badge */
  }

  let list = [];
  try {
    list = await invoke("list_workspaces");
  } catch (e) {
    showError(`list_workspaces failed: ${e}`);
  }
  for (const ws of list) addFrame(ws);
  if (list.length) {
    const first = list.find((w) => w.url) ?? list[0];
    activate(first.id);
  } else {
    try {
      const last = await invoke("last_workspace");
      if (last) spawnAt(last);
      else renderEmptyState();
    } catch {
      renderEmptyState();
    }
  }
}

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
btnNew.addEventListener("click", pickWorkspace);
btnChoose.addEventListener("click", pickWorkspace);
btnLast.addEventListener("click", async () => {
  try {
    const last = await invoke("last_workspace");
    if (last) spawnAt(last);
  } catch {
    /* no last workspace */
  }
});

init();

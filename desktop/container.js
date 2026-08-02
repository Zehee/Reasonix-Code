// Container page: iframes = workspace tabs. The main webview never
// navigates; each workspace runs as one background CLI process and its
// dashboard is loaded into a dedicated iframe. Switching tabs is pure
// show/hide, so every workspace keeps its session/SSE state alive.

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
// Map<id, { id, path, url, iframe, tabEl }>
const frames = new Map();
let activeId = null;

function addFrame(ws) {
  if (frames.has(ws.id)) {
    updateFrame(ws);
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.className = "ws-frame";
  iframe.setAttribute("data-ws-id", String(ws.id));
  if (ws.url) iframe.src = frameSrc(ws.url);
  else iframe.srcdoc =
    '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-family:system-ui;font-size:13px;color:#8a9198">Starting…</div>';
  framesEl.appendChild(iframe);

  const tabEl = document.createElement("button");
  tabEl.type = "button";
  tabEl.className = "ws-tab";
  tabEl.innerHTML = `<span class="name"></span><span class="x" title="Close workspace">×</span>`;
  tabEl.querySelector(".name").textContent = baseName(ws.path);
  tabEl.addEventListener("click", () => activate(ws.id));
  tabEl.querySelector(".x").addEventListener("click", (e) => {
    e.stopPropagation();
    closeFrame(ws.id);
  });
  tabbarEl.insertBefore(tabEl, tabbarEl.querySelector(".grow"));

  frames.set(ws.id, { id: ws.id, path: ws.path, url: ws.url, iframe, tabEl });
  renderEmptyState();
  return frames.get(ws.id);
}

function updateFrame(ws) {
  const f = frames.get(ws.id);
  if (!f) return;
  if (ws.path && ws.path !== f.path) {
    f.path = ws.path;
    f.tabEl.querySelector(".name").textContent = baseName(ws.path);
  }
  // Instance became ready after being added as "Starting…"
  if (ws.url && ws.url !== f.url) {
    f.url = ws.url;
    f.iframe.src = frameSrc(ws.url);
  }
}

function removeFrame(id) {
  const f = frames.get(id);
  if (!f) return;
  f.iframe.remove();
  f.tabEl.remove();
  frames.delete(id);
  if (activeId === id) {
    const ids = [...frames.keys()];
    activeId = ids.length ? ids[ids.length - 1] : null;
    if (activeId) activate(activeId);
    else renderEmptyState();
  }
}

function activate(id) {
  activeId = id;
  for (const [fid, f] of frames) {
    const on = fid === id;
    f.iframe.style.display = on ? "" : "none";
    f.tabEl.classList.toggle("active", on);
  }
  emptyEl.classList.remove("show");
}

async function closeFrame(id) {
  removeFrame(id); // instant UI; workspace-closed event will also arrive
  try {
    await invoke("workspace_close", { id });
  } catch (e) {
    showError(`Failed to close workspace: ${e}`);
  }
}

function renderEmptyState() {
  if (frames.size === 0) {
    emptyEl.classList.add("show");
  } else {
    emptyEl.classList.remove("show");
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

// ── Boot ────────────────────────────────────────────────────────
async function init() {
  // Show the shell versions in the tab bar (desktop build + CLI).
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

  // Restore running instances.
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
    // No instance yet — auto-resume the last workspace, else show the picker.
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
  // The iframe's server is gone; if it's the active one, show the picker.
  if (payload?.id != null && activeId === payload.id) {
    const ids = [...frames.keys()];
    if (ids.length) activate(ids[ids.length - 1]);
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

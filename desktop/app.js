const statusEl = document.getElementById("status");
const actionsEl = document.getElementById("actions");

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function appendStatus(line) {
  if (!statusEl) return;
  const text = statusEl.textContent || "";
  statusEl.textContent = text ? `${text}\n${line}` : line;
}

function clearActions() {
  if (!actionsEl) return;
  actionsEl.innerHTML = "";
}

function addButton(label, onClick, variant = "primary") {
  if (!actionsEl) return null;
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.className = variant;
  btn.addEventListener("click", onClick);
  actionsEl.appendChild(btn);
  return btn;
}

const tauri = typeof window !== "undefined" ? window.__TAURI__ : undefined;

function listen(event, handler) {
  if (tauri?.event?.listen) {
    tauri.event.listen(event, handler);
  }
}

listen("cli:stderr", (ev) => {
  const line = String(ev?.payload ?? "");
  if (line.includes("Downloading") || line.includes("Added") || line.includes("Done")) {
    setStatus(line);
  } else if (line.includes("/dashboard")) {
    setStatus("Dashboard ready, loading…");
  }
});

listen("cli:error", (ev) => {
  setStatus(String(ev?.payload ?? "Failed to start Reasonix"), true);
});

listen("cli:exit", () => {
  setStatus("Reasonix stopped. Please restart the app.", true);
});

listen("cli:url", () => {
  setStatus("Dashboard ready, loading…");
});

listen("install:stdout", (ev) => {
  appendStatus(String(ev?.payload ?? ""));
});

listen("install:stderr", (ev) => {
  appendStatus(String(ev?.payload ?? ""));
});

function parsePayload(ev) {
  let payload = ev?.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      // leave as string
    }
  }
  return payload;
}

function parseVersion(version) {
  const cleaned = version.trim().replace(/^v/, "");
  const parts = cleaned.split(".");
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some(Number.isNaN)) return null;
  return nums;
}

function versionLessThan(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return false;
  for (let i = 0; i < 3; i++) {
    if (va[i] < vb[i]) return true;
    if (va[i] > vb[i]) return false;
  }
  return false;
}

async function fetchLatestCliVersion() {
  try {
    const res = await fetch("https://api.github.com/repos/Zehee/Reasonix-Code/releases/latest");
    if (!res.ok) return null;
    const data = await res.json();
    const tag = data?.tag_name;
    return typeof tag === "string" ? tag.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}

async function launchBackend() {
  setStatus("Starting backend…");
  clearActions();
  try {
    await tauri.core.invoke("launch_backend", { cwd: null });
  } catch (e) {
    setStatus(String(e), true);
  }
}

async function installCli() {
  setStatus("Installing reasonix-code…");
  clearActions();
  try {
    await tauri.core.invoke("install_cli");
  } catch (e) {
    setStatus(`Install failed: ${e}`, true);
  }
}

async function installNode() {
  setStatus("Please install Node.js, then restart the app.");
  try {
    await tauri.core.invoke("install_node");
  } catch (e) {
    setStatus(`Failed to open browser: ${e}`, true);
  }
}

listen("install:done", (ev) => {
  const payload = parsePayload(ev);
  if (payload?.success) {
    setStatus("Install complete, starting backend…");
    launchBackend();
  } else {
    setStatus(`Install failed: ${payload?.error ?? "unknown error"}`, true);
  }
});

async function checkEnvironment() {
  if (!tauri?.core?.invoke) {
    setStatus("Tauri runtime not available.", true);
    return;
  }
  setStatus("Checking environment…");
  try {
    const status = await tauri.core.invoke("check_environment");

    clearActions();

    if (!status.node_ok) {
      setStatus("This app requires Node.js >= 22 and npm.\nPlease install Node.js, then restart the app.");
      addButton("Install Node.js", installNode);
      return;
    }

    if (!status.cli_ok) {
      setStatus("reasonix-code CLI not found");
      addButton("Install reasonix-code", installCli);
      return;
    }

    const localVersion = status.cli_version ?? "";
    const latestVersion = await fetchLatestCliVersion();
    if (latestVersion && versionLessThan(localVersion, latestVersion)) {
      setStatus(`reasonix-code ${localVersion} is installed. A newer version (${latestVersion}) is available.`);
      addButton("Upgrade reasonix-code", installCli);
      addButton("Continue with current version", launchBackend, "secondary");
      return;
    }

    setStatus("CLI ready, starting…");
    launchBackend();
  } catch (e) {
    setStatus(`Environment check failed: ${e}`, true);
  }
}

checkEnvironment();

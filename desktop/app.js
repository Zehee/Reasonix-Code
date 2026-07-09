const statusEl = document.getElementById("status");

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

const tauri = typeof window !== "undefined" ? window.__TAURI__ : undefined;

if (tauri?.event?.listen) {
  tauri.event.listen("cli:stderr", (ev) => {
    const line = String(ev?.payload ?? "");
    if (line.includes("Downloading") || line.includes("Added") || line.includes("Done")) {
      setStatus(line);
    } else if (line.includes("/dashboard")) {
      setStatus("Dashboard ready, loading…");
    }
  });

  tauri.event.listen("cli:error", (ev) => {
    setStatus(String(ev?.payload ?? "Failed to start Reasonix"), true);
  });

  tauri.event.listen("cli:exit", () => {
    setStatus("Reasonix stopped. Please restart the app.", true);
  });
} else {
  setStatus("Tauri runtime not available.", true);
}

import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles.css";
import "katex/dist/katex.min.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { defaultStyleForTheme, isTheme, isThemeStyle, themeForStyle } from "./theme";

const stored = localStorage.getItem("reasonix.theme");
const storedStyle = localStorage.getItem("reasonix.themeStyle");
if (isThemeStyle(storedStyle)) {
  document.documentElement.dataset.themeStyle = storedStyle;
  document.documentElement.dataset.theme = themeForStyle(storedStyle);
} else if (isTheme(stored)) {
  document.documentElement.dataset.theme = stored;
  document.documentElement.dataset.themeStyle = defaultStyleForTheme(stored);
}

const platform = /Mac|macOS/i.test(navigator.userAgent)
  ? "macos"
  : /Windows/i.test(navigator.userAgent)
    ? "windows"
    : "default";
document.documentElement.dataset.platform = platform;
document.body.dataset.platform = platform;

// Embed mode: the desktop container page loads each workspace dashboard
// into an iframe (?embed=1). Workspace switching lives in the container's
// own tab bar, so hide the dashboard's workspace chrome (title bar,
// ws-crumb) to avoid duplicated/nested controls.
if (new URLSearchParams(window.location.search).has("embed")) {
  document.documentElement.dataset.embed = "1";
}

const host = document.getElementById("root");
if (!host) throw new Error("#root missing");

createRoot(host).render(<App />);

// The desktop shell hosts this dashboard in a WebView2 iframe; browser
// accelerator keys (Ctrl+P print, Ctrl+F find, Ctrl+S save…) are enabled by
// default and surface the browser UI we don't want inside a desktop app.
// Block them globally (keydown fires inside the iframe before WebView2
// handles the accelerator).
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === "p" || k === "s" || k === "f" || k === "u" || k === "g") {
      e.preventDefault();
    }
  }
});

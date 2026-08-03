/** Embed mode: container hosts each workspace in an iframe; container->iframe reasonix:tabs, iframe->parent tab-activate|tab-new|tab-close|open-workspace. */

export const isEmbed = new URLSearchParams(window.location.search).has("embed");

// Forward console output to the container page, which writes it to
// ~/.reasonix-code/desktop.log (via log_console). Enables debugging from
// the log file even without CDP.
if (isEmbed && typeof window !== "undefined") {
  const fwd = (level: string, args: unknown[]) =>
    postToParent({
      type: "reasonix:console",
      level,
      msg: args.map(String).join(" ").slice(0, 2000),
    });
  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  console.log = (...a) => {
    fwd("log", a);
    orig.log(...a);
  };
  console.info = (...a) => {
    fwd("info", a);
    orig.info(...a);
  };
  console.warn = (...a) => {
    fwd("warn", a);
    orig.warn(...a);
  };
  console.error = (...a) => {
    fwd("error", a);
    orig.error(...a);
  };
  window.addEventListener("error", (e) => fwd("error", [e.message, e.filename, e.lineno]));
  window.addEventListener("unhandledrejection", (e) =>
    fwd("error", ["unhandledrejection:", String(e.reason).slice(0, 300)]),
  );
}

const PARENT_ORIGIN_OK = (origin: string) =>
  /^https?:\/\/((127\.0\.0\.1|localhost|tauri\.localhost)(:\d+)?)$/.test(origin);

/** Send a message to the container page (no-op outside embed mode). */
export function postToParent(msg: unknown): void {
  if (!isEmbed || window.parent === window) return;
  window.parent.postMessage(msg, "*");
}

/** Pull-style handshake: after mount, ask the container to re-broadcast the tab snapshot (its iframe-load broadcast can race our React mount). */
export function announceEmbedReady(): void {
  if (!isEmbed || window.parent === window) return;
  window.parent.postMessage({ type: "reasonix:iframe-ready" }, "*");
}

/** Subscribe to container messages (no-op outside embed mode). Returns an
 *  unsubscribe function. Only messages from the local dashboard servers
 *  (127.0.0.1 / localhost) are accepted. */
export function onEmbedMessage(handler: (msg: any) => void): () => void {
  if (!isEmbed) return () => {};
  const onMsg = (ev: MessageEvent) => {
    if (!PARENT_ORIGIN_OK(ev.origin)) return;
    const data = ev.data;
    if (data && typeof data === "object" && typeof data.type === "string") {
      handler(data);
    }
  };
  window.addEventListener("message", onMsg);
  return () => window.removeEventListener("message", onMsg);
}

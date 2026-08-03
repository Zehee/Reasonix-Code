/**
 * Embed mode: the desktop container page (container.html) hosts each
 * workspace dashboard in an iframe and drives the dashboard's own TabBar
 * via postMessage — the container never touches this document's DOM
 * (cross-origin). Protocol:
 *
 *   container -> iframe: { type:"reasonix:tabs", tabs:[{id,path,active}] }
 *   iframe    -> parent: { type:"reasonix:tab-activate"|"tab-new"|"tab-close", id? }
 *                        { type:"reasonix:open-workspace", path }
 */

export const isEmbed = new URLSearchParams(window.location.search).has("embed");

const PARENT_ORIGIN_OK = (origin: string) =>
  /^https?:\/\/((127\.0\.0\.1|localhost|tauri\.localhost)(:\d+)?)$/.test(origin);

/** Send a message to the container page (no-op outside embed mode). */
export function postToParent(msg: unknown): void {
  if (!isEmbed || window.parent === window) return;
  window.parent.postMessage(msg, "*");
}

/**
 * Handshake: once the dashboard has mounted and its message listener is
 * registered, tell the container so it (re)broadcasts the tab snapshot.
 * The container's iframe-load broadcast can race the React mount; this
 * pull-style handshake makes the first tab list reliable.
 */
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

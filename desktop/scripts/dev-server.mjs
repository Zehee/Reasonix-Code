import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";

const HERE = resolve(import.meta.dirname, "..");
const DIST = resolve(HERE, "dist");

if (!existsSync(resolve(DIST, "index.html"))) {
  mkdirSync(DIST, { recursive: true });
  copyFileSync(resolve(HERE, "index.html"), resolve(DIST, "index.html"));
  copyFileSync(resolve(HERE, "app.js"), resolve(DIST, "app.js"));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = resolve(DIST, "." + pathname);
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const { readFile } = await import("node:fs/promises");
    const data = await readFile(file);
    const type = MIME[extname(file)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(1420, "127.0.0.1", () => {
  console.log("[dev-server] http://127.0.0.1:1420");
});

import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const HERE = resolve(import.meta.dirname, "..");
const DIST = resolve(HERE, "dist");

// Clean the old bundled dashboard so the installer doesn't ship stale assets.
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

copyFileSync(resolve(HERE, "index.html"), resolve(DIST, "index.html"));
copyFileSync(resolve(HERE, "app.js"), resolve(DIST, "app.js"));
copyFileSync(resolve(HERE, "container.html"), resolve(DIST, "container.html"));
copyFileSync(resolve(HERE, "container.js"), resolve(DIST, "container.js"));

console.log(`[build-shell] ${DIST}/index.html + app.js + container.html + container.js`);

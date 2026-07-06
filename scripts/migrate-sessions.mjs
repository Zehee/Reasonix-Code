/**
 * Temporary migration script: flat sessions → workspace directory isolation.
 *
 * Run: node scripts/migrate-sessions.mjs
 *
 * Before: ~/.reasonix/sessions/code-myproject-20260701.jsonl
 * After:  ~/.reasonix/sessions/myproject/20260701_120000.jsonl
 *
 * Active sessions (last touched per workspace) become "active.jsonl".
 * Non-code sessions (chat/default) go to sessions/__chat__/.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, dirname } from "node:path";

const SESSIONS_DIR = join(homedir(), ".reasonix", "sessions");

function workspaceSlug(root) {
  return root.replace(/[/\\:]/g, "-").replace(/^-+/, "").toLowerCase();
}

function loadMeta(name) {
  const p = join(SESSIONS_DIR, `${name}.meta.json`);
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function timestampSuffix() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
}

function main() {
  if (!existsSync(SESSIONS_DIR)) {
    console.log("No sessions directory found at", SESSIONS_DIR);
    return;
  }

  const files = readdirSync(SESSIONS_DIR).filter(
    (f) => f.endsWith(".jsonl") && !f.endsWith(".events.jsonl"),
  );

  console.log(`Found ${files.length} session files in ${SESSIONS_DIR}\n`);

  // Group by workspace slug
  const workspaceMap = new Map(); // slug → { name, ts, meta }[]

  for (const file of files) {
    const name = file.replace(/\.jsonl$/, "");
    const path = join(SESSIONS_DIR, file);
    const meta = loadMeta(name);
    const workspace = meta.workspace || "";
    const slug = workspace ? workspaceSlug(workspace) : "__chat__";

    if (!workspaceMap.has(slug)) {
      workspaceMap.set(slug, []);
    }
    workspaceMap.get(slug).push({ name, path, meta, workspace, ts: statSync(path).mtime });
  }

  let migrated = 0;

  for (const [slug, entries] of workspaceMap) {
    // Sort by mtime, newest first
    entries.sort((a, b) => b.ts - a.ts);

    const targetDir = join(SESSIONS_DIR, slug);
    mkdirSync(targetDir, { recursive: true });

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isNewest = i === 0 && slug !== "__chat__";
      const isArchive = entry.name.includes("__archive_");

      // Determine target name
      let targetBase;
      if (isNewest && !isArchive) {
        targetBase = "active";
      } else if (isArchive) {
        // Extract timestamp from __archive_{ts}
        const tsPart = entry.name.match(/__archive_(\d{8}_?\d{0,6})/);
        targetBase = tsPart ? tsPart[1] : entry.name.replace(/^code-/, "").replace(/__archive_/, "");
      } else {
        // Extract timestamp from code-{slug}-{ts} or use a fallback
        const tsMatch = entry.name.match(/(\d{8}-?\d{0,6})/);
        targetBase = tsMatch ? tsMatch[1].replace("-", "_") : timestampSuffix();
      }

      // Move main .jsonl
      const oldJsonl = entry.path;
      const newJsonl = join(targetDir, `${targetBase}.jsonl`);
      console.log(`  ${entry.name} → ${slug}/${targetBase}.jsonl`);
      renameSync(oldJsonl, newJsonl);

      // Move sidecars
      for (const ext of [".meta.json", ".archive.jsonl", ".events.jsonl"]) {
        const oldSidecar = join(SESSIONS_DIR, `${entry.name}${ext}`);
        const newSidecar = join(targetDir, `${targetBase}${ext}`);
        if (existsSync(oldSidecar)) {
          renameSync(oldSidecar, newSidecar);
        }
      }

      migrated++;
    }
    console.log("");
  }

  // Clean up empty flat files (legacy __archive_* renames that left orphans)
  console.log(`Done. Migrated ${migrated} sessions to workspace directories.`);
  console.log("\nRemaining flat files:");
  const remaining = readdirSync(SESSIONS_DIR).filter(
    (f) => f.endsWith(".jsonl") || f.endsWith(".meta.json") || f.endsWith(".archive.jsonl") || f.endsWith(".events.jsonl"),
  );
  for (const f of remaining) {
    console.log(`  ${f}`);
  }
}

main();

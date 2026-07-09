// Sync the root package.json version into desktop/package.json and
// desktop/src-tauri/Cargo.toml so all three stay aligned.
//
// Usage:  node desktop/scripts/sync-version.mjs
//         node desktop/scripts/sync-version.mjs --check   # dry-run, exit 1 if out of sync

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const DESKTOP = resolve(HERE, "..");

const rootPkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
const version = rootPkg.version;

if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Invalid root version: ${version}`);
  process.exit(1);
}

const checkOnly = process.argv.includes("--check");
let allSynced = true;

// ── desktop/package.json ──
const desktopPkgPath = resolve(DESKTOP, "package.json");
const desktopPkg = JSON.parse(readFileSync(desktopPkgPath, "utf-8"));
if (desktopPkg.version !== version) {
  if (checkOnly) {
    console.error(`desktop/package.json: ${desktopPkg.version} → expected ${version}`);
    allSynced = false;
  } else {
    desktopPkg.version = version;
    writeFileSync(desktopPkgPath, JSON.stringify(desktopPkg, null, 2) + "\n", "utf-8");
    console.log(`desktop/package.json: ${desktopPkg.version} → ${version}`);
  }
} else {
  console.log(`desktop/package.json: ${version} (synced)`);
}

// ── desktop/src-tauri/Cargo.toml ──
const cargoPath = resolve(DESKTOP, "src-tauri", "Cargo.toml");
let cargoText = readFileSync(cargoPath, "utf-8");
const cargoVersionPat = /^version\s*=\s*"([^"]+)"/m;
const cargoMatch = cargoText.match(cargoVersionPat);
if (cargoMatch) {
  if (cargoMatch[1] !== version) {
    if (checkOnly) {
      console.error(`Cargo.toml: ${cargoMatch[1]} → expected ${version}`);
      allSynced = false;
    } else {
      cargoText = cargoText.replace(cargoVersionPat, `version = "${version}"`);
      writeFileSync(cargoPath, cargoText, "utf-8");
      console.log(`Cargo.toml: ${cargoMatch[1]} → ${version}`);
    }
  } else {
    console.log(`Cargo.toml: ${version} (synced)`);
  }
} else {
  console.error("Cargo.toml: version field not found");
  if (checkOnly) allSynced = false;
}

if (checkOnly && !allSynced) {
  console.error("Versions out of sync — run without --check to fix");
  process.exit(1);
}

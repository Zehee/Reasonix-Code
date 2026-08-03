#!/usr/bin/env node
// No-op when run from the published tarball (no dashboard/package.json shipped) —
// only the git checkout has workspace deps to install.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

// ── Windows: make `reasonix-code` callable from any terminal ──────────
// npm drops the .cmd shim into `npm prefix -g`. The Node installer usually
// puts that dir on PATH, but custom prefixes (.npmrc) or installer-driven
// prefixes (~/.reasonix-code/npm-global) don't. Append it to the user PATH
// (via .NET, which also broadcasts WM_SETTINGCHANGE) so new terminals can
// run `reasonix-code` right after `npm i -g reasonix-code`.
function ensureGlobalBinOnPath() {
  if (process.platform !== "win32") return;
  try {
    const prefix = execSync("npm prefix -g", { encoding: "utf8" }).trim();
    if (!prefix) return;
    const p = prefix.replace(/'/g, "''");
    const ps = [
      "$cur = [Environment]::GetEnvironmentVariable('Path','User')",
      "$p = '" + p + "'",
      "$on = ($cur -split ';' | ForEach-Object { $_.Trim().ToLower() }) -contains $p.ToLower()",
      "if (-not $on) { [Environment]::SetEnvironmentVariable('Path', ($cur + ';' + $p), 'User') }",
    ].join("; ");
    const b64 = Buffer.from(ps).toString("base64");
    execSync(`powershell -NoProfile -EncodedCommand ${b64}`, { stdio: "ignore" });
  } catch {
    /* CI / sandbox / no powershell — skip silently */
  }
}
ensureGlobalBinOnPath();

if (!existsSync("dashboard/package.json")) process.exit(0);

execSync("npm --prefix dashboard ci --ignore-scripts", { stdio: "inherit" });
execSync("npm --prefix desktop ci --ignore-scripts", { stdio: "inherit" });

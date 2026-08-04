import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/**
 * Citation validation for the "Reasonix VALIDATES citations" contract:
 * a cited path that doesn't resolve to an existing file renders as red
 * strikethrough + ❌ in the TUI.
 *
 * The root is the code-mode workspace dir (set once by the app shell);
 * relative citations resolve against it. No caching — the file may be
 * created/deleted during a session and staleness would mislead the user.
 */
let citationRoot: string | undefined;

export function setCitationRoot(root: string): void {
  citationRoot = root;
}

/** True when a cited path resolves to an existing file (or directory). */
export function citationPathExists(path: string): boolean {
  if (!path) return false;
  const root = citationRoot ?? process.cwd();
  const abs = isAbsolute(path) ? path : resolve(root, path);
  try {
    return existsSync(abs);
  } catch {
    return false;
  }
}

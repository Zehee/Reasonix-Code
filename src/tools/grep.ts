// Grep tool — ported from upstream Reasonix (Go). Hard global cap of 200
// matches and an optional timeout_seconds guard to protect the prefix cache.

import { promises as fs } from "node:fs";
import * as pathMod from "node:path";
import { getRegexRunner } from "./fs/regex-runner.js";

export interface GrepContext {
  rootDir: string;
  maxListBytes: number;
  skipDirNames: ReadonlySet<string>;
  isBinaryByName: (name: string) => boolean;
}

const MAX_TOTAL_MATCHES = 200;
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 300;
const WALK_DEADLINE_MS = 120_000;
const REGEX_METACHARS = /[\\.+*?()[\]{}|^$]/;

function displayRel(rootDir: string, full: string): string {
  return pathMod.relative(rootDir, full).replaceAll("\\", "/");
}

function grepTimeout(sec: number | undefined): number {
  if (!sec || sec <= 0) return DEFAULT_TIMEOUT_SECONDS * 1000;
  return Math.min(sec, MAX_TIMEOUT_SECONDS) * 1000;
}

export async function runGrep(
  ctx: GrepContext,
  startAbs: string,
  args: {
    pattern: string;
    path?: string;
    timeout_seconds?: number;
    signal?: AbortSignal;
  },
): Promise<string> {
  const pattern = args.pattern;
  if (!pattern) {
    throw new Error("pattern is required");
  }

  const pathArg = args.path ?? ".";
  const target = pathMod.resolve(ctx.rootDir, pathArg);

  const timeoutMs = grepTimeout(args.timeout_seconds);
  const deadline = Date.now() + timeoutMs;

  const reFlags = "i";
  const hasMeta = REGEX_METACHARS.test(pattern);
  let reSource: string | null = null;
  if (hasMeta) {
    try {
      new RegExp(pattern, reFlags);
      reSource = pattern;
    } catch {
      reSource = null;
    }
  }
  const needle = pattern.toLowerCase();

  const matches: string[] = [];
  let totalBytes = 0;
  let scanned = 0;
  let truncated = false;
  let timedOut = false;
  const regexSkippedFiles: Array<{ rel: string; reason: string }> = [];

  const pushLine = (out: string): boolean => {
    if (totalBytes + out.length + 1 > ctx.maxListBytes) {
      matches.push(`[… truncated at ${ctx.maxListBytes} bytes — refine pattern or path …]`);
      truncated = true;
      return false;
    }
    matches.push(out);
    totalBytes += out.length + 1;
    return true;
  };

  const throwIfDone = (signal?: AbortSignal): void => {
    if (truncated) throw new Error("truncated");
    if (signal?.aborted) {
      throw new DOMException("grep aborted by user", "AbortError");
    }
    if (Date.now() > deadline) {
      timedOut = true;
      throw new Error("timeout");
    }
  };

  const searchFile = async (full: string): Promise<void> => {
    if (ctx.isBinaryByName(pathMod.basename(full))) return;

    let fh: import("node:fs/promises").FileHandle;
    try {
      fh = await fs.open(full, "r");
    } catch {
      return;
    }
    let raw: Buffer;
    try {
      throwIfDone(args.signal);
      const st = await fh.stat();
      if (st.size > 2 * 1024 * 1024) {
        await fh.close();
        return;
      }
      raw = await fh.readFile();
    } catch {
      await fh.close().catch(() => {});
      return;
    }
    await fh.close();

    throwIfDone(args.signal);
    const firstNul = raw.indexOf(0);
    if (firstNul !== -1 && firstNul < 8 * 1024) return;

    const text = raw.toString("utf8");
    const rel = displayRel(ctx.rootDir, full);
    let hits: number[];
    let lines: string[];

    if (reSource !== null) {
      lines = text.split(/\r?\n/);
      try {
        hits = await getRegexRunner().testLines(text, reSource, reFlags, {
          signal: args.signal,
        });
      } catch (err) {
        const reason = (err as Error).message;
        if (reason.includes("aborted")) throw err;
        regexSkippedFiles.push({ rel, reason });
        return;
      }
    } else {
      const haystack = text.toLowerCase();
      if (haystack.indexOf(needle) === -1) {
        scanned++;
        return;
      }
      lines = text.split(/\r?\n/);
      hits = [];
      for (let li = 0; li < lines.length; li++) {
        if (lines[li]!.toLowerCase().includes(needle)) hits.push(li);
      }
    }

    scanned++;
    if (hits.length === 0) return;

    for (const li of hits) {
      if (matches.length >= MAX_TOTAL_MATCHES) {
        truncated = true;
        return;
      }
      const line = lines[li]!;
      const display = line.length > 200 ? `${line.slice(0, 200)}…` : line;
      if (!pushLine(`${rel}:${li + 1}: ${display}`)) return;
    }
  };

  const walk = async (dir: string): Promise<void> => {
    if (truncated) return;
    throwIfDone(args.signal);

    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (truncated) return;
      throwIfDone(args.signal);
      if (e.isDirectory()) {
        if (ctx.skipDirNames.has(e.name)) continue;
        await walk(pathMod.join(dir, e.name));
        continue;
      }
      if (!e.isFile()) continue;
      await searchFile(pathMod.join(dir, e.name));
    }
  };

  let info: import("node:fs").Stats | undefined;
  try {
    info = await fs.stat(target);
  } catch (err) {
    throw new Error(`grep ${pathArg}: ${(err as Error).message}`);
  }

  try {
    if (info.isDirectory()) {
      await walk(target);
    } else {
      await searchFile(target);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "truncated" || msg === "timeout") {
      // fall through to formatter
    } else {
      throw e;
    }
  }

  if (regexSkippedFiles.length > 0) {
    pushLine(
      `[regex timed out on ${regexSkippedFiles.length} file${regexSkippedFiles.length === 1 ? "" : "s"} — pattern may have catastrophic backtracking; first: ${regexSkippedFiles[0]!.rel}]`,
    );
  }

  if (matches.length === 0) {
    if (timedOut) {
      return `(no matches; timed out after ${timeoutMs / 1000}s — narrow the path/pattern or raise timeout_seconds)`;
    }
    return scanned === 0
      ? "(no files scanned — path empty or all files filtered out)"
      : `(no matches across ${scanned} file${scanned === 1 ? "" : "s"})`;
  }

  let res = matches.join("\n");
  if (truncated) {
    res += `\n... (truncated at ${MAX_TOTAL_MATCHES} matches)`;
  } else if (timedOut) {
    res += `\n... (timed out after ${timeoutMs / 1000}s; results incomplete — narrow the path/pattern or raise timeout_seconds)`;
  }
  return res;
}

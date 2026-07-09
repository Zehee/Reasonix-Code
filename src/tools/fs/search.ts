import { promises as fs } from "node:fs";
import * as pathMod from "node:path";

export interface SearchContext {
  rootDir: string;
  maxListBytes: number;
  skipDirNames: ReadonlySet<string>;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DOMException("search aborted by user", "AbortError");
}

function displayRel(rootDir: string, full: string): string {
  return pathMod.relative(rootDir, full).replaceAll("\\", "/");
}

export async function searchFiles(
  ctx: Pick<SearchContext, "rootDir" | "maxListBytes" | "skipDirNames">,
  startAbs: string,
  args: { pattern: string; include_deps?: boolean; signal?: AbortSignal },
): Promise<string> {
  throwIfAborted(args.signal);
  const needle = args.pattern.toLowerCase();
  const includeDeps = args.include_deps === true;
  let re: RegExp | null = null;
  try {
    re = new RegExp(args.pattern, "i");
  } catch {
    re = null;
  }
  const matches: string[] = [];
  let totalBytes = 0;
  const walk = async (dir: string): Promise<void> => {
    throwIfAborted(args.signal);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      throwIfAborted(args.signal);
      const full = pathMod.join(dir, e.name);
      const lower = e.name.toLowerCase();
      const hit = re ? re.test(e.name) : lower.includes(needle);
      if (hit) {
        const rel = displayRel(ctx.rootDir, full);
        if (totalBytes + rel.length + 1 > ctx.maxListBytes) {
          matches.push("[… search truncated — refine pattern …]");
          return;
        }
        matches.push(rel);
        totalBytes += rel.length + 1;
      }
      if (e.isDirectory()) {
        if (!includeDeps && ctx.skipDirNames.has(e.name)) continue;
        await walk(full);
      }
    }
  };
  await walk(startAbs);
  return matches.length === 0 ? "(no matches)" : matches.join("\n");
}



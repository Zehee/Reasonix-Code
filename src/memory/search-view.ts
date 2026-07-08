/** Search view storage for persisted query snapshots. */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { workspaceSlug } from "./session.js";

export interface SearchCluster {
  sessionId: string;
  sessionName?: string;
  hitTurnId: number;
  memberCount: number;
  members: Array<{ sessionId: string; sessionName?: string; turnId: number; timestamp?: string }>;
}

export interface SearchView {
  query: string;
  createdAt: string;
  totalMatches: number;
  totalRefined: number;
  clusters: SearchCluster[];
}

export function searchViewsDir(): string {
  const cwd = process.cwd();
  const slug = workspaceSlug(cwd);
  return join(homedir(), ".reasonix", "refined", slug, "searches");
}

function searchViewPath(viewId: string): string {
  return join(searchViewsDir(), `${viewId}.json`);
}

function sanitizeQueryForFilename(query: string): string {
  return query.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_").slice(0, 64);
}

export async function saveSearchView(view: SearchView): Promise<string> {
  const dir = searchViewsDir();
  await mkdir(dir, { recursive: true });
  const id = `${sanitizeQueryForFilename(view.query)}_${Date.now()}`;
  await writeFile(searchViewPath(id), JSON.stringify(view, null, 2), "utf8");
  return id;
}

export async function loadSearchView(viewId: string): Promise<SearchView | undefined> {
  try {
    const raw = await readFile(searchViewPath(viewId), "utf8");
    return JSON.parse(raw) as SearchView;
  } catch {
    return undefined;
  }
}

export async function listSearchViews(): Promise<SearchView[]> {
  const dir = searchViewsDir();
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    const views: SearchView[] = [];
    for (const f of files) {
      const raw = await readFile(join(dir, f), "utf8");
      try {
        views.push(JSON.parse(raw) as SearchView);
      } catch {
        // skip malformed
      }
    }
    return views.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

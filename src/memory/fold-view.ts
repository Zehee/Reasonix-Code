/** Fold view storage for persisted decision clusters. */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { DecisionCluster } from "../refine/cluster.js";
import { workspaceSlug } from "./session.js";

export interface FoldView {
  fold_id: string;
  session_id: string;
  parent_fold_id?: string;
  created_at: string;
  /** Inclusive turn id range [start, end] that was folded. */
  source_turn_range: [number, number];
  /** High-level recursive summary of all clusters in this fold. */
  summary: string;
  /** Decision clusters produced from the denoised turns. */
  clusters: DecisionCluster[];
}

export function foldViewsDir(): string {
  const cwd = process.cwd();
  const slug = workspaceSlug(cwd);
  return join(homedir(), ".reasonix", "refined", slug, "folds");
}

export function foldViewPath(foldId: string): string {
  return join(foldViewsDir(), `${foldId}.json`);
}

export async function saveFoldView(view: FoldView): Promise<void> {
  const dir = foldViewsDir();
  await mkdir(dir, { recursive: true });
  await writeFile(foldViewPath(view.fold_id), JSON.stringify(view, null, 2), "utf8");
}

export async function loadFoldView(foldId: string): Promise<FoldView | undefined> {
  try {
    const raw = await readFile(foldViewPath(foldId), "utf8");
    return JSON.parse(raw) as FoldView;
  } catch {
    return undefined;
  }
}

export async function listFoldViews(): Promise<FoldView[]> {
  const dir = foldViewsDir();
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    const views: FoldView[] = [];
    for (const f of files) {
      const raw = await readFile(join(dir, f), "utf8");
      try {
        views.push(JSON.parse(raw) as FoldView);
      } catch {
        // skip malformed
      }
    }
    return views.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return [];
  }
}

export async function listFoldViewsForSession(sessionId: string): Promise<FoldView[]> {
  const all = await listFoldViews();
  return all.filter((v) => v.session_id === sessionId);
}

/**
 * Build a concise fold summary from clusters.
 */
export function buildFoldSummaryText(clusters: DecisionCluster[]): string {
  if (clusters.length === 0) return "No prior decisions recorded.";
  const lines: string[] = ["Prior fold summary — key decisions and files:"];
  for (const c of clusters) {
    const timeRange = `${c.chronological_range[0].slice(0, 10)} to ${c.chronological_range[1].slice(0, 10)}`;
    lines.push(`\n[${c.cluster_id}] ${c.topic} (${timeRange})`);
    if (c.decision) lines.push(`  Decision: ${c.decision}`);
    if (c.file_refs.length > 0) lines.push(`  Files: ${c.file_refs.join(", ")}`);
    if (c.facts.length > 0) {
      for (const fact of c.facts.slice(0, 3)) {
        lines.push(`  - ${fact}`);
      }
    }
  }
  return lines.join("\n");
}

/** Deterministic clustering of denoised turns into decision/topic clusters. */

import type { DenoisedTurn } from "./denoise.js";

export interface TurnRef {
  /** Turn id, matching the original turnId. */
  turnid: number;
  /** ISO timestamp when the turn occurred. */
  createdtime: string;
  /** Compressed user intent. */
  intent?: string;
  /** Assistant conclusion / lead. */
  conclusion?: string;
  /** Files referenced in this turn. */
  files: string[];
  /** Tool names invoked in this turn. */
  tools: string[];
}

export interface DecisionCluster {
  cluster_id: string;
  topic: string;
  decision: string;
  facts: string[];
  file_refs: string[];
  /** Lightweight turn references with id, time, intent, conclusion, files, tools. */
  turns: TurnRef[];
  status: "resolved" | "ongoing" | "superseded";
  /** Time range [start, end] of turns in this cluster. */
  chronological_range: [string, string];
}

function normalizeTime(ts: string | undefined): string {
  return ts || new Date(0).toISOString();
}

function buildTurnRef(turn: DenoisedTurn): TurnRef {
  return {
    turnid: turn.turnId,
    createdtime: normalizeTime(turn.timestamp),
    intent: turn.userIntent || undefined,
    conclusion: turn.assistantConclusion || undefined,
    files: turn.files,
    tools: turn.toolsCalled.map((t) => t.name),
  };
}

function sharedTokenScore(a: string, b: string): number {
  const tokensA = new Set(a.split(/\s+/).filter((t) => t.length > 2));
  const tokensB = b.split(/\s+/).filter((t) => t.length > 2);
  let shared = 0;
  for (const t of tokensB) {
    if (tokensA.has(t)) shared++;
  }
  return shared;
}

function mergeClusters(a: DecisionCluster, b: DecisionCluster): DecisionCluster {
  const allTurns = [...a.turns, ...b.turns];
  allTurns.sort((x, y) => x.turnid - y.turnid);
  const uniqueTurns = allTurns.filter(
    (t, i, arr) => i === 0 || t.turnid !== arr[i - 1]!.turnid,
  );
  const times = uniqueTurns.map((t) => t.createdtime);
  const allFiles = new Set([...a.file_refs, ...b.file_refs]);
  const allFacts = new Set([...a.facts, ...b.facts]);
  const aDecision = a.decision || a.topic;
  const bDecision = b.decision || b.topic;

  return {
    cluster_id: a.cluster_id,
    topic: a.topic || b.topic,
    decision: aDecision || bDecision,
    facts: Array.from(allFacts),
    file_refs: Array.from(allFiles),
    turns: uniqueTurns,
    status: a.status === "ongoing" || b.status === "ongoing" ? "ongoing" : a.status,
    chronological_range: [
      times.reduce((min, t) => (t < min ? t : min), times[0] || new Date(0).toISOString()),
      times.reduce((max, t) => (t > max ? t : max), times[0] || new Date(0).toISOString()),
    ],
  };
}

function createSingletonCluster(turn: DenoisedTurn, index: number): DecisionCluster {
  const time = normalizeTime(turn.timestamp);
  const topic = turn.userIntent || turn.assistantConclusion || `turn-${turn.turnId}`;
  return {
    cluster_id: `c-${turn.turnId}-${index}`,
    topic,
    decision: turn.assistantConclusion,
    facts: turn.userIntent ? [turn.userIntent] : [],
    file_refs: [...turn.files],
    turns: [buildTurnRef(turn)],
    status: "resolved",
    chronological_range: [time, time],
  };
}

/** Cluster denoised turns deterministically into decision/topic clusters. */
export function clusterDenoisedTurns(turns: DenoisedTurn[]): DecisionCluster[] {
  if (turns.length === 0) return [];

  // Start singleton.
  let clusters = turns.map((t, i) => createSingletonCluster(t, i));

  // Greedily merge adjacent clusters that share files/tools/keywords.
  let changed = true;
  const MERGE_THRESHOLD = 2;
  while (changed) {
    changed = false;
    const next: DecisionCluster[] = [];
    for (let i = 0; i < clusters.length; i++) {
      const current = clusters[i]!;
      if (i === clusters.length - 1) {
        next.push(current);
        break;
      }
      const sigCurrent = [
        current.topic,
        current.decision,
        ...current.facts,
        ...current.file_refs,
      ].join(" ");
      const nextCluster = clusters[i + 1]!;
      const sigNext = [
        nextCluster.topic,
        nextCluster.decision,
        ...nextCluster.facts,
        ...nextCluster.file_refs,
      ].join(" ");
      const sharedFiles = current.file_refs.some((f) => nextCluster.file_refs.includes(f));
      const score = sharedTokenScore(sigCurrent, sigNext) + (sharedFiles ? 2 : 0);
      if (score >= MERGE_THRESHOLD) {
        next.push(mergeClusters(current, nextCluster));
        i++; // skip next
        changed = true;
      } else {
        next.push(current);
      }
    }
    clusters = next;
  }

  // Re-sort by first turn id and assign stable ids.
  clusters.sort((a, b) => a.turns[0]!.turnid - b.turns[0]!.turnid);
  return clusters.map((c, i) => ({ ...c, cluster_id: `c-${i + 1}` }));
}

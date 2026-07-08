/**
 * Refine / search tools: search_context and load_turns_context.
 *
 * Denoising is now performed automatically during fold and on-demand when a
 * live session turn is searched. There is no standalone refine_session_turns
 * tool.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ARCHIVE_MARKER } from "../memory/archiver.js";
import { listFoldViews, listFoldViewsForSession } from "../memory/fold-view.js";
import {
  type SearchCluster,
  type SearchView,
  listSearchViews,
  saveSearchView,
} from "../memory/search-view.js";
import {
  loadSessionMessages,
  loadSessionMeta,
  sessionPath,
  sessionsDir,
} from "../memory/session.js";
import { denoiseTurn } from "../refine/denoise.js";
import { messagesToRawTurns } from "../refine/raw-turns.js";
import { getRefinedManager } from "../refine/refined-manager.js";
import { scoreText } from "../refine/utils/search.js";
import type { ToolCallContext, ToolRegistry } from "../tools.js";

/**
 * Find the most recent session name in the current workspace if no explicit
 * session name is provided to search_context.
 */
function resolveCurrentSessionName(sessionName?: string): string | undefined {
  if (sessionName) return sessionName;
  const dir = sessionsDir();
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir)
    .filter(
      (f) =>
        f.endsWith(".jsonl") &&
        !f.endsWith(".events.jsonl") &&
        !f.endsWith(".toolcache.jsonl") &&
        !f.endsWith(".denoised.jsonl"),
    )
    .sort()
    .reverse();
  return files.length > 0 ? files[0]!.replace(/\.jsonl$/, "") : undefined;
}

/**
 * Parse a session's JSONL file into RawTurns.
 * Each user→assistant cycle is grouped as one turn (turnId from the messages).
 */
function sessionToRawTurns(sessionName: string): {
  sessionId: string;
  sessionName: string;
  turns: import("../refine/types.js").RawTurn[];
} {
  const messages = loadSessionMessages(sessionName);
  const meta = loadSessionMeta(sessionName);
  const sessionId = meta.sessionId ?? sessionName;
  return { sessionId, sessionName, turns: messagesToRawTurns(messages) };
}

/**
 * Search the current (live) session's messages and return denoised turns that
 * match the query. Also persists those live turns to the refined index.
 */
async function searchLiveSession(
  sessionName: string,
  query: string,
  limit: number,
): Promise<
  Array<{
    sessionId: string;
    sessionName: string;
    turnId: number;
    score: number;
    timestamp?: string;
  }>
> {
  const { sessionId, sessionName: name, turns } = sessionToRawTurns(sessionName);
  if (turns.length === 0) return [];

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return [];

  const denoised = turns.map((turn) =>
    denoiseTurn(turn, { sessionId, sessionName: name, source: "search" }),
  );

  const scored = denoised
    .map((turn) => {
      const haystack = [
        turn.userIntent,
        turn.assistantConclusion,
        ...turn.files,
        ...turn.toolsCalled.map((t) => t.name),
        ...turn.errors,
      ].join(" ");
      const score = scoreText(haystack, terms);
      return {
        sessionId,
        sessionName: name,
        turnId: turn.turnId,
        score,
        timestamp: turn.timestamp,
      };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length > 0) {
    const manager = getRefinedManager();
    await manager.saveDenoisedTurns(denoised);
    manager.recordTurnAttention(
      query,
      scored.map((s) => ({ sessionId: s.sessionId, turnId: s.turnId })),
    );
  }

  return scored;
}

export function registerRefineTools(registry: ToolRegistry): ToolRegistry {
  registry.register({
    name: "search_context",
    description: `Search conversation history across sessions and return matching turns grouped into clusters. Searches the denoised/refined index first; for the current live session, denoises on demand and records attention weights.

Parameters:
- query: search keywords (required)
- sessionName: current session name (optional; defaults to the most recent session)
- maxClusters: maximum clusters to return (default 5)
- detail: "compact" | "normal" (default "normal")

Returns matched turns grouped by session, with summaries, facts, and notes.`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords" },
        sessionName: { type: "string", description: "Current session name, optional" },
        maxClusters: { type: "number", description: "Maximum clusters to return, default 5" },
        detail: {
          type: "string",
          enum: ["compact", "normal"],
          description: "Detail level, default normal",
        },
      },
      required: ["query"],
    },
    fn: async (args: Record<string, unknown>, _ctx?: ToolCallContext): Promise<string> => {
      const query = String(args.query ?? "");
      const explicitSessionName = String(args.sessionName ?? "");
      const maxClusters = Number(args.maxClusters ?? 5);
      const detail = String(args.detail ?? "normal");

      if (!query.trim()) {
        return "search_context: query is required";
      }

      const manager = getRefinedManager();

      // 1. Search the denoised/refined corpus.
      const refinedMatches = manager.searchRefinedTurns({ query, limit: maxClusters * 4 });

      // 2. Search the current live session (on-demand denoise).
      const currentSessionName = resolveCurrentSessionName(explicitSessionName || undefined);
      let liveMatches: Array<{
        sessionId: string;
        sessionName: string;
        turnId: number;
        score: number;
        timestamp?: string;
      }> = [];
      if (currentSessionName) {
        liveMatches = await searchLiveSession(currentSessionName, query, maxClusters * 4);
      }

      type Match = {
        sessionId: string;
        sessionName: string;
        turnId: number;
        score: number;
        timestamp?: string;
      };

      // 3. Merge and deduplicate.
      const merged = new Map<string, Match>();
      for (const m of refinedMatches) {
        const key = `${m.sessionId}:${m.turnId}`;
        merged.set(key, {
          sessionId: m.sessionId,
          sessionName: m.sessionName ?? m.sessionId,
          turnId: m.turnId,
          score: m.score,
          timestamp: m.timestamp,
        });
      }
      for (const m of liveMatches) {
        const key = `${m.sessionId}:${m.turnId}`;
        const existing = merged.get(key);
        if (existing) {
          existing.score = Math.max(existing.score, m.score);
        } else {
          merged.set(key, m);
        }
      }

      const matches = Array.from(merged.values()).sort((a, b) => b.score - a.score);

      if (matches.length === 0) {
        return `No matches found for "${query}".`;
      }

      // Record attention weights for all returned matches.
      manager.recordTurnAttention(
        query,
        matches.map((m) => ({ sessionId: m.sessionId, turnId: m.turnId })),
      );

      // 4. Build search view and save it.
      const bySession = new Map<string, Match[]>();
      for (const m of matches) {
        const list = bySession.get(m.sessionName) ?? [];
        list.push(m);
        bySession.set(m.sessionName, list);
      }

      const clusters: SearchCluster[] = [];
      for (const [sname, ms] of bySession) {
        const picked = ms.slice(0, maxClusters);
        for (const m of picked) {
          clusters.push({
            sessionId: m.sessionId,
            sessionName: sname,
            hitTurnId: m.turnId,
            memberCount: 1,
            members: [
              {
                sessionId: m.sessionId,
                sessionName: sname,
                turnId: m.turnId,
                timestamp: m.timestamp,
              },
            ],
          });
        }
      }

      const searchView: SearchView = {
        query,
        createdAt: new Date().toISOString(),
        totalMatches: matches.length,
        totalRefined: refinedMatches.length,
        clusters,
      };
      await saveSearchView(searchView);

      // 5. Format response.
      const lines: string[] = [
        `Found ${matches.length} matches in ${bySession.size} sessions for "${query}":`,
      ];

      for (const [sname, ms] of bySession) {
        lines.push(`\n## Session: ${sname} (${ms.length} matches)`);
        const cluster = ms.slice(0, maxClusters);
        for (const m of cluster) {
          const refined = manager.loadRefinedTurn(m.sessionId, m.turnId);
          if (detail === "compact") {
            lines.push(`  turn ${m.turnId}: ${refined?.summary.slice(0, 120) ?? ""}`);
          } else {
            lines.push(`\n### Turn ${m.turnId} (score: ${m.score})`);
            lines.push(`Summary: ${refined?.summary ?? ""}`);
            if ((refined?.facts.length ?? 0) > 0) {
              lines.push(`Facts:\n${refined!.facts.map((f: string) => `  - ${f}`).join("\n")}`);
            }
            if ((refined?.notes.length ?? 0) > 0) {
              lines.push(`Notes:\n${refined!.notes.map((n: string) => `  - ${n}`).join("\n")}`);
            }
          }
        }
      }

      return lines.join("\n");
    },
  });

  registry.register({
    name: "load_turns_context",
    description: `Batch-load original content for the specified session turns. Reads session JSONL and archived JSONL, restoring compressed tool results.

Parameters:
- references: array of { sessionName, turnId } to load (required, max 20)
- mode: "full" | "material" (default "full")
  - full: full user + assistant + tool messages
  - material: only tool calls and tool results, avoiding duplicate skeleton from search_context

Returns each turn's messages. Missing references are listed in notFound.

Typical use:
1. search_context returns matching turns (skeleton).
2. Call load_turns_context when original content is needed; mode="material" fetches only tool material.
3. Analyze or decide based on the full content.`,
    parameters: {
      type: "object",
      properties: {
        references: {
          type: "array",
          description: "Array of { sessionName, turnId } references",
          items: {
            type: "object",
            properties: {
              sessionName: { type: "string", description: "Session name" },
              turnId: { type: "number", description: "Turn number" },
            },
            required: ["sessionName", "turnId"],
          },
        },
        mode: {
          type: "string",
          enum: ["full", "material"],
          description: "Loading mode: full messages, or material (tool calls and results only)",
        },
      },
      required: ["references"],
    },
    fn: async (args: Record<string, unknown>, _ctx?: ToolCallContext): Promise<string> => {
      const rawRefs = args.references;
      const mode = String(args.mode ?? "full");
      if (!Array.isArray(rawRefs) || rawRefs.length === 0) {
        return JSON.stringify({
          error: "references must be a non-empty array",
          rounds: [],
          notFound: [],
        });
      }

      const refs = rawRefs
        .filter(
          (r): r is { sessionName: string; turnId: number } =>
            r !== null &&
            typeof r === "object" &&
            typeof (r as Record<string, unknown>).sessionName === "string" &&
            typeof (r as Record<string, unknown>).turnId === "number",
        )
        .slice(0, 20);

      if (refs.length === 0) {
        return JSON.stringify({ error: "no valid references", rounds: [], notFound: [] });
      }

      // Group by sessionName
      const bySession = new Map<string, Set<number>>();
      for (const ref of refs) {
        if (!bySession.has(ref.sessionName)) {
          bySession.set(ref.sessionName, new Set<number>());
        }
        bySession.get(ref.sessionName)!.add(ref.turnId);
      }

      const rounds: Array<{
        sessionName: string;
        turnId: number;
        messages: import("../types.js").ChatMessage[];
      }> = [];
      const notFound: Array<{ sessionName: string; turnId: number }> = [];

      for (const [sessionName, turnIds] of bySession.entries()) {
        let messages: import("../types.js").ChatMessage[];
        try {
          messages = loadSessionMessages(sessionName);
        } catch {
          for (const turnId of turnIds) notFound.push({ sessionName, turnId });
          continue;
        }

        // Restore archived content
        restoreArchivedContentSync(sessionName, messages);

        // Group messages by turn: user → … → next user or end
        let currentTurnMessages: import("../types.js").ChatMessage[] = [];
        let currentTurnId: number | undefined;
        const turnMap = new Map<number, import("../types.js").ChatMessage[]>();

        for (const msg of messages) {
          const msgTurnId = msg.turnId ?? 0;
          if (
            msg.role === "user" &&
            currentTurnId !== undefined &&
            currentTurnMessages.length > 0
          ) {
            turnMap.set(currentTurnId, currentTurnMessages);
            currentTurnMessages = [];
          }
          if (msg.role === "user") {
            currentTurnId = msgTurnId;
          }
          currentTurnMessages.push(msg);
        }
        if (currentTurnId !== undefined && currentTurnMessages.length > 0) {
          turnMap.set(currentTurnId, currentTurnMessages);
        }

        for (const turnId of turnIds) {
          const turnMessages = turnMap.get(turnId);
          if (!turnMessages) {
            notFound.push({ sessionName, turnId });
            continue;
          }
          const filtered =
            mode === "material"
              ? turnMessages.filter(
                  (m) =>
                    m.role === "tool" ||
                    (m.role === "assistant" &&
                      Array.isArray(m.tool_calls) &&
                      m.tool_calls.length > 0),
                )
              : turnMessages;
          rounds.push({ sessionName, turnId, messages: filtered });
        }
      }

      return JSON.stringify({ rounds, notFound });
    },
  });

  registry.register({
    name: "list_search_views",
    description: `List saved search_context snapshots. Optionally filter by session.

Parameters:
- sessionId: optional session identifier filter

Returns an array of { id, query, createdAt, totalMatches, sessions }.`,
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Optional session identifier filter" },
      },
    },
    fn: async (args: Record<string, unknown>, _ctx?: ToolCallContext): Promise<string> => {
      const sessionId = String(args.sessionId ?? "");
      const views = await listSearchViews();
      const filtered = sessionId
        ? views.filter((v) =>
            v.clusters.some((c) => c.sessionId === sessionId || c.sessionName === sessionId),
          )
        : views;
      const result = filtered.map((v) => ({
        id: v.id,
        query: v.query,
        createdAt: v.createdAt,
        totalMatches: v.totalMatches,
        sessions: [...new Set(v.clusters.flatMap((c) => c.sessionName ?? c.sessionId))],
      }));
      return JSON.stringify(result, null, 2);
    },
  });

  registry.register({
    name: "list_fold_views",
    description: `List saved fold snapshots. Optionally filter by session.

Parameters:
- sessionId: optional session identifier filter

Returns an array of { foldId, sessionId, parentFoldId, createdAt, summary, clusterCount }.`,
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Optional session identifier filter" },
      },
    },
    fn: async (args: Record<string, unknown>, _ctx?: ToolCallContext): Promise<string> => {
      const sessionId = String(args.sessionId ?? "");
      const views = sessionId ? await listFoldViewsForSession(sessionId) : await listFoldViews();
      const result = views.map((v) => ({
        foldId: v.fold_id,
        sessionId: v.session_id,
        parentFoldId: v.parent_fold_id,
        createdAt: v.created_at,
        summary: v.summary,
        clusterCount: v.clusters.length,
      }));
      return JSON.stringify(result, null, 2);
    },
  });

  return registry;
}

/**
 * Synchronously load archive entries and restore archived tool content
 * in a messages array. Used by load_turns_context so the full original
 * content is available even after proactive archiving.
 */
function restoreArchivedContentSync(
  sessionName: string,
  messages: import("../types.js").ChatMessage[],
): void {
  // Archive path = sessionPath + .toolcache.jsonl
  const archivePath = `${sessionPath(sessionName)}.toolcache.jsonl`;
  try {
    if (!existsSync(archivePath)) return;
    const raw = readFileSync(archivePath, "utf-8");
    const entries = new Map<string, string>();
    for (const line of raw.split("\n").filter(Boolean)) {
      const parsed = JSON.parse(line) as { toolCallId: string; content: string };
      if (parsed.toolCallId) {
        entries.set(parsed.toolCallId, parsed.content);
      }
    }
    if (entries.size === 0) return;
    for (const msg of messages) {
      if (msg.role !== "tool") continue;
      if (typeof msg.content !== "string") continue;
      if (!msg.content.startsWith(ARCHIVE_MARKER)) continue;
      const id = msg.tool_call_id ?? "";
      const original = entries.get(id);
      if (original) {
        msg.content = original;
      }
    }
  } catch {
    // Best-effort.
  }
}

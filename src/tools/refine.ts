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
import { type SearchCluster, type SearchView, saveSearchView } from "../memory/search-view.js";
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
  turns: import("../refine/types.js").RawTurn[];
} {
  const messages = loadSessionMessages(sessionName);
  const meta = loadSessionMeta(sessionName);
  const sessionId = meta.sessionId ?? sessionName;
  return { sessionId, turns: messagesToRawTurns(messages) };
}

/**
 * Search the current (live) session's messages and return denoised turns that
 * match the query. Also persists those live turns to the refined index.
 */
async function searchLiveSession(
  sessionName: string,
  query: string,
  limit: number,
): Promise<Array<{ sessionId: string; turnId: number; score: number; timestamp?: string }>> {
  const { sessionId, turns } = sessionToRawTurns(sessionName);
  if (turns.length === 0) return [];

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return [];

  const denoised = turns.map((turn) => denoiseTurn(turn, { sessionId, source: "search" }));

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
      return { sessionId, turnId: turn.turnId, score, timestamp: turn.timestamp };
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
    description: `跨会话搜索历史对话，返回匹配的对话轮次（按时间窗口聚簇）。搜索会先查已降噪的索引库；如果涉及当前未折叠的会话，会按需降噪并入库，同时记录搜索权重。

参数:
- query: 搜索关键词（必填）
- sessionName: 当前会话名称（可选，不填则使用最近会话）
- maxClusters: 最多返回多少个簇（默认 5）
- detail: "compact" | "normal"（默认 "normal"）

返回匹配的对话轮次列表，按 session 分组聚簇，包含上下文片段。`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        sessionName: { type: "string", description: "当前会话名称，可选" },
        maxClusters: { type: "number", description: "最多返回簇数，默认 5" },
        detail: {
          type: "string",
          enum: ["compact", "normal"],
          description: "详情级别，默认 normal",
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
        turnId: number;
        score: number;
        timestamp?: string;
      }> = [];
      if (currentSessionName) {
        liveMatches = await searchLiveSession(currentSessionName, query, maxClusters * 4);
      }

      // 3. Merge and deduplicate.
      const merged = new Map<
        string,
        { sessionId: string; turnId: number; score: number; timestamp?: string }
      >();
      for (const m of refinedMatches) {
        const key = `${m.sessionId}:${m.turnId}`;
        merged.set(key, {
          sessionId: m.sessionId,
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
      const bySession = new Map<string, typeof matches>();
      for (const m of matches) {
        const list = bySession.get(m.sessionId) ?? [];
        list.push(m);
        bySession.set(m.sessionId, list);
      }

      const clusters: SearchCluster[] = [];
      for (const [sid, ms] of bySession) {
        const picked = ms.slice(0, maxClusters);
        for (const m of picked) {
          clusters.push({
            sessionId: sid,
            hitTurnId: m.turnId,
            memberCount: 1,
            members: [{ sessionId: sid, turnId: m.turnId, timestamp: m.timestamp }],
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

      for (const [sid, ms] of bySession) {
        lines.push(`\n## Session: ${sid} (${ms.length} matches)`);
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
    description: `批量加载指定会话轮次的完整原始内容。读取 session JSONL 和归档 JSONL，还原被压缩的工具结果。

参数:
- references: 要加载的 { sessionName, turnId } 引用数组（必填，最多 20 个）

返回每轮的完整对话内容（user + assistant + tool 消息原文）。
找不到的引用会列在 notFound 中。

典型用途：
1. 先用 search_context 搜索到匹配的轮次
2. 然后用 load_turns_context 加载这些轮次的完整内容
3. 基于完整内容做分析或决策`,
    parameters: {
      type: "object",
      properties: {
        references: {
          type: "array",
          description: "{ sessionName, turnId } 引用数组",
          items: {
            type: "object",
            properties: {
              sessionName: { type: "string", description: "会话名称" },
              turnId: { type: "number", description: "轮次编号" },
            },
            required: ["sessionName", "turnId"],
          },
        },
      },
      required: ["references"],
    },
    fn: async (args: Record<string, unknown>, _ctx?: ToolCallContext): Promise<string> => {
      const rawRefs = args.references;
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
          if (turnMessages) {
            rounds.push({ sessionName, turnId, messages: turnMessages });
          } else {
            notFound.push({ sessionName, turnId });
          }
        }
      }

      return JSON.stringify({ rounds, notFound });
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

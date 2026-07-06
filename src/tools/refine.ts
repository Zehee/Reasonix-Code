/**
 * Refine tools: search_context and refine_session_turns.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ARCHIVE_MARKER } from "../memory/archiver.js";
import {
  loadSessionMessages,
  loadSessionMeta,
  sessionPath,
  sessionsDir,
  workspaceSlug,
} from "../memory/session.js";
import { RefinedManager } from "../refine/refined-manager.js";
import type { RawAction, RawTurn, RefinedTurn } from "../refine/types.js";
import type { ToolCallContext, ToolRegistry } from "../tools.js";

function getRefinedRoot(): string {
  const cwd = process.cwd();
  const slug = workspaceSlug(cwd);
  return join(homedir(), ".reasonix", "refined", slug);
}

let _refinedManager: RefinedManager | null = null;

function refinedManager(): RefinedManager {
  if (!_refinedManager) {
    _refinedManager = new RefinedManager(getRefinedRoot());
  }
  return _refinedManager;
}

/**
 * Parse a session's JSONL file into RawTurns.
 * Each user→assistant cycle is grouped as one turn (turnId from the messages).
 */
function sessionToRawTurns(sessionName: string): { sessionId: string; turns: RawTurn[] } {
  const messages = loadSessionMessages(sessionName);
  const meta = loadSessionMeta(sessionName);
  const sessionId = meta.sessionId ?? sessionName;

  const turns: RawTurn[] = [];
  let currentTurnId = 0;
  let currentUser = "";
  let currentAgent = "";
  let currentActions: RawAction[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      // Flush previous turn
      if (currentUser || currentAgent) {
        turns.push({
          turnId: currentTurnId,
          timestamp: undefined,
          user: currentUser,
          agent: currentAgent,
          agentText: currentAgent,
          actions: currentActions,
        });
      }
      currentTurnId = msg.turnId ?? currentTurnId + 1;
      currentUser = msg.content ?? "";
      currentAgent = "";
      currentActions = [];
    } else if (msg.role === "assistant") {
      currentAgent = (currentAgent + "\n" + (msg.content ?? "")).trim();
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          currentActions.push({
            name: tc.function?.name ?? "unknown",
            args: tc.function?.arguments,
          });
        }
      }
    } else if (msg.role === "tool") {
      currentActions.push({
        name: msg.name ?? "tool",
        args: {},
        result: msg.content,
      });
    }
  }
  // Flush last turn
  if (currentUser || currentAgent) {
    turns.push({
      turnId: currentTurnId,
      timestamp: undefined,
      user: currentUser,
      agent: currentAgent,
      agentText: currentAgent,
      actions: currentActions,
    });
  }

  return { sessionId, turns };
}

export function registerRefineTools(registry: ToolRegistry): ToolRegistry {
  registry.register({
    name: "search_context",
    description: `跨会话搜索历史对话，返回匹配的对话轮次（按时间窗口聚簇）。搜索命中未提炼的 turn 时自动提炼入库。

参数:
- query: 搜索关键词（必填）
- maxClusters: 最多返回多少个簇（默认 5）
- detail: "compact" | "normal"（默认 "normal"）

返回匹配的对话轮次列表，按 session 分组聚簇，包含上下文片段。`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
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
      const maxClusters = Number(args.maxClusters ?? 5);
      const detail = String(args.detail ?? "normal");

      if (!query.trim()) {
        return "search_context: query is required";
      }

      const manager = refinedManager();

      // Search refined turns
      const matches = await manager.searchRefinedTurns({ query, limit: maxClusters * 4 });

      if (matches.length === 0) {
        return `No matches found for "${query}".`;
      }

      // Group by session
      const bySession = new Map<string, typeof matches>();
      for (const m of matches) {
        const list = bySession.get(m.sessionId) ?? [];
        list.push(m);
        bySession.set(m.sessionId, list);
      }

      const lines: string[] = [
        `Found ${matches.length} matches in ${bySession.size} sessions for "${query}":`,
      ];

      for (const [sid, ms] of bySession) {
        lines.push(`\n## Session: ${sid} (${ms.length} matches)`);
        const cluster = ms.slice(0, maxClusters);
        for (const m of cluster) {
          if (detail === "compact") {
            lines.push(`  turn ${m.turnId}: ${m.summary.slice(0, 120)}`);
          } else {
            lines.push(`\n### Turn ${m.turnId} (score: ${m.score})`);
            lines.push(`Summary: ${m.summary}`);
            if (m.facts.length > 0) {
              lines.push(`Facts:\n${m.facts.map((f: string) => `  - ${f}`).join("\n")}`);
            }
            if (m.notes.length > 0) {
              lines.push(`Notes:\n${m.notes.map((n: string) => `  - ${n}`).join("\n")}`);
            }
          }
        }
      }

      return lines.join("\n");
    },
  });

  registry.register({
    name: "refine_session_turns",
    description: `手动触发某个 session 的提炼。读取 session 的 JSONL 文件 → 提取结构化摘要 → 存入 SQLite 索引库。

参数:
- sessionName: 会话名称（如 "20260701-120000-deepseek-chat"），不填则提炼当前 session`,
    parameters: {
      type: "object",
      properties: {
        sessionName: { type: "string", description: "会话名称，不填则尝试当前 session" },
      },
    },
    fn: async (args: Record<string, unknown>, _ctx?: ToolCallContext): Promise<string> => {
      let sessionName = String(args.sessionName ?? "");
      if (!sessionName) {
        // Try to find the latest session
        const dir = sessionsDir();
        if (existsSync(dir)) {
          const files = readdirSync(dir)
            .filter(
              (f) =>
                f.endsWith(".jsonl") &&
                !f.endsWith(".events.jsonl") &&
                !f.endsWith(".toolcache.jsonl"),
            )
            .sort()
            .reverse();
          if (files.length > 0) {
            sessionName = files[0]!.replace(/\.jsonl$/, "");
          }
        }
      }

      if (!sessionName) {
        return "refine_session_turns: no session found";
      }

      const { sessionId, turns } = sessionToRawTurns(sessionName);
      if (turns.length === 0) {
        return `Session "${sessionName}" has no turns to refine.`;
      }

      const manager = refinedManager();
      const refined: RefinedTurn[] = [];
      for (const turn of turns) {
        refined.push(manager.refineTurn(turn, sessionId));
      }
      await manager.saveRefinedTurns(sessionId, refined);

      return `Refined ${refined.length} turns from session "${sessionName}" (${sessionId}).`;
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
 * in a messages array. Used by `sessionToRawTurns` to ensure the refined
 * index captures full detail even after proactive archiving.
 */
function restoreArchivedContentSync(
  sessionName: string,
  messages: import("../types.js").ChatMessage[],
): void {
  // Archive path = sessionPath + .toolcache.jsonl
  const archivePath = sessionPath(sessionName) + ".toolcache.jsonl";
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

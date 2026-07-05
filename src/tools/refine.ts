/**
 * Refine tools: search_context and refine_session_turns.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { ToolRegistry, ToolCallContext } from "../tools.js";
import { RefinedManager } from "../refine/refined-manager.js";
import { existsSync, readdirSync } from "node:fs";
import { sessionsDir, loadSessionMessages, loadSessionMeta } from "../memory/session.js";
import type { RawTurn, RawAction, RefinedTurn } from "../refine/types.js";

function workspaceslug(root: string): string {
  return root.replace(/[/\\:]/g, "-").replace(/^-+/, "").toLowerCase();
}

function getRefinedRoot(): string {
  const cwd = process.cwd();
  const slug = workspaceslug(cwd);
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
        detail: { type: "string", enum: ["compact", "normal"], description: "详情级别，默认 normal" },
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

      const lines: string[] = [`Found ${matches.length} matches in ${bySession.size} sessions for "${query}":`];

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
            .filter((f) => f.endsWith(".jsonl") && !f.endsWith(".events.jsonl"))
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

  return registry;
}

/**
 * Theme tools: tag_theme, trace_theme, list_themes.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { ToolRegistry, ToolCallContext } from "../tools.js";
import { ThemeManager } from "../themes/manager.js";

function themesDir(): string {
  return join(homedir(), ".reasonix", "themes");
}

let _themeManager: ThemeManager | null = null;

function themeManager(): ThemeManager {
  if (!_themeManager) {
    _themeManager = new ThemeManager(themesDir());
  }
  return _themeManager;
}

export function registerThemeTools(registry: ToolRegistry): ToolRegistry {
  registry.register({
    name: "tag_theme",
    description: `将一个对话轮次关联到一个主题。用于跨 Session 的主题追踪。

参数:
- theme: 主题名称（如 "auth-flow"）
- sessionId: 会话 ID
- turnId: 对话轮次号`,
    parameters: {
      type: "object",
      properties: {
        theme: { type: "string", description: "主题名称" },
        sessionId: { type: "string", description: "会话 ID" },
        turnId: { type: "number", description: "对话轮次号" },
      },
      required: ["theme", "sessionId", "turnId"],
    },
    fn: async (args: Record<string, unknown>, _ctx?: ToolCallContext): Promise<string> => {
      const theme = String(args.theme ?? "");
      const sessionId = String(args.sessionId ?? "");
      const turnId = Number(args.turnId ?? 0);

      if (!theme.trim()) return "tag_theme: theme is required";
      if (!sessionId.trim()) return "tag_theme: sessionId is required";
      if (turnId <= 0) return "tag_theme: turnId must be a positive number";

      const mgr = themeManager();
      await mgr.addThemeAssociation(theme, { sessionId, turnId, timestamp: new Date().toISOString() });

      return `Tagged turn ${turnId} of session "${sessionId}" to theme "${theme}".`;
    },
  });

  registry.register({
    name: "trace_theme",
    description: `追溯一个主题的完整演化时间线。返回按时间排序的所有关联对话轮次。

参数:
- theme: 主题名称（必填）
- includeContent: 是否包含对话内容（默认 false，只返回摘要）`,
    parameters: {
      type: "object",
      properties: {
        theme: { type: "string", description: "主题名称" },
        includeContent: { type: "boolean", description: "包含对话内容，默认 false" },
      },
      required: ["theme"],
    },
    fn: async (args: Record<string, unknown>, _ctx?: ToolCallContext): Promise<string> => {
      const theme = String(args.theme ?? "");
      const includeContent = Boolean(args.includeContent ?? false);

      if (!theme.trim()) return "trace_theme: theme is required";

      const mgr = themeManager();
      const assoc = mgr.loadTheme(theme);
      if (!assoc) {
        return `Theme "${theme}" not found.`;
      }

      const turns = assoc.turns;
      if (turns.length === 0) {
        return `Theme "${assoc.displayName}" has no associated turns.`;
      }

      // Sort by timestamp
      turns.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));

      const lines: string[] = [
        `# Theme: ${assoc.displayName}`,
        `Created: ${assoc.createdAt}`,
        `Updated: ${assoc.updatedAt}`,
        `Total turns: ${turns.length}`,
        `Total memories: ${assoc.memories.length}`,
        "",
        "## Timeline",
      ];

      for (const turn of turns) {
        lines.push(`- ${turn.timestamp ?? "?"} — Session: ${turn.sessionId}, Turn: ${turn.turnId}`);
        if (includeContent) {
          const { loadSessionMessages, loadSessionMeta } = await import("../memory/session.js");
          const meta = loadSessionMeta(turn.sessionId);
          const sessionName = meta.sessionId ?? turn.sessionId;
          // We need to find the session file by sessionId in meta
          lines.push(`  (session name: ${sessionName})`);
        }
      }

      return lines.join("\n");
    },
  });

  registry.register({
    name: "list_themes",
    description: "列出所有已创建的主题。无参数。返回主题名称列表。",
    parameters: {
      type: "object",
      properties: {},
    },
    fn: async (_args: Record<string, unknown>, _ctx?: ToolCallContext): Promise<string> => {
      const mgr = themeManager();
      const themes = mgr.listThemes();
      if (themes.length === 0) {
        return "No themes found. Use tag_theme to create one.";
      }
      return `Available themes (${themes.length}):\n${themes.map((t: string) => `  - ${t}`).join("\n")}`;
    },
  });

  return registry;
}

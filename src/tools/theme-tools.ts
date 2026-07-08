/**
 * Theme tools: tag_theme, trace_theme, list_themes.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { getRefinedManager } from "../refine/refined-manager.js";
import { ThemeManager } from "../themes/manager.js";
import type { ToolCallContext, ToolRegistry } from "../tools.js";

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
    description: `Associate a turn with a theme for cross-session theme tracing.

Parameters:
- theme: theme name (e.g. "auth-flow")
- sessionId: session identifier (the same value returned as sessionName by search_context)
- turnId: turn number`,
    parameters: {
      type: "object",
      properties: {
        theme: { type: "string", description: "Theme name" },
        sessionId: { type: "string", description: "Session identifier" },
        turnId: { type: "number", description: "Turn number" },
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
      await mgr.addThemeAssociation(theme, {
        sessionId,
        turnId,
        timestamp: new Date().toISOString(),
      });

      return `Tagged turn ${turnId} of session "${sessionId}" to theme "${theme}".`;
    },
  });

  registry.register({
    name: "trace_theme",
    description: `Trace the full evolution timeline of a theme. Returns associated turns sorted chronologically.

Parameters:
- theme: theme name (required)
- includeContent: when true, include the denoised skeleton for each turn (default false)

When includeContent is false, only turn references are returned. To recall tool results for a turn, use load_turns_context with the returned references.`,
    parameters: {
      type: "object",
      properties: {
        theme: { type: "string", description: "Theme name" },
        includeContent: {
          type: "boolean",
          description: "Include denoised skeleton per turn, default false",
        },
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

      const turns = assoc.turns.slice();
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

      const refinedMgr = getRefinedManager();

      for (const turn of turns) {
        lines.push(`- ${turn.timestamp ?? "?"} — Session: ${turn.sessionId}, Turn: ${turn.turnId}`);
        if (includeContent) {
          const skeleton = refinedMgr.loadRefinedTurn(turn.sessionId, turn.turnId);
          if (skeleton) {
            lines.push(`  Summary: ${skeleton.summary}`);
            if (skeleton.facts.length > 0) {
              lines.push(`  Facts: ${skeleton.facts.join("; ")}`);
            }
            if (skeleton.entities.files.length > 0) {
              lines.push(`  Files: ${skeleton.entities.files.join(", ")}`);
            }
            if (skeleton.entities.tools.length > 0) {
              lines.push(`  Tools: ${skeleton.entities.tools.join(", ")}`);
            }
            if (skeleton.notes.length > 0) {
              lines.push(`  Notes: ${skeleton.notes.join("; ")}`);
            }
          } else {
            lines.push("  (skeleton not available — run search_context on this turn first)");
          }
        }
      }

      return lines.join("\n");
    },
  });

  registry.register({
    name: "list_themes",
    description: "List all created themes. No parameters. Returns a list of theme names.",
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

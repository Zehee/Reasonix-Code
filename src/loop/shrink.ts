import { truncateForModel, truncateForModelByTokens } from "../mcp/registry.js";
import { countTokens, countTokensBounded } from "../tokenizer.js";
import type { ChatMessage } from "../types.js";

// ---------------------------------------------------------------------------
// SnipHinter — per-tool strategy for proactive result trimming
// ---------------------------------------------------------------------------

/**
 * Per-tool snip strategy: how many head/tail lines to keep when proactively
 * trimming stale tool results before the fold threshold is reached.
 *
 * Mirrors the Go v2 SnipHinter design:
 * - read_file: front-loaded (function signatures first)
 * - bash: balanced (errors may be at head or tail)
 * - grep/glob/search: front-loaded (matches first)
 */
export interface SnipHint {
  head: number;
  tail: number;
}

const DEFAULT_SNIP_HINTS: Record<string, SnipHint> = {
  read_file: { head: 120, tail: 12 },
  search_files: { head: 120, tail: 12 },
  list_directory: { head: 80, tail: 8 },
  run_command: { head: 40, tail: 40 },
  bash: { head: 40, tail: 40 },
  run_background: { head: 40, tail: 40 },
  web_fetch: { head: 120, tail: 12 },
  grep: { head: 80, tail: 8 },
  glob: { head: 80, tail: 8 },
};

/** Default for read-only tools (grep-like output). */
const READONLY_SNIP: SnipHint = { head: 80, tail: 12 };

/** Default for side-effecting tools (bash-like output). */
const SIDE_EFFECT_SNIP: SnipHint = { head: 40, tail: 40 };

function snipHintFor(name: string): SnipHint {
  return DEFAULT_SNIP_HINTS[name] ?? READONLY_SNIP;
}

/**
 * Proactively snip a stale tool result to head+tail lines.
 * Unlike `shrinkOversizedToolResults` which truncates by char count,
 * this preserves the most informative lines per tool type.
 */
export function snipToolResultByTool(content: string, toolName: string): string {
  const hint = snipHintFor(toolName);
  const lines = content.split("\n");
  if (lines.length <= hint.head + hint.tail) return content;
  const head = lines.slice(0, hint.head).join("\n");
  const tail = lines.slice(lines.length - hint.tail).join("\n");
  return `${head}\n[… ${lines.length - hint.head - hint.tail} lines snipped — kept head ${hint.head} + tail ${hint.tail}]\n${tail}`;
}

/**
 * Snip stale tool results in a message array. Only affects messages from
 * turns BEFORE the current one (identified by the cutoff index).
 * Returns the number of messages snipped.
 */
export function snipStaleToolResultsProactive(
  messages: ChatMessage[],
  cutoffIndex: number,
): number {
  let snipped = 0;
  for (let i = 0; i < cutoffIndex && i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role !== "tool") continue;
    if (typeof msg.content !== "string") continue;
    if (msg.content.startsWith("[archived:")) continue; // already archived
    const name = msg.name ?? "tool";
    const trimmed = snipToolResultByTool(msg.content, name);
    if (trimmed !== msg.content) {
      msg.content = trimmed;
      snipped++;
    }
  }
  return snipped;
}

/** UI progress feedback only — NOT a dispatch gate. */
export function looksLikeCompleteJson(s: string): boolean {
  if (!s || !s.trim()) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/** Tool-role only — truncating user prompts would corrupt authored intent. */
export function shrinkOversizedToolResults(
  messages: ChatMessage[],
  maxChars: number,
): { messages: ChatMessage[]; healedCount: number; healedFrom: number } {
  let healedCount = 0;
  let healedFrom = 0;
  const out = messages.map((msg) => {
    if (msg.role !== "tool") return msg;
    const content = typeof msg.content === "string" ? msg.content : "";
    if (content.length <= maxChars) return msg;
    healedCount += 1;
    healedFrom += content.length;
    return { ...msg, content: truncateForModel(content, maxChars) };
  });
  return { messages: out, healedCount, healedFrom };
}

/** Token-cap variant — char cap would let CJK slip past at 2× the intended token cost. */
export function shrinkOversizedToolResultsByTokens(
  messages: ChatMessage[],
  maxTokens: number,
): {
  messages: ChatMessage[];
  healedCount: number;
  tokensSaved: number;
  charsSaved: number;
} {
  let healedCount = 0;
  let tokensSaved = 0;
  let charsSaved = 0;
  const out = messages.map((msg) => {
    if (msg.role !== "tool") return msg;
    const content = typeof msg.content === "string" ? msg.content : "";
    // length ≤ maxTokens ⇒ tokens ≤ maxTokens — skip the per-message tokenize.
    if (content.length <= maxTokens) return msg;
    const beforeTokens = countTokensBounded(content);
    if (beforeTokens <= maxTokens) return msg;
    const truncated = truncateForModelByTokens(content, maxTokens);
    const afterTokens = countTokens(truncated);
    healedCount += 1;
    tokensSaved += Math.max(0, beforeTokens - afterTokens);
    charsSaved += Math.max(0, content.length - truncated.length);
    return { ...msg, content: truncated };
  });
  return { messages: out, healedCount, tokensSaved, charsSaved };
}

/** Caller must gate on paired tool_calls — in-flight calls would crash mid-turn. */
export function shrinkOversizedToolCallArgsByTokens(
  messages: ChatMessage[],
  maxTokens: number,
): {
  messages: ChatMessage[];
  healedCount: number;
  tokensSaved: number;
  charsSaved: number;
} {
  let healedCount = 0;
  let tokensSaved = 0;
  let charsSaved = 0;
  const out = messages.map((msg) => {
    if (msg.role !== "assistant" || !Array.isArray(msg.tool_calls)) return msg;
    let changed = false;
    const newCalls = msg.tool_calls.map((call) => {
      const args = call.function?.arguments;
      if (typeof args !== "string" || args.length <= maxTokens) return call;
      const beforeTokens = countTokensBounded(args);
      if (beforeTokens <= maxTokens) return call;
      const shrunk = shrinkJsonLongStrings(args);
      const afterTokens = countTokens(shrunk);
      // Many-short-strings payloads can come back marginally larger — only swap on real saving.
      if (afterTokens >= beforeTokens) return call;
      changed = true;
      healedCount += 1;
      tokensSaved += beforeTokens - afterTokens;
      charsSaved += args.length - shrunk.length;
      return { ...call, function: { ...call.function, arguments: shrunk } };
    });
    if (!changed) return msg;
    return { ...msg, tool_calls: newCalls };
  });
  return { messages: out, healedCount, tokensSaved, charsSaved };
}

/** Keeps short keys/values (paths, ids) verbatim; only long string values get a marker. */
function shrinkJsonLongStrings(jsonStr: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const head = jsonStr.slice(0, 200);
    return `${head}…[shrunk: ${jsonStr.length} chars, unparsed]`;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return jsonStr;
  }
  const LONG_THRESHOLD = 300;
  const input = parsed as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string" && v.length > LONG_THRESHOLD) {
      const newlines = v.match(/\n/g)?.length ?? 0;
      output[k] =
        `[…shrunk: ${v.length} chars, ${newlines} lines — tool already responded, see result]`;
    } else {
      output[k] = v;
    }
  }
  return JSON.stringify(output);
}

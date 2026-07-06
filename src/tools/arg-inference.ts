/**
 * Intelligent argument inference for model-generated tool calls.
 *
 * Models often produce tool arguments in non-JSON formats (function-call style,
 * shell-like kv pairs, bare positional values) or with slightly wrong parameter
 * names. This module tries to understand what the model *intended* and converts
 * it to the proper schema-valid arguments before dispatch rejects them.
 */

import type { JSONSchema, ToolSpec } from "../types.js";

// ---------------------------------------------------------------------------
// Fuzzy parameter name matching
// ---------------------------------------------------------------------------

/**
 * Common alternative names for frequently-used parameter keys.
 * The model often uses a slightly different name than what the schema declares.
 */
const PARAM_ALIASES: Record<string, string[]> = {
  path: ["file", "filepath", "file_path", "filename", "name", "target", "dest", "destination"],
  content: ["text", "body", "data", "value", "input", "code", "source"],
  command: ["cmd", "exec", "run", "shell", "program", "binary"],
  directory: ["dir", "folder", "root", "basedir", "base_dir", "working_dir", "cwd"],
  query: ["q", "search", "pattern", "term", "keyword", "keywords", "text"],
  name: ["id", "key", "label", "title", "slug", "identifier"],
  description: ["desc", "summary", "note", "comment", "doc"],
  url: ["uri", "link", "href", "endpoint", "source", "target"],
  message: ["msg", "text", "content", "body"],
  args: ["arguments", "params", "parameters", "argv", "flags", "options"],
  signal: ["sig", "abort", "cancel"],
};

function buildParamAliasMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(PARAM_ALIASES)) {
    for (const alias of aliases) {
      // Register both directions — the schema might use the alias as the canonical name.
      if (!map.has(alias)) map.set(alias, canonical);
    }
    if (!map.has(canonical)) map.set(canonical, canonical);
  }
  return map;
}

const paramAliasMap = buildParamAliasMap();

/**
 * Try to match a plausible parameter name to the schema's known parameters.
 * Returns the canonical schema key name, or null if no match.
 */
function fuzzyMatchParam(key: string, schemaParams: Record<string, unknown>): string | null {
  // 1. Exact match.
  if (key in schemaParams) return key;

  const lowerKey = key.toLowerCase();
  const lowerParams = new Map<string, string>();
  for (const k of Object.keys(schemaParams)) {
    lowerParams.set(k.toLowerCase(), k);
  }

  // 2. Case-insensitive match.
  const ci = lowerParams.get(lowerKey);
  if (ci) return ci;

  // 3. Alias match.
  const canonical = paramAliasMap.get(lowerKey);
  if (canonical) {
    // Check if the canonical name or any of its aliases exist in the schema.
    const canonicalInSchema = lowerParams.get(canonical);
    if (canonicalInSchema) return canonicalInSchema;
    const allAliases = PARAM_ALIASES[canonical] ?? [];
    for (const alias of allAliases) {
      const aliasInSchema = lowerParams.get(alias);
      if (aliasInSchema) return aliasInSchema;
    }
  }

  // 4. Substring match — if the model's key contains or is contained by a schema param.
  for (const [lower, orig] of lowerParams) {
    if (lowerKey.includes(lower) || lower.includes(lowerKey)) return orig;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Non-JSON argument parsing
// ---------------------------------------------------------------------------

/**
 * Try to parse model-generated tool arguments that aren't valid JSON.
 * Returns parsed args or null if parsing failed.
 */
export function inferToolArgs(
  raw: string,
  spec: ToolSpec | undefined,
): Record<string, unknown> | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();

  // Strategy 1: Already valid JSON.
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return inferFromJson(parsed as Record<string, unknown>, spec);
    }
  } catch {
    // Fall through.
  }

  // Guard: if the input looks like it was intended as JSON (starts with `{`
  // or `[`) but failed to parse, don't try non-JSON inference strategies.
  if (/^\s*[\[{]/.test(trimmed)) return null;

  const schemaParams = extractSchemaParams(spec);

  // Strategy 2: Function-call style: `toolName(key1=val1, key2=val2)`
  // or `toolName(val1, val2)` (positional).
  const funcCall = tryParseFunctionCall(trimmed, schemaParams);
  if (funcCall) return funcCall;

  // Strategy 3: Shell-like kv pairs: `key1=val1 key2=val2`
  const shellKv = tryParseShellKv(trimmed, schemaParams);
  if (shellKv) return shellKv;

  // Strategy 4: Bare value for a tool with a single obvious string param.
  const singleParam = tryParseSingleParam(trimmed, schemaParams);
  if (singleParam) return singleParam;

  return null;
}

/**
 * Map the model's param names to schema param names using fuzzy matching.
 */
function inferFromJson(
  args: Record<string, unknown>,
  spec: ToolSpec | undefined,
): Record<string, unknown> {
  const schemaParams = extractSchemaParams(spec);
  if (Object.keys(schemaParams).length === 0) return args;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const matched = fuzzyMatchParam(key, schemaParams);
    if (matched) {
      result[matched] = value;
    } else {
      // Keep as-is — maybe the schema just doesn't document this param.
      result[key] = value;
    }
  }
  return result;
}

/**
 * Try to parse function-call-style arguments:
 *   - `key1=val1, key2="val2"`
 *   - `val1, val2` (positional, mapped to required params)
 */
function tryParseFunctionCall(
  trimmed: string,
  schemaParams: Record<string, unknown>,
): Record<string, unknown> | null {
  // Strip outer parens + optional function name prefix.
  let inner = trimmed;
  const parenMatch = trimmed.match(/^(?:\w+\s*)?\(([\s\S]*)\)\s*$/);
  if (parenMatch) {
    inner = parenMatch[1]!.trim();
  } else {
    return null;
  }
  if (!inner) return null;

  // Split by top-level commas (not inside quotes/braces/brackets).
  const parts = splitByTopLevelComma(inner);
  if (parts.length === 0) return null;

  const args: Record<string, unknown> = {};
  let positionalCount = 0;
  const requiredParams = extractRequiredParams(schemaParams);

  for (const part of parts) {
    const trimmedPart = part.trim();
    if (!trimmedPart) continue;

    // Check for key=value or key=val1,val2 (comma-separated values)
    const eqIndex = findTopLevelEq(trimmedPart);
    if (eqIndex >= 0) {
      const key = trimmedPart.slice(0, eqIndex).trim();
      const rawVal = trimmedPart.slice(eqIndex + 1).trim();
      const value = parseArgValue(rawVal);
      if (key) {
        const matched = fuzzyMatchParam(key, schemaParams);
        args[matched ?? key] = value;
      }
    } else {
      // Positional argument.
      const value = parseArgValue(trimmedPart);
      if (positionalCount < requiredParams.length) {
        args[requiredParams[positionalCount]!] = value;
      } else {
        // No more known positional slots — try the first param.
        const keys = Object.keys(schemaParams);
        if (keys.length > 0) args[keys[0]!] = value;
      }
      positionalCount++;
    }
  }

  return Object.keys(args).length > 0 ? args : null;
}

/**
 * Try to parse shell-like kv pairs: `key1=value1 key2="value2"`
 */
function tryParseShellKv(
  trimmed: string,
  schemaParams: Record<string, unknown>,
): Record<string, unknown> | null {
  // Must look like kv pairs, not JSON or function-call.
  if (trimmed.startsWith("{") || trimmed.startsWith("(")) return null;

  // Split by whitespace, respecting quotes.
  const tokens = splitRespectingQuotes(trimmed);
  const kvTokens = tokens.filter((t) => t.includes("="));
  if (kvTokens.length === 0) return null;

  const args: Record<string, unknown> = {};
  for (const token of kvTokens) {
    const eqIdx = token.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = token.slice(0, eqIdx).trim();
    const rawVal = token.slice(eqIdx + 1).trim();
    const value = parseArgValue(rawVal);
    if (key) {
      const matched = fuzzyMatchParam(key, schemaParams);
      args[matched ?? key] = value;
    }
  }

  return Object.keys(args).length > 0 ? args : null;
}

/**
 * For tools with a single obvious string parameter, accept a bare string value.
 */
function tryParseSingleParam(
  trimmed: string,
  schemaParams: Record<string, unknown>,
): Record<string, unknown> | null {
  const keys = Object.keys(schemaParams);
  if (keys.length === 0) return null;

  // Find the first string-type required param.
  const stringParam = keys.find((k) => {
    const prop = schemaParams[k] as Record<string, unknown> | undefined;
    return prop?.type === "string" || prop?.type === undefined;
  });
  if (!stringParam) return null;

  return { [stringParam]: trimmed };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractSchemaParams(spec: ToolSpec | undefined): Record<string, unknown> {
  if (!spec?.function?.parameters) return {};
  const params = spec.function.parameters;
  if (typeof params !== "object" || Array.isArray(params)) return {};
  return ((params as Record<string, unknown>).properties as Record<string, unknown>) ?? {};
}

function extractRequiredParams(schemaParams: Record<string, unknown>): string[] {
  // This is a simplified version — in practice the schema's `required` field
  // would be stored alongside properties.
  const keys = Object.keys(schemaParams);
  return keys; // Default: all params are treated as potentially positional.
}

/**
 * Split a string by commas that are not inside quotes, braces, brackets, or parens.
 */
function splitByTopLevelComma(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let quoteChar = "";
  let start = 0;

  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQuote) {
      if (c === quoteChar && s[i - 1] !== "\\") inQuote = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = true;
      quoteChar = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      continue;
    }
    if (c === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/**
 * Split a string by whitespace respecting quotes.
 */
function splitRespectingQuotes(s: string): string[] {
  const parts: string[] = [];
  let inQuote = false;
  let quoteChar = "";
  let start = 0;

  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQuote) {
      if (c === quoteChar && s[i - 1] !== "\\") inQuote = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = true;
      quoteChar = c;
      continue;
    }
    if (c === " " || c === "\t") {
      if (i > start) parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (s.length > start) parts.push(s.slice(start));
  return parts;
}

/**
 * Find the first `=` at the top level (not inside quotes/braces).
 */
function findTopLevelEq(s: string): number {
  let depth = 0;
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQuote) {
      if (c === quoteChar && s[i - 1] !== "\\") inQuote = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = true;
      quoteChar = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      continue;
    }
    if (c === "=" && depth === 0 && !inQuote) return i;
  }
  return -1;
}

/**
 * Parse a raw argument value string into a JS value.
 */
function parseArgValue(raw: string): unknown {
  const trimmed = raw.trim();

  // Try as JSON first (handles strings, numbers, booleans, null, arrays, objects).
  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith('"') ||
    trimmed.startsWith("'")
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {}
    // Try single-quoted string.
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      return trimmed.slice(1, -1);
    }
  }

  // Number.
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  // Boolean / null.
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;

  // Plain string — strip surrounding quotes if any.
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

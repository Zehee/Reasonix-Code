/**
 * Canonicalize JSON Schema objects to produce deterministic byte sequences.
 *
 * DeepSeek prefix caching depends on every byte of the tool schema being
 * identical between requests. MCP servers may register schemas whose keys
 * differ only by ordering (e.g. `{"properties": {"z": {}, "a": {}}}` vs
 * `{"properties": {"a": {}, "z": {}}}`). This module normalizes schemas
 * so logically-equivalent definitions produce the same serialized form.
 *
 * Built-in tool descriptions also contribute to prefix size. The `shrink()`
 * helper trims prose without changing what the model sees semantically.
 */

// ── Canonicalization ──────────────────────────────────────────────

type JsonSchema = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

/**
 * Recursively normalize a JSON Schema object:
 * 1. Sort all object keys alphabetically.
 * 2. Sort `required` arrays.
 * 3. Recursively process `properties`, `items`, `anyOf`, `oneOf`, `allOf`,
 *    `$defs`, `definitions`, `additionalProperties`, `patternProperties`.
 * 4. Remove keys whose value is `undefined` or empty-string `description`.
 * 5. Remove `$schema` — it's noise for LLM tool use.
 */
export function canonicalizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    if (schema.length === 0) return schema;
    // Sort `required` array, leave other arrays in place.
    // Only sort if every element is a string — i.e. it's a `required` array.
    if (schema.every((e) => typeof e === "string")) {
      return [...schema].sort();
    }
    return schema.map(canonicalizeSchema);
  }

  if (schema === null || typeof schema !== "object") return schema;

  const obj = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // Collect keys, sort alphabetically.
  const keys = Object.keys(obj).sort();

  for (const key of keys) {
    const val = obj[key];

    // Skip noise keys.
    if (key === "$schema") continue;
    if (key === "default" && val === undefined) continue;
    if (key === "description" && val === "") continue;

    // Recursively canonicalize nested objects and sortable arrays.
    if (
      key === "properties" ||
      key === "items" ||
      key === "additionalProperties" ||
      key === "patternProperties" ||
      key === "required" ||
      key === "anyOf" ||
      key === "oneOf" ||
      key === "allOf" ||
      key === "not" ||
      key === "$defs" ||
      key === "definitions" ||
      key === "prefixItems"
    ) {
      out[key] = canonicalizeSchema(val);
      continue;
    }

    out[key] = val;
  }

  return out;
}

// ── Description shrinking ─────────────────────────────────────────

/**
 * Shrink a tool description to its essential meaning.
 *
 * Removes procedural guidance ("call this after X", "use for Y when Z")
 * that the model already knows from the system prompt. Keeps only the
 * what, not the how/when/why.
 *
 * Example:
 *   "Mark one approved-plan step as done. Call exactly once after finishing
 *    each step, before starting the next. After the FINAL step, write a brief
 *    reply summarizing what was done and end the turn. Skip if the plan didn't
 *    include structured steps."
 * → "Mark one approved-plan step as done."
 */
export function shrinkDescription(desc: string): string {
  // Keep only the first sentence if it's self-contained.
  const trimmed = desc.trim();
  const dot = trimmed.indexOf(".");
  if (dot > 0 && dot < 120) {
    const first = trimmed.slice(0, dot + 1);
    // If the first sentence is already meaningful on its own, keep it.
    if (first.length > 10 && first.length < 120) return first;
  }
  // If the description is already short, keep it.
  if (trimmed.length <= 120) return trimmed;
  // Hard truncate at 120 chars, ending at a sentence boundary.
  const truncated = trimmed.slice(0, 120);
  const lastDot = truncated.lastIndexOf(".");
  if (lastDot > 10) return truncated.slice(0, lastDot + 1);
  return truncated;
}

/**
 * Apply canonicalization + shrinking to a tool definition object.
 */
export function normalizeToolDescriptor(descriptor: {
  name: string;
  description: string;
  parameters?: unknown;
}): { name: string; description: string; parameters: unknown } {
  return {
    name: descriptor.name,
    description: shrinkDescription(descriptor.description),
    parameters: descriptor.parameters ? canonicalizeSchema(descriptor.parameters) : undefined,
  };
}

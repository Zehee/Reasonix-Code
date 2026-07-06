/**
 * Disk-persisted cache for MCP handshake results (initialize + listTools).
 *
 * Every session start pays a full MCP initialize + listTools round-trip on every
 * server — hundreds of ms to seconds. Worse, a different tool discovery order or
 * serialization shape invalidates DeepSeek's prefix cache, costing a cache-miss
 * turn on the first API call.
 *
 * This module persists the handshake snapshot under `~/.reasonix/mcp-handshake/`,
 * keyed by a deterministic fingerprint of the load-bearing Spec fields (type,
 * command/url, args, env, headers). The next launch reuses the cached tool list
 * verbatim (stable order → cache hit), then verifies against the live server in
 * the background. Any deviation re-bridges and updates the cache.
 *
 * Cache is best-effort: corrupt JSON, version mismatch, or missing files silently
 * degrade to a fresh handshake.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServerSpec } from "./spec.js";
import type { McpTool } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Bump whenever CachedHandshake shape changes incompatibly. */
const CACHE_VERSION = 1;

/** Subdirectory under ~/.reasonix/. */
const CACHE_SUBDIR = "mcp-handshake";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CachedTool {
  name: string;
  description: string;
  /** Canonicalized input schema (keys sorted). */
  inputSchema: Record<string, unknown>;
}

export interface CachedHandshake {
  version: number;
  /** Fingerprint of the spec that produced this cache entry. */
  specHash: string;
  /** Server capabilities bitmap — subset that affects tool behaviour. */
  capabilities: Record<string, boolean>;
  /** Cached tool definitions in canonical order. */
  tools: CachedTool[];
  /** ISO-8601 timestamp of when this cache was last validated. */
  lastValidated: string;
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * Deterministic SHA-256 fingerprint of the load-bearing spec fields.
 *
 * Mirrors the Go v2 `SpecFingerprint` logic:
 *   - Type, command/url, dir, args, env (sorted keys), headers (sorted keys)
 *   - NUL byte (\x00) as field separator and SOH (\x01) as record separator
 *     prevents concatenation collisions (e.g. `command` + `foo` vs
 *     `comm` + `andfoo`).
 *
 * Importantly, `name` is excluded — a renamed server uses the same fingerprint,
 * so renaming a server without changing its command/url reuses the cache.
 */
export function specFingerprint(spec: McpServerSpec): string {
  const h = createHash("sha256");

  writeField(h, "type", spec.transport);

  if (spec.transport === "stdio") {
    writeField(h, "command", spec.command);
    for (const a of spec.args) writeField(h, "arg", a);
    writeField(h, "dir", spec.cwd ?? "");
    writeSortedKv(h, "env", spec.env);
  } else {
    writeField(h, "url", spec.url);
    writeSortedKv(h, "headers", spec.headers);
  }

  return h.digest("hex");
}

/** Feed a tagged field into the hash with NUL + SOH separators to prevent
 *  concatenation collisions between adjacent fields. */
function writeField(h: ReturnType<typeof createHash>, key: string, val: string): void {
  h.update(key);
  h.update("\x00");
  h.update(val);
  h.update("\x01");
}

/** Feed a string map deterministically by sorting keys — so Go's randomised
 *  map iteration (on the Go reference side) or JS object key insertion order
 *  doesn't churn the fingerprint. */
function writeSortedKv(
  h: ReturnType<typeof createHash>,
  prefix: string,
  map?: Record<string, string>,
): void {
  if (!map || Object.keys(map).length === 0) {
    writeField(h, prefix, "");
    return;
  }
  const keys = Object.keys(map).sort();
  for (const k of keys) {
    writeField(h, `${prefix}.${k}`, map[k]!);
  }
}

// ---------------------------------------------------------------------------
// Cache path helpers
// ---------------------------------------------------------------------------

/** `~/.reasonix/mcp-handshake/<slug>.json` */
function cacheDir(): string {
  return join(homedir(), ".reasonix", CACHE_SUBDIR);
}

function cacheFilePath(name: string): string {
  return join(cacheDir(), `${slug(name)}.json`);
}

/**
 * Sanitise a name for use as a filename: lowercase, only `[a-z0-9_-]`.
 * Falls back to `_` when every character is stripped.
 */
function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "_";
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

/**
 * Load a cached handshake for `name` iff its specHash matches `expectedHash`.
 * Returns `null` on any error (missing file, corrupt JSON, version mismatch,
 * hash mismatch) — cache is best-effort.
 */
export async function loadCachedHandshake(
  name: string,
  expectedHash: string,
): Promise<CachedHandshake | null> {
  try {
    const p = cacheFilePath(name);
    const raw = await readFile(p, "utf-8");
    const parsed = JSON.parse(raw) as CachedHandshake;

    if (parsed.version !== CACHE_VERSION) return null;
    if (parsed.specHash !== expectedHash) return null;

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Atomically persist a handshake snapshot to disk. Writes to a temp file then
 * renames over the target so a crash mid-write never leaves a half-written JSON.
 */
export async function saveCachedHandshake(name: string, data: CachedHandshake): Promise<void> {
  try {
    const dir = cacheDir();
    await mkdir(dir, { recursive: true });

    const p = cacheFilePath(name);
    const tmp = join(dir, `.${slug(name)}-${randomUUID()}.tmp`);

    data.version = CACHE_VERSION;
    if (!data.lastValidated) {
      data.lastValidated = new Date().toISOString();
    }

    const json = JSON.stringify(data, null, 2);
    await writeFile(tmp, json, "utf-8");
    // Atomic rename — `fs/promises rename` is atomic on the same filesystem
    // on both POSIX and Windows. A crash after rename but before the old file
    // is fully replaced leaves the target at the new content.
    await rename(tmp, p);
  } catch {
    // Best-effort — callers handle cache absence gracefully.
  }
}

/**
 * Remove a cached handshake file. Best-effort.
 */
export async function clearCachedHandshake(name: string): Promise<void> {
  try {
    await unlink(cacheFilePath(name));
  } catch {
    // File may not exist.
  }
}

/**
 * Build a CachedHandshake from live handshake results, storing schemas in
 * canonical form (keys sorted, array-type sets sorted) so the next launch
 * sees a byte-identical tool list.
 */
export function buildCachedHandshake(
  specHash: string,
  capabilities: Record<string, boolean>,
  tools: McpTool[],
): CachedHandshake {
  return {
    version: CACHE_VERSION,
    specHash,
    capabilities,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: canonicalizeSchema(t.inputSchema as Record<string, unknown>) as Record<
        string,
        unknown
      >,
    })),
    lastValidated: new Date().toISOString(),
  };
}

/**
 * Resolve cached tools back to McpTool format for registration.
 */
export function cachedToolsToMcpTools(cached: CachedTool[]): McpTool[] {
  return cached.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as McpTool["inputSchema"],
  }));
}

/**
 * Canonicalize a JSON Schema by sorting all keys recursively — ensures
 * byte-identical serialization regardless of the order the server returned.
 *
 * Mirrors `canonicalizeSchemaForCache` in registry.ts so cached and live
 * tool schemas produce identical hashes.
 */
const SET_LIKE_SCHEMA_ARRAY_KEYS = new Set(["required", "dependentRequired"]);

function canonicalizeSchema(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map((item) => canonicalizeSchema(item));
    if (parentKey && SET_LIKE_SCHEMA_ARRAY_KEYS.has(parentKey) && mapped.every(isScalar)) {
      return [...mapped].sort((a, b) => String(a).localeCompare(String(b)));
    }
    return mapped;
  }
  if (!value || typeof value !== "object") return value;
  if (parentKey === "dependentRequired") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const arr = (value as Record<string, unknown>)[key];
      out[key] =
        Array.isArray(arr) && arr.every(isScalar)
          ? [...(arr as unknown[])].sort((a, b) => String(a).localeCompare(String(b)))
          : canonicalizeSchema(arr, key);
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalizeSchema((value as Record<string, unknown>)[key], key);
  }
  return out;
}

function isScalar(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

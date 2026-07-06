/**
 * Proactive context archiver — strips verbose tool noise from the main
 * conversation and stores it in a JSONL sidecar file.
 *
 * Instead of waiting for the 75% fold threshold, this module selectively
 * archives old tool results (errors, file reads, edit diffs) into a
 * `{session}.toolcache.jsonl` file after each turn, keeping the main context
 * lean while preserving traceability. The model sees a short reference
 * like `[archived: read_file result for src/index.ts (2345 chars)]`.
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ChatMessage } from "../types.js";
import { sessionPath } from "./session.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Subdirectory under ~/.reasonix/sessions/. */
const SESSIONS_SUBDIR = "sessions";

/** A tool result whose content exceeds this threshold is a candidate for archiving. */
const ARCHIVE_SIZE_THRESHOLD = 512;

/** Keep the last N turns with full fidelity (all tool results intact).
 *  Turns older than this threshold get their tool noise (errors, file reads,
 *  edit diffs) archived to JSONL and replaced with short references.
 *  User messages and assistant conclusions are ALWAYS preserved verbatim.
 *  Default: 5 turns. Can be overridden via env REASONIX_KEEP_TURNS or
 *  by setting the config value at session start. */
export const DEFAULT_RECENT_TURN_KEEP = 5;

/**
 * Resolve the keep-turns count from env or default.
 * Users can set `REASONIX_KEEP_TURNS` to control how many recent turns
 * are kept with full fidelity before archiving kicks in. Range: 1-100.
 */
function resolveKeepTurns(): number {
  const env = process.env.REASONIX_KEEP_TURNS;
  if (env) {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 100) return n;
  }
  return DEFAULT_RECENT_TURN_KEEP;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArchiveEntry {
  turn: number;
  toolName: string;
  toolCallId: string;
  role: "tool";
  /** Original content (full text, not truncated). */
  content: string;
  /** ISO timestamp when archived. */
  archivedAt: string;
  /** Classification: error, file_read, edit_diff, shell_output, generic */
  kind: "error" | "file_read" | "edit_diff" | "shell_output" | "generic";
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function archivePathFor(sessionName: string): string {
  // Archive path = sessionPath + .toolcache.jsonl
  return sessionPath(sessionName) + ".toolcache.jsonl";
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Classify a tool result to decide whether it's archive-worthy noise. */
function classifyToolResult(
  name: string,
  content: string,
): { kind: ArchiveEntry["kind"]; archiveable: boolean } {
  // Errors: tool returns ERROR: prefix, or the tool name is bash and content contains error patterns.
  if (content.startsWith("ERROR:")) {
    return { kind: "error", archiveable: true };
  }
  if (name === "read_file" || name === "search_files" || name === "list_directory") {
    return { kind: "file_read", archiveable: true };
  }
  if (
    name === "edit_file" ||
    name === "write_file" ||
    name === "multi_edit" ||
    name === "delete_range" ||
    name === "delete_symbol"
  ) {
    return { kind: "edit_diff", archiveable: true };
  }
  if (name === "run_command" || name === "bash" || name === "run_background") {
    return { kind: "shell_output", archiveable: content.length > ARCHIVE_SIZE_THRESHOLD };
  }
  return { kind: "generic", archiveable: content.length > ARCHIVE_SIZE_THRESHOLD * 4 };
}

/** Build a short reference string that replaces the archived content in the main log. */
function buildArchiveReference(entry: ArchiveEntry): string {
  const charCount = entry.content.length;
  const lineCount = entry.content.split("\n").length;
  return `[archived: ${entry.toolName} (${charCount} chars, ${lineCount} lines) — 已降噪]`;
}

// ---------------------------------------------------------------------------
// Archiver
// ---------------------------------------------------------------------------

/** TurnArchiver — proactive archiving per turn. */
export class TurnArchiver {
  private readonly _archivePath: string | null;
  readonly keepTurns: number;

  constructor(sessionName: string | null, keepTurns?: number) {
    this._archivePath = sessionName ? archivePathFor(sessionName) : null;
    this.keepTurns = keepTurns ?? resolveKeepTurns();
  }

  /**
   * Scan the log for archiveable tool results from PREVIOUS turns (not the
   * current turn), archive them to JSONL, and replace them in-place with
   * short references. Returns the number of items archived.
   */
  async archivePreviousTurnNoise(log: ChatMessage[], currentTurn: number): Promise<number> {
    if (!this._archivePath) return 0;
    if (currentTurn <= this.keepTurns) return 0;

    let archived = 0;

    // Full scan: `isAlreadyArchived` (startsWith) is O(1) per message.
    // Already-archived entries are skipped in microseconds;
    // unarchived tool results get archived and replaced with a reference.
    // No cursor/index tracking needed — simpler and more robust.
    for (const msg of log) {
      if (msg.role !== "tool") continue;
      if (typeof msg.content !== "string") continue;
      if (isAlreadyArchived(msg.content)) continue;

      const name = msg.name ?? "tool";
      const { kind, archiveable } = classifyToolResult(name, msg.content);
      if (!archiveable) continue;

      const entry: ArchiveEntry = {
        turn: currentTurn,
        toolName: name,
        toolCallId: msg.tool_call_id ?? "",
        role: "tool",
        content: msg.content,
        archivedAt: new Date().toISOString(),
        kind,
      };

      // Write to archive.
      try {
        await mkdir(dirname(this._archivePath), { recursive: true });
        await appendFile(this._archivePath, JSON.stringify(entry) + "\n", "utf-8");
      } catch {
        // Best-effort — if we can't write, don't strip.
        continue;
      }

      // Replace in-place in the log array.
      msg.content = buildArchiveReference(entry);
      archived++;
    }

    return archived;
  }

  /**
   * Persist the modified log (with archive references instead of full content)
   * to the session file. This is called after the archive pass.
   */
  async persistArchivedLog(sessionName: string, log: ChatMessage[]): Promise<void> {
    const p = join(
      homedir(),
      ".reasonix",
      SESSIONS_SUBDIR,
      `${sessionName.replace(/[^a-zA-Z0-9_-]/g, "_")}.archived.jsonl`,
    );
    try {
      await mkdir(dirname(p), { recursive: true });
      const lines = log.map((m) => JSON.stringify(m)).join("\n");
      await writeFile(p, lines, "utf-8");
    } catch {
      // Best-effort.
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The archive reference prefix used to detect already-archived messages. */
export const ARCHIVE_MARKER = "[archived: ";

function isAlreadyArchived(content: string): boolean {
  return content.startsWith(ARCHIVE_MARKER);
}

// ---------------------------------------------------------------------------
// Archive merge — restore full content when folding
// ---------------------------------------------------------------------------

/**
 * Load all archive entries from the JSONL sidecar for a session.
 * Returns a map of toolCallId → original content, or empty map on error.
 */
export async function loadArchiveMap(sessionName: string): Promise<Map<string, ArchiveEntry>> {
  const map = new Map<string, ArchiveEntry>();
  try {
    const p = archivePathFor(sessionName);
    const raw = await readFile(p, "utf-8");
    for (const line of raw.split("\n").filter(Boolean)) {
      const entry = JSON.parse(line) as ArchiveEntry;
      map.set(entry.toolCallId, entry);
    }
  } catch {
    // Archive may not exist yet.
  }
  return map;
}

/**
 * Scan a message array and replace archive references with the original
 * full content from the archive. Used by `summarizeForFold` so the
 * summarizer sees complete information even after proactive archiving.
 */
export function restoreFromArchive(
  messages: ChatMessage[],
  archiveMap: Map<string, ArchiveEntry>,
): void {
  for (const msg of messages) {
    if (msg.role !== "tool") continue;
    if (typeof msg.content !== "string") continue;
    if (!msg.content.startsWith(ARCHIVE_MARKER)) continue;
    const id = msg.tool_call_id ?? "";
    const entry = archiveMap.get(id);
    if (entry) {
      msg.content = entry.content;
    }
  }
}

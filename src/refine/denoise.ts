/** Shared denoise / refine method: compress a RawTurn into a framework turn. */

import { ACTION_KEYWORDS, LIMITS } from "./constants.js";
import type { RawAction, RawTurn } from "./types.js";
import { extractEntitiesFromAction } from "./utils/action-entities.js";

export type DenoiseSource = "fold" | "search";

/** A denoised turn suitable for the evolution framework and theme tracing. */
export interface DenoisedTurn {
  /** Global turn counter within the session. */
  turnId: number;
  /** Stable session UUID. */
  sessionId: string;
  /** ISO timestamp if available. */
  timestamp?: string;
  /** Source that produced this denoised turn. */
  source: DenoiseSource;
  /** Compressed user intent (first sentence or first N chars). */
  userIntent: string;
  /** Tools invoked during this turn, with arguments but without results. */
  toolsCalled: { name: string; args?: unknown }[];
  /** Assistant conclusion / lead sentence. */
  assistantConclusion: string;
  /** Files referenced by tool calls or results. */
  files: string[];
  /** Errors observed in tool results. */
  errors: string[];
  /** Back-reference to the original turnId for precise restore. */
  rawTurnId: number;
}

export interface DenoiseOptions {
  /** Session UUID. */
  sessionId: string;
  /** How this denoised turn was produced. */
  source: DenoiseSource;
}

const ACTION_REGEX = new RegExp(
  `^(?:${[...ACTION_KEYWORDS]
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})(：|:)?\\s*`,
  "i",
);

function pickConclusion(agentText: string): string {
  const lines = agentText.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.length > 0 && line.length <= LIMITS.agentLead) {
      return line;
    }
  }
  return agentText.slice(0, LIMITS.agentLead).trim();
}

function compressUserIntent(userText: string): string {
  const trimmed = (userText || "").trim();
  if (!trimmed) return "";
  // First sentence heuristic: split on sentence terminators, but keep URLs/paths intact.
  const firstSentence = trimmed.split(/(?<=[.。!！?？])\s+/)[0] ?? trimmed;
  if (firstSentence.length <= LIMITS.userText) return firstSentence;
  return `${trimmed.slice(0, LIMITS.userText)}…`;
}

function extractToolsCalled(actions: RawAction[] | undefined): { name: string; args?: unknown }[] {
  const called: { name: string; args?: unknown }[] = [];
  if (!actions) return called;
  for (const action of actions) {
    if (!action.name) continue;
    // Tool results (with result but no args) are recorded for framework reference
    // but do not carry the verbose result payload.
    if (action.result !== undefined && action.args === undefined) {
      called.push({ name: action.name });
      continue;
    }
    // Tool invocations carry arguments.
    if (action.args !== undefined) {
      called.push({ name: action.name, args: action.args });
    }
  }
  return called;
}

/** Denoise a single RawTurn into a framework turn. */
export function denoiseTurn(turn: RawTurn, opts: DenoiseOptions): DenoisedTurn {
  const { sessionId, source } = opts;
  const turnId = Number.parseInt(String(turn.turnId), 10) || 0;

  const userIntent = compressUserIntent(turn.user || "");
  const agentText = turn.agentText || turn.agent || "";
  const assistantConclusion = pickConclusion(agentText);

  const toolsCalled = extractToolsCalled(turn.actions);

  const files = new Set<string>();
  const tools = new Set<string>();
  const errors = new Set<string>();

  for (const action of turn.actions || []) {
    const { files: actionFiles, tools: actionTools, errors: actionErrors } = extractEntitiesFromAction(action);
    for (const f of actionFiles) files.add(f);
    for (const t of actionTools) tools.add(t);
    for (const e of actionErrors) errors.add(e);
  }

  return {
    turnId,
    sessionId,
    timestamp: turn.timestamp,
    source,
    userIntent,
    toolsCalled,
    assistantConclusion,
    files: Array.from(files).slice(0, LIMITS.files),
    errors: Array.from(errors).slice(0, LIMITS.errors),
    rawTurnId: turnId,
  };
}

/** Convert a DenoisedTurn back into the legacy RefinedTurn shape. */
export function denoisedToRefined(turn: DenoisedTurn): {
  sessionId: string;
  turnId: number;
  timestamp: string | undefined;
  summary: string;
  facts: string[];
  notes: string[];
  entities: { files: string[]; tools: string[]; errors: string[] };
  categories: Record<string, string[]>;
} {
  const toolNames = turn.toolsCalled.map((t) => t.name);
  const summary = turn.userIntent
    ? `${turn.userIntent}${toolNames.length > 0 ? ` · ${toolNames.join(", ")}` : ""}`
    : turn.assistantConclusion || toolNames.join(", ");

  return {
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    timestamp: turn.timestamp,
    summary,
    facts: turn.assistantConclusion ? [turn.assistantConclusion] : [],
    notes: turn.userIntent ? [turn.userIntent] : [],
    entities: {
      files: turn.files,
      tools: toolNames,
      errors: turn.errors,
    },
    categories: {
      decisions: turn.assistantConclusion ? [turn.assistantConclusion] : [],
    },
  };
}

import { COMPACTION_SUMMARY_MARKER } from "@reasonix/core-utils";
import { isCompactionSummary } from "@reasonix/core-utils";
import type { DeepSeekClient } from "./client.js";
import { Usage } from "./client.js";
import { healLoadedMessages } from "./loop.js";
import { stripHallucinatedToolMarkup } from "./loop.js";
import { buildAssistantMessage } from "./loop/messages.js";
import { DEFAULT_MAX_RESULT_CHARS } from "./mcp/registry.js";
import { loadArchiveMap, restoreFromArchive } from "./memory/archiver.js";
import { type FoldView, buildFoldSummaryText, saveFoldView } from "./memory/fold-view.js";
import type { AppendOnlyLog } from "./memory/runtime.js";
import { loadSessionId, rewriteSession } from "./memory/session.js";
import { type DecisionCluster, clusterDenoisedTurns } from "./refine/cluster.js";
import { type DenoisedTurn, denoiseTurn } from "./refine/denoise.js";
import { messagesToRawTurns } from "./refine/raw-turns.js";
import { getRefinedManager } from "./refine/refined-manager.js";
import {
  type SessionStats,
  inputCostUsd,
  pricingFor,
  resolveContextTokens,
} from "./telemetry/stats.js";
import { countTokensBounded, estimateRequestTokens } from "./tokenizer.js";
import type { ChatMessage, ToolSpec } from "./types.js";

function extractPinnedConstraints(systemPrompt: string): string {
  // matchAll because the system prompt can carry multiple blocks under the same
  // prefix — e.g. global User memory + per-project User memory, or several
  // Project memory files. Single .match() would only grab the first.
  const pattern =
    /# (?:HIGH PRIORITY constraints|User memory|Project memory)[\s\S]*?(?=\n# |\n---|$)/g;
  return Array.from(systemPrompt.matchAll(pattern), (m) => m[0]).join("\n\n");
}

/** Between soft and compact thresholds, warn once but keep the cache-stable prefix intact. */
export const HISTORY_FOLD_SOFT_THRESHOLD = 0.5;
/** Auto-fold when a turn's response shows promptTokens above this fraction of ctxMax. */
export const HISTORY_FOLD_THRESHOLD = 0.75;
/** Tail budget after a normal fold, as a fraction of ctxMax. */
export const HISTORY_FOLD_TAIL_FRACTION = 0.2;
/** Above this fraction the normal fold's tail budget didn't buy enough headroom — fold harder. */
export const HISTORY_FOLD_AGGRESSIVE_THRESHOLD = 0.78;
/** Tail budget after an aggressive fold — half the normal one, sacrifices recent context for headroom. */
export const HISTORY_FOLD_AGGRESSIVE_TAIL_FRACTION = 0.1;
/** Skip the fold if the head wouldn't shrink the log by at least this fraction. */
export const HISTORY_FOLD_MIN_SAVINGS_FRACTION = 0.3;
/** Fold will be forced at this ratio even when economics don't justify it. */
export const HISTORY_FOLD_FORCE_THRESHOLD = 0.9;
/** When N consecutive folds occur, pause auto-fold to prevent a stuck loop. */
export const HISTORY_FOLD_MAX_CONSECUTIVE = 2;
/** Above this fraction we exit the turn with a summary instead of folding (defense in depth). */
export const FORCE_SUMMARY_THRESHOLD = 0.8;
/** Turn-start local estimate above this fraction triggers a pre-iter fold. Covers cases the
 * post-response fold can't (terminal prior turn, fresh session restore, huge user paste). */
export const TURN_START_FOLD_THRESHOLD = 0.9;
/** Hard deadline for semantic fold summaries so a hung request cannot stall the turn loop. */
export const HISTORY_FOLD_SUMMARY_TIMEOUT_MS = 15_000;
/** Normal-band folds should pay for themselves over a short horizon; aggressive folds still prioritize headroom. */
export const HISTORY_FOLD_ECONOMIC_HORIZON_TURNS = 3;
export const HISTORY_FOLD_MIN_ECONOMIC_SAVINGS_FRACTION = 0.15;
export const HISTORY_FOLD_MIN_ECONOMIC_SAVINGS_USD = 0.002;
/** Summary + next-turn cold segment reserve used by fold economics. */
export const HISTORY_FOLD_SUMMARY_RESERVE_TOKENS = 4096;
/** Prepended to fold summary content so the model knows it's a synthesized recap.
 *  Re-export of the shared constant so existing imports keep resolving. */
export const HISTORY_FOLD_MARKER = COMPACTION_SUMMARY_MARKER;
/** Number of recent turns kept at full fidelity after a fold (hot zone). */
export const HOT_ZONE_TURNS = 5;
/** Number of denoised framework turns injected after the fold summary. */
export const FRAMEWORK_TURNS = 30;
/** Header that precedes preserved skill bodies in a fold's synthesized assistant message. */
export const SKILL_PIN_MEMO_HEADER = "[Active skill memos — preserved verbatim across the fold:]";
/** Matches the wrapper emitted by `run_skill` so the fold can lift bodies out before summarizing. */
const SKILL_PIN_REGEX = /<skill-pin name="([^"]+)">\n[\s\S]*?\n<\/skill-pin>/g;

export interface ContextManagerDeps {
  client: DeepSeekClient;
  log: AppendOnlyLog;
  stats: SessionStats;
  sessionName: string | null;
  getAbortSignal: () => AbortSignal;
  getCurrentTurn: () => number;
  getSystemPrompt: () => string;
  /** Reuses the live prefix → fold summary call shares the cached bytes the main agent already paid for. */
  getToolSpecs?: () => readonly ToolSpec[];
  getFewShots?: () => readonly ChatMessage[];
  /** Fired when the message log was rewritten by fold; lets the loop drop session-scoped caches whose validity rested on the elided history (e.g. read-before-edit tracker). */
  onLogRewrite?: () => void;
}

export type PostUsageDecisionKind = "none" | "fold" | "exit-with-summary" | "soft-warn";

export interface PostUsageDecision {
  kind: PostUsageDecisionKind;
  promptTokens: number;
  ctxMax: number;
  ratio: number;
  /** Token budget for the recent tail when kind === "fold"; smaller in the aggressive band. */
  tailBudget?: number;
  /** True when this fold is in the 70-85% band — used in user-facing messaging. */
  aggressive?: boolean;
  /** True when the force-threshold (0.9) triggered — skip economics gate. */
  force?: boolean;
  economics?: FoldEconomics;
}

export interface FoldResult {
  folded: boolean;
  beforeMessages: number;
  afterMessages: number;
  summaryChars: number;
}

export interface FoldEconomics {
  horizonTurns: number;
  carryInputUsd: number;
  foldInputUsd: number;
  savingsUsd: number;
  savingsFraction: number;
  worthwhile: boolean;
}

export function estimateFoldEconomics(
  usage: Usage,
  model: string,
  tailBudgetTokens: number,
): FoldEconomics {
  const pricing = pricingFor(model);
  if (!pricing) {
    return {
      horizonTurns: HISTORY_FOLD_ECONOMIC_HORIZON_TURNS,
      carryInputUsd: 0,
      foldInputUsd: 0,
      savingsUsd: 0,
      savingsFraction: 0,
      worthwhile: true,
    };
  }

  const horizonTurns = HISTORY_FOLD_ECONOMIC_HORIZON_TURNS;
  const carryInputUsd = inputCostUsd(model, usage) * horizonTurns;
  const summaryCallUsd = inputCostUsd(model, usage);
  const postFoldPromptTokens = Math.min(
    usage.promptTokens,
    tailBudgetTokens + HISTORY_FOLD_SUMMARY_RESERVE_TOKENS,
  );
  const postFoldColdUsd = (postFoldPromptTokens * pricing.inputCacheMiss) / 1_000_000;
  const postFoldWarmUsd =
    ((horizonTurns - 1) * postFoldPromptTokens * pricing.inputCacheHit) / 1_000_000;
  const foldInputUsd = summaryCallUsd + postFoldColdUsd + postFoldWarmUsd;
  const savingsUsd = carryInputUsd - foldInputUsd;
  const savingsFraction = carryInputUsd > 0 ? savingsUsd / carryInputUsd : 0;
  return {
    horizonTurns,
    carryInputUsd,
    foldInputUsd,
    savingsUsd,
    savingsFraction,
    worthwhile:
      savingsUsd >= HISTORY_FOLD_MIN_ECONOMIC_SAVINGS_USD &&
      savingsFraction >= HISTORY_FOLD_MIN_ECONOMIC_SAVINGS_FRACTION,
  };
}

function buildFoldSummaryInstruction(pinnedSkillNames: string[]): string {
  const base =
    "Summarize the conversation above as one self-contained prose recap. Preserve the user's " +
    "ORIGINAL OBJECTIVE (never paraphrase away negative constraints like 'do NOT do X'), all " +
    "'do not' / 'never' / 'avoid' instructions, decisions reached, files inspected or modified, " +
    "tool results still relevant, and any open todos. Skip turn-by-turn play-by-play. " +
    "Output plain prose only — no tool calls, no markdown headings, no SEARCH/REPLACE blocks.";
  if (pinnedSkillNames.length === 0) return base;
  const list = pinnedSkillNames.map((n) => `"${n}"`).join(", ");
  return `${base} The following skill memos are pinned verbatim and appended after your summary — do NOT quote or paraphrase their bodies: ${list}.`;
}

/**
 * Snip large tool-output messages from the middle, keeping head + tail lines.
 *
 * Unlike pruning (which replaces content with a placeholder), snipping keeps
 * the real content but removes the middle — the tool name and call ID stay
 * intact, so the prefix shape doesn't change. Only when snip alone can't
 * bring the size down enough does the caller fall through to pruning.
 *
 * Returns the number of characters saved.
 */
export const SNIP_KEEP_HEAD_LINES = 40;
export const SNIP_KEEP_TAIL_LINES = 12;

export function snipStaleToolResults(messages: ChatMessage[], maxBytes = 4096): number {
  let saved = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== "tool") continue;
    if (typeof m.content !== "string") continue;
    if (m.content.length < maxBytes) continue;
    if (m.content.startsWith(PRUNE_PLACEHOLDER_PREFIX)) continue;
    const lines = m.content.split("\n");
    if (lines.length <= SNIP_KEEP_HEAD_LINES + SNIP_KEEP_TAIL_LINES) continue;
    const kept = [
      ...lines.slice(0, SNIP_KEEP_HEAD_LINES),
      `[… ${lines.length - SNIP_KEEP_HEAD_LINES - SNIP_KEEP_TAIL_LINES} lines snipped — kept head + tail]`,
      ...lines.slice(lines.length - SNIP_KEEP_TAIL_LINES),
    ].join("\n");
    saved += m.content.length - kept.length;
    m.content = kept;
  }
  return saved;
}

/**
 * Prune large tool-result messages before folding.
 *
 * Stale tool results are re-derivable (files re-read, commands re-run), so
 * eliding them is a lossless alternative to the paid summarizer fold. When
 * pruning alone brings the prompt below the fold threshold, the fold is
 * skipped entirely — saving a summarizer call and avoiding a cache-prefix
 * rewrite.
 *
 * Returns the number of characters saved. Idempotent; a second call is a no-op.
 */
export const PRUNE_MIN_BYTES = 1024;
export const PRUNE_PLACEHOLDER_PREFIX = "[elided tool result — ";

export function pruneStaleToolResults(messages: ChatMessage[], minBytes = PRUNE_MIN_BYTES): number {
  let saved = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== "tool") continue;
    if (typeof m.content !== "string") continue;
    if (m.content.length < minBytes) continue;
    if (m.content.startsWith(PRUNE_PLACEHOLDER_PREFIX)) continue;
    const toolName = m.name ?? "tool";
    const placeholder = `${PRUNE_PLACEHOLDER_PREFIX}${toolName}, ${m.content.length} bytes dropped — re-run if data is needed again]`;
    saved += m.content.length - placeholder.length;
    m.content = placeholder;
  }
  return saved;
}

// Dedupe by name, last invocation wins. Read-only — leaves head bytes unchanged so the
// summarizer call's prefix still matches what the main agent already cached.
function collectPinnedSkills(head: ChatMessage[]): { names: string[]; bodies: string[] } {
  const pinned = new Map<string, string>();
  for (const msg of head) {
    if (typeof msg.content !== "string") continue;
    SKILL_PIN_REGEX.lastIndex = 0;
    for (const match of msg.content.matchAll(SKILL_PIN_REGEX)) {
      const name = match[1] as string;
      const full = match[0];
      pinned.delete(name);
      pinned.set(name, full);
    }
  }
  return { names: [...pinned.keys()], bodies: [...pinned.values()] };
}

/**
 * Count the pinned prefix length: the first user message (if small) plus
 * any system / summary messages before it. Keeping the first user turn
 * in the prefix makes post-fold cache recovery faster — DeepSeek's prefix
 * cache has more bytes to match against.
 */
export function pinnedPrefixLen(messages: ChatMessage[]): number {
  let prefix = 0;
  const PINNED_USER_MAX_TOKENS = 256;
  for (const m of messages) {
    if (m.role === "user") {
      const size = countTokensBounded(typeof m.content === "string" ? m.content : "");
      if (size <= PINNED_USER_MAX_TOKENS || prefix === 0) {
        // Pin system + first user message (if small) + any summaries
        prefix++;
        if (size <= PINNED_USER_MAX_TOKENS) break; // Pin this user and everything before
      }
      break;
    }
    prefix++;
  }
  return prefix;
}

/**
 * Mechanical fold digest — deterministic fallback when the summarizer fails.
 *
 * Extracts the first user message + tool results + last assistant message
 * into a compact summary. No API call, no cache rewrite.
 */
export function mechanicalFoldDigest(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const userText =
    firstUser && typeof firstUser.content === "string" ? firstUser.content.slice(0, 2000) : "";
  // Collect last few tool results
  const toolResults: string[] = [];
  for (let i = messages.length - 1; i >= 0 && toolResults.length < 3; i--) {
    const m = messages[i]!;
    if (m.role === "tool" && typeof m.content === "string") {
      const snippet = m.content.slice(0, 300).replace(/\n/g, " ").trim();
      if (snippet) toolResults.unshift(`${m.name ?? "tool"}: ${snippet}`);
    }
  }
  const parts: string[] = ["[mechanical digest — summarizer unavailable]"];
  if (userText) parts.push(`Original request: ${userText}`);
  if (toolResults.length > 0) parts.push(`Recent results: ${toolResults.join("; ")}`);
  return parts.join("\n\n");
}

/**
 * Check if a chat message is a prior compaction summary (assistant role with
 * the summary marker prefix). These are kept verbatim during partitionFold.
 */
function isSummaryMessage(msg: ChatMessage): boolean {
  if (msg.role !== "assistant") return false;
  if (typeof msg.content !== "string") return false;
  return isCompactionSummary(msg.content);
}

/** Small-user-turn token budget — user-stated facts are never summarized away. */
const PINNABLE_USER_MAX_TOKENS = 256;

/**
 * Partition a fold region into items kept verbatim (prior summaries, small
 * user turns) and items to fold (tool results, large assistant responses).
 *
 * Kept items preserve cache continuity across folds: old summaries stay
 * byte-identical in the conversation so DeepSeek's prefix cache at their
 * position remains valid on subsequent API calls.
 */
function partitionFoldRegion(
  head: ChatMessage[],
  pinned: number,
): { kept: ChatMessage[]; fold: ChatMessage[] } {
  const kept: ChatMessage[] = [];
  const fold: ChatMessage[] = [];

  for (let i = pinned; i < head.length; i++) {
    const msg = head[i]!;

    // Prior summaries are always kept verbatim — re-summarizing an already
    // compacted region would double-lose facts and invalidate cached bytes.
    if (isSummaryMessage(msg)) {
      kept.push(msg);
      continue;
    }

    // Small user turns are kept verbatim — a fact the user stated is never
    // summarized away, wherever in the session they said it.
    if (msg.role === "user") {
      const size = countTokensBounded(typeof msg.content === "string" ? msg.content : "");
      if (size <= PINNABLE_USER_MAX_TOKENS) {
        kept.push(msg);
        continue;
      }
    }

    // Everything else (tool results, large assistant responses) goes to fold.
    fold.push(msg);
  }

  return { kept, fold };
}

export class ContextManager {
  private _logTokensCache = -1;
  private _logTokensVersion = -1;
  /** Tracks consecutive folds to detect and break stuck loops. */
  private consecutiveFolds = 0;
  /** When true, auto-fold is paused until the prompt drops below threshold. */
  private foldStuck = false;

  constructor(private deps: ContextManagerDeps) {}

  /** Real-time token count of the current log — used by Desktop to refresh the
   *  context meter after /compact when no API usage event is available. */
  getLogTokens(): number {
    if (this._logTokensCache >= 0 && this._logTokensVersion === this.deps.log.version) {
      return this._logTokensCache;
    }
    const entries = this.deps.log.toFullHistory();
    let total = 0;
    for (const e of entries) {
      const content = typeof e.content === "string" ? e.content : "";
      total += countTokensBounded(content);
      if (e.role === "assistant" && Array.isArray(e.tool_calls) && e.tool_calls.length > 0) {
        total += countTokensBounded(JSON.stringify(e.tool_calls));
      }
    }
    this._logTokensCache = total;
    this._logTokensVersion = this.deps.log.version;
    return total;
  }

  /** Decision after a turn's response — fold, exit with summary, or carry on. */
  decideAfterUsage(
    usage: Usage | null,
    model: string,
    alreadyFoldedThisTurn: boolean,
  ): PostUsageDecision {
    const ctxMax = resolveContextTokens(model);
    if (!usage) return { kind: "none", promptTokens: 0, ctxMax, ratio: 0 };
    const ratio = usage.promptTokens / ctxMax;
    const base = { promptTokens: usage.promptTokens, ctxMax, ratio };

    // If below threshold, reset consecutive guard.
    if (ratio < HISTORY_FOLD_THRESHOLD * 0.9) {
      this.consecutiveFolds = 0;
      this.foldStuck = false;
    }

    if (ratio > FORCE_SUMMARY_THRESHOLD) {
      return { kind: "exit-with-summary", ...base };
    }
    if (alreadyFoldedThisTurn) return { kind: "none", ...base };
    if (this.foldStuck) return { kind: "none", ...base };

    // Soft threshold: warn about growing context but don't rewrite the prefix.
    // Folding here would crater the cache for minimal headroom gain.
    if (ratio > HISTORY_FOLD_SOFT_THRESHOLD && ratio < HISTORY_FOLD_THRESHOLD) {
      return { kind: "soft-warn", ...base };
    }

    // Force ratio — compact even when economics don't justify it.
    if (ratio > HISTORY_FOLD_FORCE_THRESHOLD) {
      return {
        kind: "fold",
        ...base,
        tailBudget: Math.floor(ctxMax * HISTORY_FOLD_AGGRESSIVE_TAIL_FRACTION),
        aggressive: true,
        force: true,
      };
    }

    if (ratio > HISTORY_FOLD_AGGRESSIVE_THRESHOLD) {
      return {
        kind: "fold",
        ...base,
        tailBudget: Math.floor(ctxMax * HISTORY_FOLD_AGGRESSIVE_TAIL_FRACTION),
        aggressive: true,
      };
    }
    if (ratio > HISTORY_FOLD_THRESHOLD) {
      const tailBudget = Math.floor(ctxMax * HISTORY_FOLD_TAIL_FRACTION);
      const economics = estimateFoldEconomics(usage, model, tailBudget);
      if (!economics.worthwhile) {
        return { kind: "none", ...base, economics };
      }
      return {
        kind: "fold",
        ...base,
        tailBudget,
        aggressive: false,
        economics,
      };
    }
    return { kind: "none", ...base };
  }

  /** Turn-start estimate vs ctxMax — caller folds if the ratio crosses
   *  TURN_START_FOLD_THRESHOLD. Replaces the old preflight/mechanical pair. */
  estimateTurnStart(
    messages: ChatMessage[],
    toolSpecs: ReadonlyArray<unknown> | undefined | null,
    model: string,
  ): { estimateTokens: number; ctxMax: number; ratio: number } {
    const ctxMax = resolveContextTokens(model);
    const estimate = estimateRequestTokens(messages, toolSpecs ?? null, true);
    return { estimateTokens: estimate, ctxMax, ratio: estimate / ctxMax };
  }

  async fold(
    model: string,
    opts?: { keepRecentTokens?: number; requireTailBoundary?: boolean },
  ): Promise<FoldResult> {
    const ctxMax = resolveContextTokens(model);
    const tailBudget = opts?.keepRecentTokens ?? Math.floor(ctxMax * HISTORY_FOLD_TAIL_FRACTION);
    const all = this.deps.log.toFullHistory();
    const noop: FoldResult = {
      folded: false,
      beforeMessages: all.length,
      afterMessages: all.length,
      summaryChars: 0,
    };
    if (all.length === 0) return noop;

    // Step 1: Snip large tool outputs from the middle (keeps prefix shape).
    snipStaleToolResults(all);

    // Step 2: Prune stale tool results before folding — a free, lossless reduction.
    // If pruning alone brings the prompt below threshold, skip the fold.
    const pruneSaved = pruneStaleToolResults(all);
    if (pruneSaved > 0) {
      // Re-persist the pruned+sniped messages so the change survives.
      this.deps.log.compactInPlace([...all]);
      this.persistRewrite([...all]);
      this.deps.onLogRewrite?.();
    }

    // Per-message token cost includes tool_calls JSON; otherwise heavy tool-call
    // arguments slip through the tail-budget check and the boundary slides past
    // the active tool turn. No chat-template wrapper here — that would double-count.
    const tokenCounts = all.map((m) => {
      let n = countTokensBounded(typeof m.content === "string" ? m.content : "");
      if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        n += countTokensBounded(JSON.stringify(m.tool_calls));
      }
      return n;
    });
    const totalTokens = tokenCounts.reduce((a, b) => a + b, 0);

    // The whole log already fits in the requested tail budget — nothing to fold.
    if (totalTokens <= tailBudget) {
      this.consecutiveFolds = 0;
      return { ...noop, folded: false, beforeMessages: all.length };
    }

    // If snip+prune alone brought us below threshold, skip fold entirely —
    // unless the caller explicitly requested a fold (e.g. tests / /compact).
    const forced = opts?.keepRecentTokens !== undefined;
    if (totalTokens < ctxMax * HISTORY_FOLD_THRESHOLD && !forced) {
      this.consecutiveFolds = 0;
      return { ...noop, folded: false, beforeMessages: all.length };
    }

    // Track consecutive folds — if stuck, pause auto-fold.
    // Skip the guard for explicitly requested folds (tests, /compact).
    if (!forced) {
      this.consecutiveFolds++;
      if (this.consecutiveFolds >= HISTORY_FOLD_MAX_CONSECUTIVE) {
        this.foldStuck = true;
        this.consecutiveFolds = 0;
        return noop;
      }
    }

    // Calculate fold boundary, keeping pinned prefix stable.
    const pinned = pinnedPrefixLen(all);
    let cumTokens = 0;
    let boundary = all.length;
    for (let i = all.length - 1; i >= pinned; i--) {
      if (cumTokens + tokenCounts[i]! > tailBudget) break;
      cumTokens += tokenCounts[i]!;
      if (all[i]!.role === "user") boundary = i;
    }
    if (boundary <= pinned) return noop;
    // If the whole log fits inside the tail budget, there is no head to fold.
    // For explicitly requested folds we still summarize: the caller asked for a
    // compacted log even when the tail budget cannot retain any turns.
    if (boundary >= all.length && !forced) {
      this.consecutiveFolds = 0;
      return { ...noop, folded: false, beforeMessages: all.length };
    }
    // Preflight-only: refuse when no user landed in tail — the active tool turn
    // would be wiped. Default fold path (post-response) tolerates empty tail so
    // cache-aligned summary tests still exercise the "summarize all" shape.
    if (opts?.requireTailBoundary && boundary >= all.length) return noop;

    const head = all.slice(0, boundary);
    const tail = all.slice(boundary);
    const headTokens = totalTokens - cumTokens;
    if (!forced && headTokens < totalTokens * HISTORY_FOLD_MIN_SAVINGS_FRACTION) {
      this.consecutiveFolds = Math.max(0, this.consecutiveFolds - 1);
      return noop;
    }

    // Build the denoised corpus from the entire original log. The fold is a
    // jump point: we denoise everything once, persist it, then start a fresh
    // JSONL. The framework layer carries the last 30 denoised turns; the hot
    // zone keeps the last 5 original turns at full fidelity.
    const sessionId = this.deps.sessionName ? loadSessionId(this.deps.sessionName) : "session";
    const { timestampSuffix } = await import("./memory/session.js");
    const ts = timestampSuffix();
    const workspace = this.deps.sessionName?.includes("/")
      ? this.deps.sessionName.split("/")[0]
      : undefined;
    const archiveBase = `${sessionId}__archive_${ts}`;
    const archiveSessionName = workspace ? `${workspace}/${archiveBase}` : archiveBase;
    const denoisedAll = this.buildDenoisedCorpus(all, sessionId, archiveSessionName, "fold");
    await this.persistDenoisedCorpus(sessionId, denoisedAll);

    // Cluster the denoised log into topic/decision clusters.
    const clusters = clusterDenoisedTurns(denoisedAll);

    // Persist the fold view for theme tracing.
    const foldView: FoldView = {
      fold_id: `f-${sessionId}-${Date.now()}`,
      session_id: sessionId,
      created_at: new Date().toISOString(),
      source_turn_range: [
        denoisedAll[0]?.turnId ?? 1,
        denoisedAll[denoisedAll.length - 1]?.turnId ?? 1,
      ],
      summary: buildFoldSummaryText(clusters),
      clusters,
    };
    await saveFoldView(foldView);

    // Build the folded prompt. We preserve the existing partition/summary
    // structure for cache continuity and backward compatibility, then append
    // the new cluster + framework + hot-zone layers.
    // Layer 1: pinned prefix (system + first small user turn) — kept verbatim.
    const pinnedMessages = all.slice(0, pinned);

    // Layer 2: small user turns and prior summaries kept verbatim.
    const { kept, fold } = partitionFoldRegion(head, pinned);

    // Layer 3: LLM-generated fold summary.
    const { names: pinnedNames, bodies: pinnedBodies } = collectPinnedSkills(head);
    const memoTail =
      pinnedBodies.length > 0 ? `\n\n${SKILL_PIN_MEMO_HEADER}\n\n${pinnedBodies.join("\n\n")}` : "";
    const constraints = extractPinnedConstraints(this.deps.getSystemPrompt());
    const constraintTail = constraints
      ? `\n\n[PINNED CONSTRAINTS — preserved verbatim]\n\n${constraints}`
      : "";
    const summary = await this.summarizeForFold(fold, pinnedNames);
    const digest = summary.content || buildFoldSummaryText(clusters);
    const summaryMsg = buildAssistantMessage(
      HISTORY_FOLD_MARKER + digest + memoTail + constraintTail,
      [],
      model,
      summary.reasoningContent,
    );

    // Layer 4: cluster summaries (structured, compact).
    const clusterSummaryLines: string[] = ["Decision clusters:"];
    for (const c of clusters) {
      clusterSummaryLines.push(`\n[${c.cluster_id}] ${c.topic}`);
      if (c.decision) clusterSummaryLines.push(`  Decision: ${c.decision}`);
      if (c.file_refs.length > 0) clusterSummaryLines.push(`  Files: ${c.file_refs.join(", ")}`);
      clusterSummaryLines.push(`  Turns: ${c.turns.map((t) => t.turnid).join(", ")}`);
    }
    const clusterMsg = buildAssistantMessage(
      HISTORY_FOLD_MARKER + clusterSummaryLines.join("\n"),
      [],
      model,
      "",
    );

    // Layer 5: recent 30 denoised framework turns.
    const frameworkTurns = denoisedAll.slice(-FRAMEWORK_TURNS);
    const frameworkMsgs = this.buildFrameworkMessages(frameworkTurns);

    // Layer 6: recent 5 original tail turns (hot zone).
    const hotZoneTurns = this.extractLastNTurnMessages(tail, HOT_ZONE_TURNS);

    const replacement = [
      ...pinnedMessages,
      ...kept,
      summaryMsg,
      clusterMsg,
      ...frameworkMsgs,
      ...hotZoneTurns,
    ];

    // Archive the original live JSONL before rewriting, then start the new
    // folded JSONL under the same session name.
    if (this.deps.sessionName) {
      await this.archiveOriginalSession(this.deps.sessionName, archiveSessionName);
    }
    this.deps.log.compactInPlace(replacement);
    this.persistRewrite(replacement);
    this.deps.onLogRewrite?.();
    this.consecutiveFolds = 0;
    return {
      folded: true,
      beforeMessages: all.length,
      afterMessages: replacement.length,
      summaryChars: digest.length,
    };
  }

  /** Drop a trailing in-flight assistant-with-tool_calls before a forced summary. Tail-only mutation; prefix cache safe. */
  trimTrailingToolCalls(): boolean {
    const tail = this.deps.log.entries[this.deps.log.entries.length - 1];
    if (
      !tail ||
      tail.role !== "assistant" ||
      !Array.isArray(tail.tool_calls) ||
      tail.tool_calls.length === 0
    ) {
      return false;
    }
    const kept = this.deps.log.entries.slice(0, -1);
    this.deps.log.compactInPlace([...kept]);
    this.persistRewrite([...kept]);
    return true;
  }

  /**
   * Build denoised framework turns from a message array.
   */
  private buildDenoisedCorpus(
    messages: ChatMessage[],
    sessionId: string,
    sessionName: string,
    source: "fold" | "search",
  ): DenoisedTurn[] {
    const rawTurns = messagesToRawTurns(messages);
    return rawTurns.map((turn) => denoiseTurn(turn, { sessionId, sessionName, source }));
  }

  /**
   * Persist the denoised corpus to `{sessionId}.denoised.jsonl` and the SQLite index.
   */
  private async persistDenoisedCorpus(sessionId: string, denoised: DenoisedTurn[]): Promise<void> {
    if (!this.deps.sessionName) return;
    const { sessionPath } = await import("./memory/session.js");
    const fs = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const livePath = sessionPath(this.deps.sessionName);
    const path = join(dirname(livePath), `${sessionId}.denoised.jsonl`);
    await fs.mkdir(dirname(path), { recursive: true });
    const lines = denoised.map((t) => JSON.stringify(t)).join("\n");
    await fs.writeFile(path, lines ? `${lines}\n` : "", "utf8");

    const manager = getRefinedManager();
    await manager.saveDenoisedTurns(denoised);
  }

  /**
   * Convert denoised framework turns into ChatMessages for the live prompt.
   */
  private buildFrameworkMessages(turns: DenoisedTurn[]): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (const turn of turns) {
      const sessionId = turn.sessionId;
      const turnId = turn.turnId;
      const toolList = turn.toolsCalled.map((t) => t.name).join(", ") || "none";
      const fileList = turn.files.join(", ") || "none";

      if (turn.userIntent) {
        out.push({
          role: "user",
          content: `[framework] ${turn.userIntent}`,
          turnId,
          sessionId,
        });
      }
      const assistantBody = [
        turn.assistantConclusion ? `Conclusion: ${turn.assistantConclusion}` : "",
        `Tools: ${toolList}`,
        `Files: ${fileList}`,
        turn.errors.length > 0 ? `Errors: ${turn.errors.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      if (assistantBody) {
        out.push({
          role: "assistant",
          content: `[framework] ${assistantBody}`,
          turnId,
          sessionId,
        });
      }
    }
    return out;
  }

  /**
   * Extract the messages belonging to the last N turns from a message array.
   * A turn starts at a user message and ends before the next user message.
   */
  private extractLastNTurnMessages(messages: ChatMessage[], n: number): ChatMessage[] {
    if (messages.length === 0 || n <= 0) return [];
    const userIndices: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      if (messages[i]!.role === "user") userIndices.push(i);
    }
    const startIndex = userIndices.length <= n ? 0 : userIndices[userIndices.length - n]!;
    return messages.slice(startIndex);
  }

  /**
   * Archive the original live JSONL to `{sessionId}__archive_{ts}.jsonl` before
   * rewriting it with the folded prompt.
   */
  private async archiveOriginalSession(
    sessionName: string,
    archiveSessionName: string,
  ): Promise<void> {
    const { sessionPath } = await import("./memory/session.js");
    const { copyFile } = await import("node:fs/promises");
    const livePath = sessionPath(sessionName);
    const liveToolcache = `${livePath}.toolcache.jsonl`;
    let archivePath = sessionPath(archiveSessionName);
    try {
      await copyFile(livePath, archivePath);
      await copyFile(liveToolcache, `${archivePath}.toolcache.jsonl`).catch(() => {
        // Best-effort: toolcache sidecar may not exist.
      });
      return;
    } catch {
      // If the same-minute target exists, disambiguate.
      for (let n = 2; n < 100; n++) {
        try {
          archivePath = sessionPath(`${archiveSessionName}-${n}`);
          await copyFile(livePath, archivePath);
          await copyFile(liveToolcache, `${archivePath}.toolcache.jsonl`).catch(() => {
            // Best-effort.
          });
          return;
        } catch {
          // keep trying
        }
      }
    }
  }

  private async summarizeForFold(
    messagesToSummarize: ChatMessage[],
    pinnedSkillNames: string[],
  ): Promise<{ content: string; reasoningContent: string }> {
    const summaryModel = "deepseek-v4-flash";
    // Restore archived tool content before sending to summarizer so the
    // summary includes full detail even after proactive archiving.
    if (this.deps.sessionName) {
      const archiveMap = await loadArchiveMap(this.deps.sessionName);
      if (archiveMap.size > 0) {
        restoreFromArchive(messagesToSummarize, archiveMap);
      }
    }
    const healed = healLoadedMessages(messagesToSummarize, DEFAULT_MAX_RESULT_CHARS).messages;
    const agentSystem = this.deps.getSystemPrompt();
    const fewShots = this.deps.getFewShots?.() ?? [];
    const tools = this.deps.getToolSpecs?.() ?? [];
    const instruction = buildFoldSummaryInstruction(pinnedSkillNames);
    const messages: ChatMessage[] = [
      { role: "system", content: agentSystem },
      ...fewShots.map((m) => ({ ...m })),
      ...healed,
      { role: "user", content: instruction },
    ];
    const turnSignal = this.deps.getAbortSignal();
    const foldCtrl = new AbortController();
    let cleanupAbort = (): void => {};
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const abortPromise = new Promise<never>((_, reject) => {
        const abort = () => {
          foldCtrl.abort();
          reject(new Error("fold-aborted"));
        };
        if (turnSignal.aborted) {
          abort();
        } else {
          turnSignal.addEventListener("abort", abort, { once: true });
          cleanupAbort = () => turnSignal.removeEventListener("abort", abort);
        }
      });
      const timeoutMs =
        Number.parseInt(process.env.REASONIX_FOLD_SUMMARY_TIMEOUT_MS ?? "", 10) ||
        HISTORY_FOLD_SUMMARY_TIMEOUT_MS;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          foldCtrl.abort();
          reject(new Error("fold-timeout"));
        }, timeoutMs);
      });
      const resp = await Promise.race([
        this.deps.client.chat({
          model: summaryModel,
          messages,
          tools: tools.length ? (tools as ToolSpec[]) : undefined,
          signal: foldCtrl.signal,
          thinking: "disabled",
        }),
        abortPromise,
        timeoutPromise,
      ]);
      this.deps.stats.record(this.deps.getCurrentTurn(), summaryModel, resp.usage ?? new Usage());
      return {
        content: stripHallucinatedToolMarkup((resp.content ?? "").trim()),
        reasoningContent: resp.reasoningContent ?? "",
      };
    } catch {
      return { content: "", reasoningContent: "" };
    } finally {
      if (timeout) clearTimeout(timeout);
      cleanupAbort();
    }
  }

  private persistRewrite(messages: ChatMessage[]): void {
    if (!this.deps.sessionName) return;
    try {
      rewriteSession(this.deps.sessionName, messages);
    } catch {
      /* disk full / perms — in-memory mutation still applies */
    }
  }
}

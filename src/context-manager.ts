import { dirname } from "node:path";
import { COMPACTION_SUMMARY_MARKER } from "@reasonix/core-utils";
import type { DeepSeekClient } from "./client.js";
import { Usage } from "./client.js";
import { stripHallucinatedToolMarkup } from "./loop.js";
import { buildAssistantMessage } from "./loop/messages.js";
import { type FoldView, saveFoldView } from "./memory/fold-view.js";
import type { AppendOnlyLog } from "./memory/runtime.js";
import { loadSessionId, rewriteSession, sessionPath } from "./memory/session.js";
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

/** Between soft and compact thresholds, warn once but keep the cache-stable prefix intact. */
export const HISTORY_FOLD_SOFT_THRESHOLD = 0.5;
/** Auto-fold when a turn's response shows promptTokens above this fraction of ctxMax. */
export const HISTORY_FOLD_THRESHOLD = 0.75;
/** Tail budget after a normal fold, as a fraction of ctxMax (legacy; current design folds all raw turns). */
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
 *  post-response fold can't (terminal prior turn, fresh session restore, huge user paste). */
export const TURN_START_FOLD_THRESHOLD = 0.9;
/** Hard deadline for semantic fold summaries so a hung request cannot stall the turn loop. */
export const HISTORY_FOLD_SUMMARY_TIMEOUT_MS = 15_000;
/** Normal-band folds should pay for themselves over a short horizon; aggressive folds still prioritize headroom. */
export const HISTORY_FOLD_ECONOMIC_HORIZON_TURNS = 3;
export const HISTORY_FOLD_MIN_ECONOMIC_SAVINGS_FRACTION = 0.15;
export const HISTORY_FOLD_MIN_ECONOMIC_SAVINGS_USD = 0.002;
/** Summary + next-turn cold segment reserve used by fold economics. */
export const HISTORY_FOLD_SUMMARY_RESERVE_TOKENS = 4096;
/** Prepended to fold summary content so the model knows it's a synthesized recap. */
export const HISTORY_FOLD_MARKER = COMPACTION_SUMMARY_MARKER;
/** Number of recent turns kept at full fidelity after a fold (hot zone). */
export const HOT_ZONE_TURNS = 5;
/** Number of denoised framework turns injected after the fold summary. */
export const FRAMEWORK_TURNS = 30;
/** Header that precedes preserved skill bodies in a fold's synthesized assistant message.
 *  Kept as a no-op marker for backward compatibility; skill memos are no longer pinned across folds. */
export const SKILL_PIN_MEMO_HEADER = "[Active skill memos — preserved verbatim across the fold:]";

// ---------------------------------------------------------------------------
// Fold artifact markers
// ---------------------------------------------------------------------------

const FOLD_SUMMARY_MARKER_PREFIX = "<!-- fold:";
const FOLD_SUMMARY_REGEX = /^<!-- fold: (\S+) -->\n?/;
const CURRENT_FOLD_MARKER_PREFIX = "<!-- current-fold:";
const CURRENT_FOLD_REGEX = /^<!-- current-fold: (\S+) -->\n?/;
const MAX_EPOCH_SUMMARIES = 5;
const EPOCH_SUMMARY_MAX_TOKENS = 1024;

interface ParsedSummary {
  foldId: string;
  message: ChatMessage;
}

interface ParsedCurrentFold {
  foldId: string;
  clustersMsg: ChatMessage;
  frameworkMsgs: ChatMessage[];
  hotzoneMsgs: ChatMessage[];
  endIndex: number;
}

interface ParsedFoldArtifacts {
  summaries: ParsedSummary[];
  currentFold?: ParsedCurrentFold;
}

function parseFoldArtifacts(messages: ChatMessage[]): ParsedFoldArtifacts {
  const summaries: ParsedSummary[] = [];
  let currentFold: ParsedCurrentFold | undefined;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role !== "assistant" || typeof msg.content !== "string") continue;

    const summaryMatch = msg.content.match(FOLD_SUMMARY_REGEX);
    if (summaryMatch) {
      summaries.push({ foldId: summaryMatch[1]!, message: msg });
      continue;
    }

    const currentMatch = msg.content.match(CURRENT_FOLD_REGEX);
    if (currentMatch) {
      const foldId = currentMatch[1]!;
      const clustersMsg = msg;
      const frameworkMsgs: ChatMessage[] = [];
      const hotzoneMsgs: ChatMessage[] = [];
      let j = i + 1;
      for (; j < messages.length; j++) {
        const next = messages[j]!;
        if (next.foldId !== foldId || !next.foldArtifact) break;
        if (next.foldArtifact === "framework") frameworkMsgs.push(next);
        else if (next.foldArtifact === "hotzone") hotzoneMsgs.push(next);
      }
      currentFold = { foldId, clustersMsg, frameworkMsgs, hotzoneMsgs, endIndex: j - 1 };
      i = j - 1;
    }
  }

  return { summaries, currentFold };
}

function isPlaceholder(content: string): boolean {
  return content.startsWith("[archived: ");
}

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
  /** Token budget for the recent tail when kind === "fold"; smaller in the aggressive band. (Legacy field; fold now consumes all raw turns.) */
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
   *  TURN_START_FOLD_THRESHOLD. */
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
    const all = this.deps.log.toFullHistory();
    const noop: FoldResult = {
      folded: false,
      beforeMessages: all.length,
      afterMessages: all.length,
      summaryChars: 0,
    };
    if (all.length === 0) return noop;

    const parsed = parseFoldArtifacts(all);
    const rawTurnsStart = parsed.currentFold ? parsed.currentFold.endIndex + 1 : 0;
    const rawTurns = all.slice(rawTurnsStart);

    const forced = opts?.keepRecentTokens !== undefined;
    if (!forced && rawTurns.length === 0) return noop;

    // Honor explicit keepRecentTokens as a no-op threshold (used by tests / /compact).
    if (forced && opts!.keepRecentTokens !== undefined) {
      const rawTurnsTokens = rawTurns.reduce(
        (sum, m) =>
          sum +
          countTokensBounded(typeof m.content === "string" ? m.content : "") +
          (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0
            ? countTokensBounded(JSON.stringify(m.tool_calls))
            : 0),
        0,
      );
      if (rawTurnsTokens <= opts!.keepRecentTokens) {
        return noop;
      }
    }

    if (!forced) {
      this.consecutiveFolds++;
      if (this.consecutiveFolds >= HISTORY_FOLD_MAX_CONSECUTIVE) {
        this.foldStuck = true;
        this.consecutiveFolds = 0;
        return noop;
      }
    }

    const sessionId = this.deps.sessionName ? loadSessionId(this.deps.sessionName) : "session";
    const { timestampSuffix } = await import("./memory/session.js");
    const ts = timestampSuffix();
    const workspace = this.deps.sessionName?.includes("/")
      ? this.deps.sessionName.split("/")[0]
      : undefined;
    const archiveBase = `${sessionId}__archive_${ts}`;
    const archiveSessionName = workspace ? `${workspace}/${archiveBase}` : archiveBase;

    // Archive the original live JSONL before any mutation.
    if (this.deps.sessionName) {
      await this.archiveOriginalSession(this.deps.sessionName, archiveSessionName);
    }

    // Build the denoised corpus from raw turns before tool results are replaced.
    const denoisedAll = this.buildDenoisedCorpus(rawTurns, sessionId, archiveSessionName, "fold");
    await this.persistDenoisedCorpus(sessionId, denoisedAll);

    // Cluster the raw turns into topic/decision clusters.
    const clusters = clusterDenoisedTurns(denoisedAll);

    // Identify the hot zone (last N turns kept verbatim).
    const hotZoneMessages = this.extractLastNTurnMessages(rawTurns, HOT_ZONE_TURNS);
    const hotZoneSet = new Set(hotZoneMessages);

    // Archive tool results outside the hot zone and replace them with placeholders.
    await this.archiveToolResults(rawTurns, hotZoneSet, sessionId);

    // Build the new fold identity.
    const foldId = `f-${sessionId}-${Date.now()}`;

    // Summarize the previous fold's three artifacts (clusters/framework/hotzone).
    // First fold has no previous artifacts, so no summary is generated.
    const { content: epochSummary, reasoningContent: epochReasoning } =
      await this.summarizePreviousFold(model, parsed.currentFold);

    // Build current-fold artifacts.
    const clustersMsg = this.buildClustersMessage(foldId, clusters, model);
    const frameworkTurns = denoisedAll.slice(-FRAMEWORK_TURNS);
    const frameworkMsgs = this.buildFrameworkMessages(frameworkTurns, foldId);
    const hotzoneMsgs = hotZoneMessages.map((m) => ({
      ...m,
      foldId,
      foldArtifact: "hotzone" as const,
    }));

    // Historical summaries: keep prior ones, append new epoch summary, and reset
    // to just the latest when we exceed the retention window.
    let summaries: ChatMessage[] = parsed.summaries.map((s) => ({ ...s.message }));
    if (epochSummary) {
      const summaryMsg = buildAssistantMessage(
        `${FOLD_SUMMARY_MARKER_PREFIX} ${foldId} -->\n${HISTORY_FOLD_MARKER}${epochSummary}`,
        [],
        model,
        epochReasoning,
      );
      summaryMsg.foldId = foldId;
      summaryMsg.foldArtifact = "summary";
      summaries.push(summaryMsg);
      if (summaries.length > MAX_EPOCH_SUMMARIES) {
        summaries = [summaryMsg];
      }
    }

    const replacement: ChatMessage[] = [
      ...summaries,
      clustersMsg,
      ...frameworkMsgs,
      ...hotzoneMsgs,
    ];

    this.deps.log.compactInPlace(replacement);
    this.persistRewrite(replacement);
    this.deps.onLogRewrite?.();
    this.consecutiveFolds = 0;

    const foldView: FoldView = {
      fold_id: foldId,
      session_id: sessionId,
      parent_fold_id: parsed.currentFold?.foldId,
      created_at: new Date().toISOString(),
      source_turn_range: [
        denoisedAll[0]?.turnId ?? 0,
        denoisedAll[denoisedAll.length - 1]?.turnId ?? 0,
      ],
      summary: epochSummary,
      clusters,
    };
    await saveFoldView(foldView);

    return {
      folded: true,
      beforeMessages: all.length,
      afterMessages: replacement.length,
      summaryChars: epochSummary.length,
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

  private buildDenoisedCorpus(
    messages: ChatMessage[],
    sessionId: string,
    sessionName: string,
    source: "fold" | "search",
  ): DenoisedTurn[] {
    const rawTurns = messagesToRawTurns(messages);
    return rawTurns.map((turn) => denoiseTurn(turn, { sessionId, sessionName, source }));
  }

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

  private buildFrameworkMessages(turns: DenoisedTurn[], foldId: string): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (const turn of turns) {
      const turnId = turn.turnId;
      const toolList = turn.toolsCalled.map((t) => t.name).join(", ") || "none";
      const fileList = turn.files.join(", ") || "none";

      if (turn.userIntent) {
        out.push({
          role: "user",
          content: `[framework] ${turn.userIntent}`,
          turnId,
          sessionId: turn.sessionId,
          foldId,
          foldArtifact: "framework",
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
          sessionId: turn.sessionId,
          foldId,
          foldArtifact: "framework",
        });
      }
    }
    return out;
  }

  private buildClustersMessage(
    foldId: string,
    clusters: DecisionCluster[],
    model: string,
  ): ChatMessage {
    const lines: string[] = ["Decision clusters:"];
    for (const c of clusters) {
      lines.push(`\n[${c.cluster_id}] ${c.topic}`);
      if (c.decision) lines.push(`  Decision: ${c.decision}`);
      if (c.file_refs.length > 0) lines.push(`  Files: ${c.file_refs.join(", ")}`);
      lines.push(`  Turns: ${c.turns.map((t) => t.turnid).join(", ")}`);
    }
    const msg = buildAssistantMessage(
      `${CURRENT_FOLD_MARKER_PREFIX} ${foldId} -->\n${lines.join("\n")}`,
      [],
      model,
      "",
    );
    msg.foldId = foldId;
    msg.foldArtifact = "clusters";
    return msg;
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

  private async archiveToolResults(
    rawTurns: ChatMessage[],
    hotZoneSet: Set<ChatMessage>,
    sessionId: string,
  ): Promise<void> {
    if (!this.deps.sessionName) return;
    const { sessionPath } = await import("./memory/session.js");
    const fs = await import("node:fs/promises");
    const path = `${sessionPath(this.deps.sessionName)}.toolcache.jsonl`;
    await fs.mkdir(dirname(path), { recursive: true });

    for (const msg of rawTurns) {
      if (msg.role !== "tool") continue;
      if (hotZoneSet.has(msg)) continue;
      if (typeof msg.content !== "string" || isPlaceholder(msg.content)) continue;
      const name = msg.name ?? "tool";
      const entry = {
        sessionId,
        turn: msg.turnId ?? 0,
        toolName: name,
        toolCallId: msg.tool_call_id ?? "",
        role: "tool" as const,
        content: msg.content,
        archivedAt: new Date().toISOString(),
        kind: "generic" as const,
      };
      await fs.appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
      const charCount = msg.content.length;
      const lineCount = msg.content.split("\n").length;
      msg.content = `[archived: ${name} (${charCount} chars, ${lineCount} lines) — 已降噪]`;
    }
  }

  private async summarizePreviousFold(
    model: string,
    currentFold: ParsedCurrentFold | undefined,
  ): Promise<{ content: string; reasoningContent: string }> {
    if (!currentFold) return { content: "", reasoningContent: "" };

    const summaryModel = "deepseek-v4-flash";
    const agentSystem = this.deps.getSystemPrompt();
    const fewShots = this.deps.getFewShots?.() ?? [];
    const tools = this.deps.getToolSpecs?.() ?? [];
    const artifactMessages: ChatMessage[] = [
      currentFold.clustersMsg,
      ...currentFold.frameworkMsgs,
      ...currentFold.hotzoneMsgs,
    ];
    const instruction =
      "Summarize the previous fold above into a concise epoch recap (≤1024 tokens). " +
      "Preserve the user's original objective, all 'do not' / 'never' / 'avoid' instructions, " +
      "decisions reached, files inspected or modified, tool results still relevant, and any open todos. " +
      "Skip turn-by-turn play-by-play. Output plain prose only — no tool calls, no markdown headings, no SEARCH/REPLACE blocks.";
    const messages: ChatMessage[] = [
      { role: "system", content: agentSystem },
      ...fewShots.map((m) => ({ ...m })),
      ...artifactMessages,
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
          maxTokens: EPOCH_SUMMARY_MAX_TOKENS,
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

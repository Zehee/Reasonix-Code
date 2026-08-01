import { invoke, isWebRuntime } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { CommandPalette, Toast, buildCommands, useCommandPalette } from "./CommandPalette";
import { WorkspaceProvider } from "./Markdown";
import { getLang, getLangLabel, getSupportedLangs, setLang, t, useLang } from "./i18n";
import { I } from "./icons";
import { readSessionFromUrl, writeSessionToUrl } from "./lib/session-url";
import { setActiveTabIdInBridge } from "./lib/tauri-bridge";
import type {
  CheckpointVerdict,
  ChoiceVerdict,
  ConfirmationChoice,
  IncomingEvent,
  JobInfo,
  McpSpecInfo,
  MemoryDetail,
  MemoryEntryInfo,
  OutgoingCommand,
  PlanVerdict,
  RevisionVerdict,
  SettingsPatch,
  SkillInfo,
} from "./protocol";
import type { QQDesktopSettingsState } from "./qq-settings";
import {
  FONT_FAMILY,
  FONT_FAMILY_STACK,
  FONT_SCALE,
  FONT_SCALE_ZOOM,
  type FontFamily,
  type FontScale,
  THEME,
  type Theme,
  type ThemeStyle,
  defaultStyleForTheme,
  isFontFamily,
  isFontScale,
  isTheme,
  isThemeStyle,
  themeForStyle,
} from "./theme";
import { AboutModal } from "./ui/about";
import { Composer, type SlashCmd } from "./ui/composer";
import { ContextPanel } from "./ui/context-panel";
import { JobsPop } from "./ui/jobs-pop";
import { useElapsed } from "./ui/live";
import { SettingsModal, type PageId as SettingsPageId } from "./ui/settings";
import { Shortcut, localizeShortcutText, shortcutText } from "./ui/shortcut";
import { Sidebar } from "./ui/sidebar";
import { Splash, shouldShowSplash } from "./ui/splash";
import { StatusBar } from "./ui/statusbar";
import {
  ActivePlanTaskCard,
  AssistantMsg,
  CheckpointApprovalCard,
  ChoiceApprovalCard,
  ConfirmApprovalCard,
  PathAccessApprovalCard,
  PlanApprovalCard,
  PlanBanner,
  RevisionApprovalCard,
  TurnDivider,
  UserMsg,
} from "./ui/thread";
import { elideTranscriptMessages } from "./ui/transcript-elision";
import { useAutoScroll } from "./ui/useAutoScroll";
import { useDisableTextAssist } from "./ui/useDisableTextAssist";
import { useThemeSettings } from "./ui/use-theme-settings";
import { WorkdirInputModal } from "./ui/workdir-input-modal";
import { WorkdirPop } from "./ui/workdir-pop";
import { WorkspaceTab } from "./ui/workspace-tabs";
import { TitleBar, TabBar } from "./ui/title-bar";

export type AssistantSegment =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | {
      kind: "tool";
      callId: string;
      name: string;
      args: string;
      startedAt: number;
      result?: string;
      ok?: boolean;
      durationMs?: number;
    };

export type SkillOrigin = {
  name: string;
  runAs: "inline" | "subagent";
};

export type ChatMessage =
  | { kind: "user"; text: string; clientId: string; turn: number; skill?: SkillOrigin }
  | {
      kind: "assistant";
      turn: number;
      segments: AssistantSegment[];
      pending: boolean;
    }
  | { kind: "status"; text: string }
  | { kind: "warning"; id: string; text: string; severity: "low" | "high" }
  | { kind: "error"; message: string };

export type PendingConfirm = {
  id: number;
  kind: "run_command" | "run_background";
  command: string;
};

export type PendingPathAccess = {
  id: number;
  path: string;
  intent: "read" | "write";
  toolName: string;
  sandboxRoot: string;
  allowPrefix: string;
};

export type PendingChoice = {
  id: number;
  question: string;
  options: { id: string; title: string; summary?: string }[];
  allowCustom: boolean;
};

export type PendingPlan = {
  id: number;
  plan: string;
  summary?: string;
  steps?: PlanStep[];
};

export type PlanStep = {
  id: string;
  title: string;
  action: string;
  risk?: "low" | "med" | "high";
};

export type ActivePlan = {
  plan: string;
  summary?: string;
  steps: PlanStep[];
  completedStepIds: string[];
  stepResults: Record<string, string>;
};

export type PendingCheckpoint = {
  id: number;
  stepId: string;
  title?: string;
  result: string;
  notes?: string;
  completed: number;
  total: number;
};

export type PendingRevision = {
  id: number;
  reason: string;
  remainingSteps: PlanStep[];
  summary?: string;
};

export type UsageStats = {
  totalCostUsd: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  lastCallCacheHit: number | null;
  lastCallCacheMiss: number | null;
  /** System prompt + tool specs — constant for the session, sent on tab open. */
  reservedTokens: number;
  /** Current turn log tokens from $ctx_breakdown — reflects real-time context usage. */
  logTokens: number;
  /** Actual prompt tokens from the last API usage event — more accurate than the estimate above. */
  lastPromptTokens: number;
  /** Model's token context capacity (1_000_000 for DeepSeek V4). */
  contextCapTokens: number;
  /** Cost of the most recent turn/API call — drives the "this turn" footer label. */
  lastTurnCostUsd: number;
};

export type SessionInfo = {
  name: string;
  messageCount: number;
  mtime: string;
  summary?: string;
  workspaceStatus?: "matched" | "legacy_missing_meta";
};

export type Settings = {
  reasoningEffort: "low" | "medium" | "high" | "max";
  editMode: "review" | "auto" | "yolo" | "plan";
  budgetUsd: number | null;
  baseUrl?: string;
  apiKeyPrefix?: string;
  workspaceDir: string;
  recentWorkspaces: string[];
  model: string;
  editor?: string;
  webSearchEngine?:
    | "bing"
    | "bing-intl"
    | "searxng"
    | "metaso"
    | "baidu"
    | "tavily"
    | "perplexity"
    | "exa"
    | "brave"
    | "ollama";
  webSearchApiKeys?: {
    baidu?: string;
  };
  subagentModels?: Record<string, "flash" | "pro">;
  showSystemEvents?: boolean;
  version: string;
};

export type Balance = {
  currency: string;
  total: number;
  isAvailable: boolean;
};

type MentionResults = { nonce: number; query: string; results: string[] };
type MentionPreviewState = {
  nonce: number;
  path: string;
  head: string;
  totalLines: number;
};

type State = {
  ready: boolean;
  needsSetup: boolean;
  busy: boolean;
  model?: string;
  currentSession?: string;
  messages: ChatMessage[];
  pendingConfirms: PendingConfirm[];
  pendingPathAccess: PendingPathAccess[];
  pendingChoices: PendingChoice[];
  pendingPlans: PendingPlan[];
  pendingCheckpoints: PendingCheckpoint[];
  pendingRevisions: PendingRevision[];
  activePlan: ActivePlan | null;
  usage: UsageStats;
  sessions: SessionInfo[];
  settings: Settings | null;
  qq: QQDesktopSettingsState | null;
  balance: Balance | null;
  mentionResults: MentionResults | null;
  mentionPreview: MentionPreviewState | null;
  mcpSpecs: McpSpecInfo[];
  mcpBridged: boolean;
  skills: SkillInfo[];
  /** Files the agent has read or modified this session — paths as the tool args provided them. */
  sessionFiles: SessionFile[];
  memory: MemoryEntryInfo[];
  memoryDetail: MemoryDetail | null;
  jobs: JobInfo[];
  /** Live "skill running" indicator — set when a `skill_run` RPC dispatches, cleared on `$turn_complete`. */
  activeSkill: SkillOrigin | null;
  /** Messages typed while busy=true — auto-sent FIFO once the current turn completes. Cleared on `clear`, `rpc_exit`, `session_loaded`. */
  queuedSends: string[];
  /** Populated by $retry_result — component useEffect reads and sets composer draft. */
  retryText?: string;
  retryNonce: number;
};

export type SessionFile = {
  path: string;
  /** "c": pulled into context (read_file). "m": modified by the agent (edit_file / write_file / multi_edit). */
  status: "c" | "m";
};

type DeltaBatchItem = {
  turn: number;
  channel: "content" | "reasoning";
  text: string;
};

type Action =
  | { t: "send_user"; text: string; clientId: string }
  | { t: "start_skill"; skill: SkillOrigin; args?: string; clientId: string }
  | { t: "incoming"; event: IncomingEvent }
  | { t: "batch_delta"; items: DeltaBatchItem[] }
  | { t: "rpc_exit"; code: number | null }
  | { t: "clear" }
  | { t: "resolve_confirm"; id: number }
  | { t: "resolve_path_access"; id: number }
  | { t: "resolve_choice"; id: number }
  | { t: "resolve_plan"; id: number; verdict: PlanVerdict }
  | { t: "resolve_checkpoint"; id: number; verdict: CheckpointVerdict }
  | { t: "resolve_revision"; id: number; verdict: RevisionVerdict }
  | { t: "dismiss_plan" }
  | { t: "mention_results"; results: MentionResults }
  | { t: "mention_preview"; preview: MentionPreviewState }
  | { t: "enqueue_send"; text: string }
  | { t: "dequeue_send"; index: number }
  | { t: "shift_queued_send" };

function fallbackSkillDesc(skill: SkillInfo): string {
  const scope =
    skill.scope === "builtin"
      ? t("app.skill.scope.builtin")
      : skill.scope === "global"
        ? t("app.skill.scope.global")
        : t("app.skill.scope.project");
  const runAs =
    skill.runAs === "subagent" ? t("app.skill.runAs.subagent") : t("app.skill.runAs.inline");
  return t("app.skill.generic", { scope, runAs });
}

function nextMessageTurn(messages: ChatMessage[]): number {
  const lastTurn = messages.reduce((max, m) => {
    if (m.kind === "user" || m.kind === "assistant") return Math.max(max, m.turn);
    return max;
  }, 0);
  return lastTurn + 1;
}

function reduce(state: State, action: Action): State {
  return withElidedTranscript(reduceRaw(state, action));
}

function reduceRaw(state: State, action: Action): State {
  switch (action.t) {
    case "send_user": {
      return {
        ...state,
        busy: true,
        messages: [
          ...state.messages,
          {
            kind: "user",
            text: action.text,
            clientId: action.clientId,
            turn: nextMessageTurn(state.messages),
          },
        ],
      };
    }
    case "start_skill": {
      const argsLine = action.args ? ` ${action.args}` : "";
      return {
        ...state,
        busy: true,
        activeSkill: action.skill,
        messages: [
          ...state.messages,
          {
            kind: "user",
            text: `/${action.skill.name}${argsLine}`,
            clientId: action.clientId,
            turn: nextMessageTurn(state.messages),
            skill: action.skill,
          },
        ],
      };
    }
    case "rpc_exit":
      return {
        ...state,
        ready: false,
        busy: false,
        activeSkill: null,
        queuedSends: [],
        messages: [
          ...state.messages,
          { kind: "error", message: `reasonix-code exited (code ${action.code ?? "?"})` },
        ],
      };
    case "incoming":
      return applyIncoming(state, action.event);
    case "batch_delta": {
      const collapsed: DeltaBatchItem[] = [];
      for (const item of action.items) {
        const last = collapsed[collapsed.length - 1];
        if (last && last.turn === item.turn && last.channel === item.channel) {
          last.text += item.text;
        } else {
          collapsed.push({ ...item });
        }
      }
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.kind !== "assistant") return m;
          const relevant = collapsed.filter((it) => it.turn === m.turn);
          if (relevant.length === 0) return m;
          let segments = m.segments;
          for (const it of relevant) {
            segments = appendTextSegment(
              segments,
              it.channel === "content" ? "text" : "reasoning",
              it.text,
            );
          }
          return { ...m, segments };
        }),
      };
    }
    case "clear":
      return {
        ...state,
        busy: false,
        currentSession: undefined,
        messages: [],
        pendingConfirms: [],
        pendingPathAccess: [],
        pendingChoices: [],
        pendingPlans: [],
        pendingCheckpoints: [],
        pendingRevisions: [],
        activePlan: null,
        usage: zeroUsage(),
        sessionFiles: [],
        activeSkill: null,
        queuedSends: [],
        retryNonce: 0,
      };
    case "resolve_confirm":
      return {
        ...state,
        pendingConfirms: state.pendingConfirms.filter((c) => c.id !== action.id),
      };
    case "resolve_path_access":
      return {
        ...state,
        pendingPathAccess: state.pendingPathAccess.filter((p) => p.id !== action.id),
      };
    case "resolve_choice":
      return {
        ...state,
        pendingChoices: state.pendingChoices.filter((c) => c.id !== action.id),
      };
    case "resolve_plan": {
      const removed = state.pendingPlans.find((p) => p.id === action.id);
      let activePlan = state.activePlan;
      if (removed && action.verdict.type === "approve") {
        const pendingSteps = (removed as PendingPlan & { steps?: PlanStep[] }).steps;
        activePlan = {
          plan: removed.plan,
          summary: removed.summary,
          steps: pendingSteps ?? [],
          completedStepIds: [],
          stepResults: {},
        };
      }
      return {
        ...state,
        pendingPlans: state.pendingPlans.filter((p) => p.id !== action.id),
        activePlan,
      };
    }
    case "resolve_checkpoint":
      return {
        ...state,
        pendingCheckpoints: state.pendingCheckpoints.filter((c) => c.id !== action.id),
      };
    case "resolve_revision": {
      const removed = state.pendingRevisions.find((r) => r.id === action.id);
      let activePlan = state.activePlan;
      if (removed && action.verdict.type === "accepted" && activePlan) {
        const doneIds = new Set(activePlan.completedStepIds);
        const keptDone = activePlan.steps.filter((s) => doneIds.has(s.id));
        activePlan = {
          ...activePlan,
          steps: [...keptDone, ...removed.remainingSteps],
        };
      }
      return {
        ...state,
        pendingRevisions: state.pendingRevisions.filter((r) => r.id !== action.id),
        activePlan,
      };
    }
    case "dismiss_plan":
      return { ...state, activePlan: null };
    case "mention_results":
      return { ...state, mentionResults: action.results };
    case "mention_preview":
      return { ...state, mentionPreview: action.preview };
    case "enqueue_send":
      return { ...state, queuedSends: [...state.queuedSends, action.text] };
    case "dequeue_send":
      return {
        ...state,
        queuedSends: state.queuedSends.filter((_, i) => i !== action.index),
      };
    case "shift_queued_send":
      return { ...state, queuedSends: state.queuedSends.slice(1) };
  }
}

function withElidedTranscript(state: State): State {
  const messages = elideTranscriptMessages(state.messages);
  return messages === state.messages ? state : { ...state, messages };
}

const READING_TOOLS = new Set(["read_file"]);
const MODIFYING_TOOLS = new Set(["edit_file", "write_file"]);

function extractToolFiles(name: string, args: string): SessionFile[] {
  try {
    const parsed = JSON.parse(args) as { path?: unknown; edits?: unknown };
    if (READING_TOOLS.has(name) && typeof parsed?.path === "string") {
      return [{ path: parsed.path, status: "c" }];
    }
    if (MODIFYING_TOOLS.has(name) && typeof parsed?.path === "string") {
      return [{ path: parsed.path, status: "m" }];
    }
    if (name === "multi_edit" && Array.isArray(parsed?.edits)) {
      const out: SessionFile[] = [];
      const seen = new Set<string>();
      for (const e of parsed.edits as Array<{ path?: unknown }>) {
        if (typeof e?.path === "string" && !seen.has(e.path)) {
          seen.add(e.path);
          out.push({ path: e.path, status: "m" });
        }
      }
      return out;
    }
  } catch {
    // malformed args — skip; tool will error on the real side anyway
  }
  return [];
}

function mergeSessionFiles(existing: SessionFile[], adds: SessionFile[]): SessionFile[] {
  if (adds.length === 0) return existing;
  const next = [...existing];
  const indexByPath = new Map<string, number>();
  next.forEach((f, i) => indexByPath.set(f.path, i));
  let changed = false;
  for (const add of adds) {
    const idx = indexByPath.get(add.path);
    if (idx === undefined) {
      indexByPath.set(add.path, next.length);
      next.push(add);
      changed = true;
      continue;
    }
    const prev = next[idx];
    if (!prev || prev.status === "m") continue; // never downgrade m → c
    if (prev.status === add.status) continue;
    next[idx] = add;
    changed = true;
  }
  return changed ? next : existing;
}

function zeroUsage(): UsageStats {
  return {
    totalCostUsd: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    lastCallCacheHit: null,
    lastCallCacheMiss: null,
    reservedTokens: 0,
    logTokens: 0,
    lastPromptTokens: 0,
    contextCapTokens: 1_000_000,
    lastTurnCostUsd: 0,
  };
}

function appendTextSegment(
  segments: AssistantSegment[],
  kind: "text" | "reasoning",
  text: string,
): AssistantSegment[] {
  const last = segments[segments.length - 1];
  if (last && last.kind === kind) {
    return [...segments.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...segments, { kind, text }];
}

export function applyIncoming(state: State, ev: IncomingEvent): State {
  return withElidedTranscript(applyIncomingRaw(state, ev));
}

function applyIncomingRaw(state: State, ev: IncomingEvent): State {
  switch (ev.type) {
    case "user.message": {
      const last = state.messages[state.messages.length - 1];
      if (state.busy && last?.kind === "user" && last.text === ev.text) {
        return state;
      }
      return {
        ...state,
        busy: true,
        messages: [
          ...state.messages,
          {
            kind: "user",
            text: ev.text,
            clientId: `remote-${ev.id}`,
            turn: ev.turn > 0 ? ev.turn : nextMessageTurn(state.messages),
          },
        ],
      };
    }
    case "$ready":
      return { ...state, ready: true, needsSetup: false };
    case "$needs_setup":
      return { ...state, needsSetup: true, ready: false };
    case "$turn_complete":
      return { ...state, busy: false, activeSkill: null };
    case "$confirm_required":
      return {
        ...state,
        pendingConfirms: [
          ...state.pendingConfirms,
          { id: ev.id, kind: ev.kind, command: ev.command },
        ],
      };
    case "$path_access_required":
      return {
        ...state,
        pendingPathAccess: [
          ...state.pendingPathAccess,
          {
            id: ev.id,
            path: ev.path,
            intent: ev.intent,
            toolName: ev.toolName,
            sandboxRoot: ev.sandboxRoot,
            allowPrefix: ev.allowPrefix,
          },
        ],
      };
    case "$choice_required":
      return {
        ...state,
        pendingChoices: [
          ...state.pendingChoices,
          {
            id: ev.id,
            question: ev.question,
            options: ev.options,
            allowCustom: ev.allowCustom,
          },
        ],
      };
    case "$plan_required": {
      const steps = Array.isArray(ev.steps) ? (ev.steps as PlanStep[]) : undefined;
      return {
        ...state,
        pendingPlans: [
          ...state.pendingPlans,
          { id: ev.id, plan: ev.plan, summary: ev.summary, ...(steps ? { steps } : {}) },
        ],
      };
    }
    case "$checkpoint_required":
      return {
        ...state,
        pendingCheckpoints: [
          ...state.pendingCheckpoints,
          {
            id: ev.id,
            stepId: ev.stepId,
            title: ev.title,
            result: ev.result,
            notes: ev.notes,
            completed: ev.completed,
            total: ev.total,
          },
        ],
      };
    case "$revision_required":
      return {
        ...state,
        pendingRevisions: [
          ...state.pendingRevisions,
          {
            id: ev.id,
            reason: ev.reason,
            remainingSteps: ev.remainingSteps,
            summary: ev.summary,
          },
        ],
      };
    case "$modal_dismissed":
      switch (ev.kind) {
        case "shell":
          return { ...state, pendingConfirms: [] };
        case "path":
          return { ...state, pendingPathAccess: [] };
        case "choice":
          return { ...state, pendingChoices: [] };
        case "plan":
          return { ...state, pendingPlans: [] };
        case "checkpoint":
          return { ...state, pendingCheckpoints: [] };
        case "revision":
          return { ...state, pendingRevisions: [] };
        default:
          return state;
      }
    case "$step_completed": {
      if (!state.activePlan) return state;
      const stepIds = new Set(state.activePlan.completedStepIds);
      stepIds.add(ev.stepId);
      return {
        ...state,
        activePlan: {
          ...state.activePlan,
          completedStepIds: [...stepIds],
          stepResults: { ...state.activePlan.stepResults, [ev.stepId]: ev.result },
        },
      };
    }
    case "$plan_cleared":
      return {
        ...state,
        activePlan: null,
        pendingCheckpoints: [],
        pendingRevisions: [],
      };
    case "$sessions": {
      const hasCurrent = "currentSession" in ev;
      const nextCurrent =
        ev.currentSession === null ? undefined : (ev.currentSession ?? state.currentSession);
      const currentChanged = hasCurrent && nextCurrent !== state.currentSession;
      return {
        ...state,
        sessions: ev.items,
        currentSession: nextCurrent,
        messages: currentChanged ? [] : state.messages,
        pendingConfirms: currentChanged ? [] : state.pendingConfirms,
        pendingPathAccess: currentChanged ? [] : state.pendingPathAccess,
        pendingChoices: currentChanged ? [] : state.pendingChoices,
        pendingPlans: currentChanged ? [] : state.pendingPlans,
        pendingCheckpoints: currentChanged ? [] : state.pendingCheckpoints,
        pendingRevisions: currentChanged ? [] : state.pendingRevisions,
        activePlan: currentChanged ? null : state.activePlan,
        usage: currentChanged ? zeroUsage() : state.usage,
        sessionFiles: currentChanged ? [] : state.sessionFiles,
        queuedSends: currentChanged ? [] : state.queuedSends,
      };
    }
    case "$session_usage": {
      const empty =
        ev.totalCostUsd === 0 &&
        ev.totalPromptTokens === 0 &&
        ev.totalCompletionTokens === 0 &&
        ev.cacheHitTokens === 0 &&
        ev.cacheMissTokens === 0;
      return {
        ...state,
        usage: {
          ...state.usage,
          totalCostUsd: ev.totalCostUsd,
          totalPromptTokens: ev.totalPromptTokens,
          totalCompletionTokens: ev.totalCompletionTokens,
          cacheHitTokens: ev.cacheHitTokens,
          cacheMissTokens: ev.cacheMissTokens,
          lastTurnCostUsd:
            typeof ev.lastTurnCostUsd === "number"
              ? ev.lastTurnCostUsd
              : state.usage.lastTurnCostUsd,
          lastPromptTokens:
            typeof ev.lastPromptTokens === "number"
              ? ev.lastPromptTokens
              : state.usage.lastPromptTokens,
          lastCallCacheHit: empty ? null : state.usage.lastCallCacheHit,
          lastCallCacheMiss: empty ? null : state.usage.lastCallCacheMiss,
        },
      };
    }
    case "$mcp_specs":
      return {
        ...state,
        mcpSpecs: Array.isArray(ev.specs) ? ev.specs : [],
        mcpBridged: Boolean(ev.bridged),
      };
    case "$skills":
      return { ...state, skills: ev.items };
    case "$ctx_breakdown":
      return {
        ...state,
        usage: {
          ...state.usage,
          reservedTokens: ev.reservedTokens,
          logTokens: ev.logTokens ?? state.usage.logTokens,
          contextCapTokens: ev.contextCapTokens ?? state.usage.contextCapTokens,
        },
      };
    case "$memory":
      return {
        ...state,
        memory: ev.entries,
        memoryDetail:
          state.memoryDetail && ev.entries.some((entry) => entry.path === state.memoryDetail?.path)
            ? state.memoryDetail
            : null,
      };
    case "$memory_detail":
      return { ...state, memoryDetail: ev.detail };
    case "$jobs":
      return { ...state, jobs: ev.items };
    case "$balance":
      return {
        ...state,
        balance: {
          currency: ev.currency,
          total: ev.total,
          isAvailable: ev.isAvailable,
        },
      };
    case "$qq_settings":
      return {
        ...state,
        qq: {
          appId: ev.appId,
          appSecret: ev.appSecret,
          sandbox: ev.sandbox,
          enabled: ev.enabled,
          configured: ev.configured,
          runtimeState: ev.runtimeState,
          lastError: ev.lastError,
          appIdPreview: ev.appIdPreview,
          access: ev.access,
        },
      };
    case "$settings": {
      const prevWs = state.settings?.workspaceDir;
      const wsChanged = prevWs !== undefined && prevWs !== ev.workspaceDir;
      return {
        ...state,
        busy: wsChanged ? false : state.busy,
        messages: wsChanged ? [] : state.messages,
        pendingConfirms: wsChanged ? [] : state.pendingConfirms,
        pendingPathAccess: wsChanged ? [] : state.pendingPathAccess,
        pendingChoices: wsChanged ? [] : state.pendingChoices,
        pendingPlans: wsChanged ? [] : state.pendingPlans,
        pendingCheckpoints: wsChanged ? [] : state.pendingCheckpoints,
        pendingRevisions: wsChanged ? [] : state.pendingRevisions,
        activePlan: wsChanged ? null : state.activePlan,
        usage: wsChanged ? zeroUsage() : state.usage,
        sessionFiles: wsChanged ? [] : state.sessionFiles,
        retryNonce: wsChanged ? 0 : state.retryNonce,
        settings: {
          reasoningEffort: ev.reasoningEffort,
          editMode: ev.editMode,
          budgetUsd: ev.budgetUsd,
          baseUrl: ev.baseUrl,
          apiKeyPrefix: ev.apiKeyPrefix,
          workspaceDir: ev.workspaceDir,
          recentWorkspaces: ev.recentWorkspaces,
          model: ev.model,
          editor: ev.editor,
          webSearchEngine: ev.webSearchEngine,
          webSearchApiKeys: ev.webSearchApiKeys,
          subagentModels: ev.subagentModels,
          showSystemEvents: ev.showSystemEvents,
          version: ev.version,
        },
      };
    }
    case "$session_loaded": {
      const sessionName = ev.name;
      const loaded: ChatMessage[] = ev.messages.map((m, i) => {
        if (m.kind === "user") {
          return { kind: "user", text: m.text, clientId: `c-loaded-${i}`, turn: i + 1 };
        }
        const segments: AssistantSegment[] = m.segments.map((s) => {
          if (s.kind === "tool") {
            return {
              kind: "tool",
              callId: s.callId,
              name: s.name,
              args: s.args,
              startedAt: 0,
              result: s.result,
              ok: s.ok,
              durationMs: 0,
            };
          }
          return s;
        });
        return { kind: "assistant", turn: m.turn, segments, pending: false };
      });
      let sessionFiles: SessionFile[] = [];
      for (const m of loaded) {
        if (m.kind !== "assistant") continue;
        for (const s of m.segments) {
          if (s.kind !== "tool") continue;
          // For replayed sessions we don't have tool.result ok-status here, but
          // segments only survive into history if the call completed. Trust it.
          sessionFiles = mergeSessionFiles(sessionFiles, extractToolFiles(s.name, s.args));
        }
      }
      return {
        ...state,
        busy: false,
        currentSession: sessionName,
        messages: loaded,
        pendingConfirms: [],
        pendingPathAccess: [],
        pendingChoices: [],
        pendingPlans: [],
        pendingCheckpoints: [],
        pendingRevisions: [],
        activePlan: null,
        usage: {
          ...zeroUsage(),
          totalCostUsd: ev.carryover.totalCostUsd,
          totalPromptTokens: ev.carryover.cacheHitTokens + ev.carryover.cacheMissTokens,
          cacheHitTokens: ev.carryover.cacheHitTokens,
          cacheMissTokens: ev.carryover.cacheMissTokens,
        },
        sessionFiles,
        activeSkill: null,
        queuedSends: [],
        retryNonce: 0,
      };
    }
    case "$session_empty": {
      // The sidecar successfully ran loadSessionMessages but the jsonl is
      // empty / all-malformed. Without this, the click looks like a no-op
      // because the chat just re-renders empty. Issue #1179.
      const sizeNote = ev.sizeBytes === 0 ? "0 bytes" : `${ev.sizeBytes} bytes, no valid entries`;
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "error",
            message:
              `Session "${ev.name}" loaded with no messages (${sizeNote}). ` +
              `The file ~/.reasonix/sessions/${ev.name}.jsonl exists but couldn't be parsed — ` +
              `start a new chat or restore from .jsonl.bak if you have one.`,
          },
        ],
      };
    }
    case "$error":
    case "error":
      return {
        ...state,
        busy: false,
        activeSkill: null,
        messages: [...state.messages, { kind: "error", message: ev.message }],
      };
    case "model.turn.started":
      if (state.messages.some((m) => m.kind === "assistant" && m.turn === ev.turn)) {
        return { ...state, model: ev.model };
      }
      return {
        ...state,
        model: ev.model,
        messages: [
          ...state.messages,
          { kind: "assistant", turn: ev.turn, segments: [], pending: true },
        ],
      };
    case "model.delta":
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.kind !== "assistant" || m.turn !== ev.turn) return m;
          if (ev.channel === "content") {
            return { ...m, segments: appendTextSegment(m.segments, "text", ev.text) };
          }
          if (ev.channel === "reasoning") {
            return { ...m, segments: appendTextSegment(m.segments, "reasoning", ev.text) };
          }
          return m;
        }),
      };
    case "model.final": {
      const u = ev.usage;
      const callHit = u?.prompt_cache_hit_tokens ?? 0;
      const callMiss = u?.prompt_cache_miss_tokens ?? 0;
      const hasCall = callHit > 0 || callMiss > 0;
      const usage: UsageStats = {
        totalCostUsd: state.usage.totalCostUsd + (ev.costUsd ?? 0),
        totalPromptTokens: state.usage.totalPromptTokens + (u?.prompt_tokens ?? 0),
        totalCompletionTokens: state.usage.totalCompletionTokens + (u?.completion_tokens ?? 0),
        cacheHitTokens: state.usage.cacheHitTokens + callHit,
        cacheMissTokens: state.usage.cacheMissTokens + callMiss,
        lastCallCacheHit: hasCall ? callHit : state.usage.lastCallCacheHit,
        lastCallCacheMiss: hasCall ? callMiss : state.usage.lastCallCacheMiss,
        reservedTokens: state.usage.reservedTokens,
        logTokens: state.usage.logTokens,
        lastPromptTokens: u?.prompt_tokens ?? state.usage.lastPromptTokens,
        contextCapTokens: state.usage.contextCapTokens,
        lastTurnCostUsd: ev.costUsd ?? state.usage.lastTurnCostUsd,
      };
      return {
        ...state,
        usage,
        messages: state.messages.map((m) => {
          if (m.kind !== "assistant" || m.turn !== ev.turn) return m;
          return { ...m, pending: false };
        }),
      };
    }
    case "tool.preparing":
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.kind !== "assistant" || m.turn !== ev.turn) return m;
          if (m.segments.some((s) => s.kind === "tool" && s.callId === ev.callId)) return m;
          return {
            ...m,
            segments: [
              ...m.segments,
              {
                kind: "tool",
                callId: ev.callId,
                name: ev.name,
                args: "",
                startedAt: Date.now(),
              },
            ],
          };
        }),
      };
    case "tool.intent": {
      const adds = extractToolFiles(ev.name, ev.args);
      return {
        ...state,
        sessionFiles: mergeSessionFiles(state.sessionFiles, adds),
        messages: state.messages.map((m) => {
          if (m.kind !== "assistant" || m.turn !== ev.turn) return m;
          const idx = m.segments.findIndex((s) => s.kind === "tool" && s.callId === ev.callId);
          if (idx >= 0) {
            const segs = [...m.segments];
            const seg = segs[idx];
            if (seg?.kind === "tool") {
              segs[idx] = { ...seg, args: ev.args };
            }
            return { ...m, segments: segs };
          }
          return {
            ...m,
            segments: [
              ...m.segments,
              {
                kind: "tool",
                callId: ev.callId,
                name: ev.name,
                args: ev.args,
                startedAt: Date.now(),
              },
            ],
          };
        }),
      };
    }
    case "tool.result":
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.kind !== "assistant") return m;
          let mutated = false;
          const segs = m.segments.map((s) => {
            if (s.kind === "tool" && s.callId === ev.callId) {
              mutated = true;
              return {
                ...s,
                result: ev.output,
                ok: ev.ok,
                durationMs: Date.now() - s.startedAt,
              };
            }
            return s;
          });
          return mutated ? { ...m, segments: segs } : m;
        }),
      };
    case "$retry_result":
      return { ...state, retryText: ev.text, retryNonce: state.retryNonce + 1 };
    case "$btw_result":
      return {
        ...state,
        messages: [...state.messages, { kind: "status", text: `≫ btw\n${ev.answer}` }],
      };
    case "status":
      return state;
    case "warning":
      // High-severity only — eventize already drops "low". Render as a quiet
      // inline divider so users see compaction / abort / rate-limit events
      // without confusing them for errors.
      if (ev.severity !== "high") return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "warning",
            id: `w-${ev.id}`,
            text: ev.text,
            severity: ev.severity,
          },
        ],
      };
    default:
      return state;
  }
}

function formatConversationMarkdown(messages: ChatMessage[], userLabel: string): string {
  return messages
    .map((m) => {
      if (m.kind === "user") return `### ${userLabel}\n\n${m.text}`;
      if (m.kind === "assistant") {
        const body = m.segments
          .map((s) => {
            if (s.kind === "text") return s.text;
            if (s.kind === "reasoning")
              return `<details>\n<summary>${t("app.exportReasoningSummary")}</summary>\n\n${s.text}\n\n</details>`;
            if (s.kind === "tool") {
              const arg = s.args ? `\n\n\`\`\`json\n${s.args}\n\`\`\`` : "";
              const res = s.result ? `\n\n\`\`\`\n${s.result}\n\`\`\`` : "";
              return `> **${t("app.exportToolLabel")} · \`${s.name}\`**${arg}${res}`;
            }
            return "";
          })
          .filter(Boolean)
          .join("\n\n");
        return `### Reasonix\n\n${body}`;
      }
      if (m.kind === "error") return `### Error\n\n${m.message}`;
      return "";
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 200) || "session"
  );
}

function defaultExportFilename(session: string): string {
  const safe = sanitizeFilename(session);
  return `${safe}.md`;
}

type TabAction = Action;
type TabDispatcher = (action: TabAction) => void;

interface TabRuntimeProps {
  tabId: string;
  active: boolean;
  currency: "CNY" | "USD";
  registerDispatch: (tabId: string, d: TabDispatcher | null) => void;
  onNewTab: () => void;
  onCloseTab: () => void;
  canCloseTab: boolean;
  theme: Theme;
  themeStyle: ThemeStyle;
  onSetTheme: (theme: Theme) => void;
  onSetThemeStyle: (style: ThemeStyle) => void;
  onToggleTheme: () => void;
  fontScale: FontScale;
  onSetFontScale: (scale: FontScale) => void;
  fontFamily: FontFamily;
  onSetFontFamily: (family: FontFamily) => void;
  sideCollapsed: boolean;
  ctxCollapsed: boolean;
  onToggleSide: () => void;
  onToggleCtx: () => void;
  onToggleCurrency: () => void;
  tabsList: { id: string; workspaceDir?: string }[];
  activeTabId: string;
  setActiveTabId: (id: string) => void;
  /** 移动端专用：当前侧边栏抽屉是否展开 */
  mobileSideOpen: boolean;
  onToggleMobileSide: () => void;
  workspaceTabs: WorkspaceTab[];
  activeWorkspaceId: string | null;
  onSwitchWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onCloseWorkspace: (id: string) => void;
}


function MainHead({
  session,
  model,
  workspaceDir,
  busy,
  hasMessages,
  onAbort,
  onNewChat,
  onCopy,
  onExport,
  onOpenWorkdir,
}: {
  session: string;
  model?: string;
  workspaceDir?: string;
  busy: boolean;
  hasMessages: boolean;
  onAbort: () => void;
  onNewChat: () => void;
  onCopy: () => void;
  onExport: () => void;
  onOpenWorkdir: (anchor: { top?: number; bottom?: number; left: number }) => void;
}) {
  useLang();
  const wsLabel = workspaceDir
    ? workspaceDir.split(/[\\/]/).pop() || "workspace"
    : t("app.header.noWorkspace");
  return (
    <div className="main-head">
      <div className="title-wrap">
        <h1>
          <span className="editable">{session}</span>
          {busy ? (
            <span className="pill" style={{ color: "var(--accent)" }}>
              <span className="dot" />
              <span className="shimmer">{t("app.header.running")}</span>
            </span>
          ) : null}
        </h1>
        <div className="sub">
          <span
            className="ws-crumb"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onOpenWorkdir({ top: r.bottom + 6, left: r.left });
            }}
            style={{ cursor: "pointer" }}
            title={workspaceDir ?? t("app.header.clickToSelect")}
          >
            <I.folder size={10} /> {wsLabel}
          </span>
          {model ? (
            <span className="pill">
              <I.brain size={10} /> {model}
            </span>
          ) : null}
        </div>
      </div>
      <span className="grow" />
      <button
        type="button"
        className="h-btn"
        onClick={onCopy}
        disabled={!hasMessages}
        title={t("app.header.copyMd")}
      >
        <I.copy size={12} /> {t("app.header.copy")}
      </button>
      <button
        type="button"
        className="h-btn"
        onClick={onExport}
        disabled={!hasMessages}
        title={t("app.header.exportMd")}
      >
        <I.download size={12} /> {t("app.header.export")}
      </button>
      <button type="button" className="h-btn" onClick={onNewChat}>
        <I.plus size={12} /> {t("app.header.newChat")}
      </button>
      {busy ? (
        <button type="button" className="h-btn primary" onClick={onAbort}>
          <I.stop size={12} /> {t("app.header.abort")}
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({
  onPick,
  workspaceDir,
}: {
  onPick: (text: string) => void;
  workspaceDir?: string;
}) {
  useLang();
  const suggestions = [
    t("app.empty.suggestion0"),
    t("app.empty.suggestion1"),
    t("app.empty.suggestion2"),
    t("app.empty.suggestion3"),
    "/help",
  ];
  const wsLabel = workspaceDir ? workspaceDir.split(/[\\/]/).pop() : null;
  return (
    <div
      style={{
        padding: "48px 16px 24px",
        textAlign: "center",
        color: "var(--muted)",
        fontFamily: "var(--font-sans, 'Geist', sans-serif)",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 12,
          margin: "0 auto 14px",
          background: "linear-gradient(135deg, var(--accent), var(--violet))",
          position: "relative",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 8,
            borderRadius: 6,
            background: "var(--bg)",
          }}
        />
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: "var(--fg)", marginBottom: 4 }}>
        {t("app.empty.welcome")}
      </div>
      <div style={{ fontSize: 12, marginBottom: 18 }}>
        {wsLabel ? (
          <>
            {t("app.empty.currentWorkspace")}
            <code style={{ fontFamily: "Geist Mono, monospace" }}>{wsLabel}</code>
          </>
        ) : (
          t("app.empty.selectWorkspace")
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "center",
          maxWidth: 540,
          margin: "0 auto",
        }}
      >
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            className="btn"
            style={{ fontSize: 11.5 }}
            onClick={() => onPick(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function NeedsSetupView({
  workspaceDir,
  onPickWorkspace,
  onSubmit,
}: {
  workspaceDir?: string;
  onPickWorkspace: () => void;
  onSubmit: (key: string) => void;
}) {
  useLang();
  const [key, setKey] = useState("");
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        gap: 18,
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 600 }}>{t("app.setup.welcome")}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", maxWidth: 400, textAlign: "center" }}>
        {t("app.setup.description")}
      </div>
      <div
        style={{
          width: "min(420px, 100%)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div className="setting-row" style={{ borderBottom: "none" }}>
          <div className="l">
            <div className="n">{t("app.setup.workspace")}</div>
            <div className="h">{workspaceDir || t("app.setup.notSelected")}</div>
          </div>
          <button type="button" className="btn" onClick={onPickWorkspace}>
            {t("app.setup.choose")}
          </button>
        </div>
        <input
          className="field mono"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-…"
          style={{ width: "100%" }}
        />
        <button
          type="button"
          className="btn primary"
          disabled={!key.trim()}
          onClick={() => onSubmit(key.trim())}
        >
          {t("app.setup.saveAndStart")}
        </button>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type TabMeta = { id: string; workspaceDir?: string; busy?: boolean };

export function App() {
  const [tabs, setTabs] = useState<TabMeta[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  // Workspace tabs: one per running desktop instance (Tauri only).
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  // Keep the tauri-bridge's activeTabId in sync with the React state so
  // events emitted by the bridge (which used to hard-code "tab-1") route
  // to the right tab's reducer. Without this, every tab's reducer saw
  // tabId="tab-1" and competed for the same pendingEvents / pendingDeltas
  // queue. The bridge is a singleton; the dependency is intentional.
  useEffect(() => {
    if (activeTabId) setActiveTabIdInBridge(activeTabId);
  }, [activeTabId]);
  const dispatchersRef = useRef<Map<string, TabDispatcher>>(new Map());
  const pendingEventsRef = useRef<Map<string, TabAction[]>>(new Map());
  const pendingDeltasRef = useRef<Map<string, DeltaBatchItem[]>>(new Map());
  const rafScheduledRef = useRef(false);
  const tabsRef = useRef<TabMeta[]>([]);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const [themeSettings, themeSetters] = useThemeSettings();
  const currency = themeSettings.currency;
  const setCurrency = themeSetters.setCurrency;
  const theme = themeSettings.theme;
  const setTheme = themeSetters.setTheme;
  const themeStyle = themeSettings.themeStyle;
  const setThemeStyle = themeSetters.setThemeStyle;
  const fontScale = themeSettings.fontScale;
  const setFontScale = themeSetters.setFontScale;
  const fontFamily = themeSettings.fontFamily;
  const setFontFamily = themeSetters.setFontFamily;
  const sideCollapsed = themeSettings.sideCollapsed;
  const setSideCollapsed = themeSetters.setSideCollapsed;
  const ctxCollapsed = themeSettings.ctxCollapsed;
  const setCtxCollapsed = themeSetters.setCtxCollapsed;

  const deliverToTab = useCallback((tabId: string, action: TabAction) => {
    const dispatch = dispatchersRef.current.get(tabId);
    if (dispatch) {
      dispatch(action);
    } else {
      const buf = pendingEventsRef.current.get(tabId) ?? [];
      buf.push(action);
      pendingEventsRef.current.set(tabId, buf);
    }
  }, []);

  const registerDispatch = useCallback((tabId: string, d: TabDispatcher | null) => {
    if (d) {
      dispatchersRef.current.set(tabId, d);
      const buf = pendingEventsRef.current.get(tabId);
      if (buf && buf.length > 0) {
        for (const action of buf) d(action);
        pendingEventsRef.current.delete(tabId);
      }
    } else {
      dispatchersRef.current.delete(tabId);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    const flushDeltas = () => {
      rafScheduledRef.current = false;
      for (const [tabId, items] of pendingDeltasRef.current) {
        if (items.length === 0) continue;
        deliverToTab(tabId, { t: "batch_delta", items });
        pendingDeltasRef.current.set(tabId, []);
      }
    };
    const scheduleFlush = () => {
      if (rafScheduledRef.current || cancelled) return;
      rafScheduledRef.current = true;
      requestAnimationFrame(flushDeltas);
    };
    const flushTabDeltas = (tabId: string) => {
      const bucket = pendingDeltasRef.current.get(tabId);
      if (bucket && bucket.length > 0) {
        deliverToTab(tabId, { t: "batch_delta", items: bucket });
        pendingDeltasRef.current.set(tabId, []);
      }
    };

    const setup = async () => {
      const subs = await Promise.all([
        listen<{ data: string }>("rpc:event", (e) => {
          try {
            const ev = JSON.parse(e.payload.data) as IncomingEvent;
            const tabId = ev.tabId;

            if (ev.type === "$tab_opened" && tabId) {
              setTabs((prev) =>
                prev.some((t) => t.id === tabId)
                  ? prev
                  : [...prev, { id: tabId, workspaceDir: ev.workspaceDir }],
              );
              setActiveTabId((prev) => (ev.active || !prev ? tabId : prev));
              return;
            }
            if (ev.type === "$tab_closed" && tabId) {
              setTabs((prev) => prev.filter((t) => t.id !== tabId));
              setActiveTabId((prev) => {
                if (prev !== tabId) return prev;
                const remaining = tabsRef.current.filter((t) => t.id !== tabId);
                return remaining[0]?.id ?? "";
              });
              dispatchersRef.current.delete(tabId);
              pendingEventsRef.current.delete(tabId);
              pendingDeltasRef.current.delete(tabId);
              return;
            }

            if (ev.type === "model.delta" && tabId) {
              if (ev.channel === "content" || ev.channel === "reasoning") {
                const bucket = pendingDeltasRef.current.get(tabId) ?? [];
                bucket.push({ turn: ev.turn, channel: ev.channel, text: ev.text });
                pendingDeltasRef.current.set(tabId, bucket);
                scheduleFlush();
                return;
              }
            }

            if (ev.type === "$settings" && tabId) {
              setTabs((prev) =>
                prev.map((t) => (t.id === tabId ? { ...t, workspaceDir: ev.workspaceDir } : t)),
              );
            }

            if (ev.type === "$jobs") {
              for (const id of dispatchersRef.current.keys()) {
                deliverToTab(id, { t: "incoming", event: ev });
              }
              return;
            }

            const target = tabId;
            if (target) {
              flushTabDeltas(target);
              if (ev.type === "$mention_results") {
                deliverToTab(target, {
                  t: "mention_results",
                  results: { nonce: ev.nonce, query: ev.query, results: ev.results },
                });
                return;
              }
              if (ev.type === "$mention_preview") {
                deliverToTab(target, {
                  t: "mention_preview",
                  preview: {
                    nonce: ev.nonce,
                    path: ev.path,
                    head: ev.head,
                    totalLines: ev.totalLines,
                  },
                });
                return;
              }
              deliverToTab(target, { t: "incoming", event: ev });
            }
          } catch {
            console.error("bad rpc:event line", e.payload.data);
          }
        }),
        listen<{ data: string }>("rpc:stderr", (e) => {
          console.warn("[reasonix-code stderr]", e.payload.data);
        }),
        listen<{ code: number | null }>("rpc:exit", (e) => {
          for (const tabId of dispatchersRef.current.keys()) flushTabDeltas(tabId);
          for (const dispatch of dispatchersRef.current.values()) {
            dispatch({ t: "rpc_exit", code: e.payload.code });
          }
        }),
      ]);
      if (cancelled) {
        for (const u of subs) u();
        return;
      }
      cleanups.push(...subs);
      try {
        await invoke("rpc_spawn");
      } catch (err) {
        if (!cancelled) console.error("rpc_spawn failed", err);
      }
    };
    void setup();
    return () => {
      cancelled = true;
      for (const c of cleanups) c();
    };
  }, [deliverToTab]);

  // ── Workspace tabs (desktop only) ──────────────────────────────────────────
  // Sync workspaceTabs state from the desktop backend. In web/server mode
  // these invokes throw — we catch and degrade gracefully.
  const refreshWorkspaceTabs = useCallback(async () => {
    if (isWebRuntime) return;
    try {
      const list = await invoke("list_workspaces");
      setWorkspaceTabs(
        (list as { id: number; path: string; ready: boolean }[]).map((ws) => ({
          id: String(ws.id),
          path: ws.path,
          name: ws.path.split(/[\\/]/).pop() || "workspace",
          active: String(ws.id) === activeWorkspaceId,
        })),
      );
    } catch {
      // desktop command unavailable — stay silent
    }
  }, [activeWorkspaceId]);

  const switchWorkspace = useCallback(
    async (id: string) => {
      if (isWebRuntime) return;
      const ws = workspaceTabs.find((t) => t.id === id);
      if (!ws) return;
      setActiveWorkspaceId(id);
      setWorkspaceTabs((prev) => prev.map((t) => ({ ...t, active: t.id === id })));
      try {
        await invoke("switch_workspace", { path: ws.path });
      } catch {
        // best-effort
      }
    },
    [workspaceTabs],
  );

  const pickWorkspace = useCallback(async () => {
    if (isWebRuntime) return;
    try {
      await invoke("pick_workspace");
    } catch {
      // best-effort
    }
  }, []);

  const closeWorkspace = useCallback(
    async (id: string) => {
      if (isWebRuntime) return;
      try {
        await invoke("workspace_close", { id: Number(id) });
        setWorkspaceTabs((prev) => prev.filter((t) => t.id !== id));
        if (activeWorkspaceId === id) {
          setActiveWorkspaceId(null);
        }
      } catch {
        // best-effort
      }
    },
    [activeWorkspaceId],
  );

  // Poll workspace list periodically to stay in sync with the desktop backend.
  useEffect(() => {
    if (isWebRuntime) return;
    void refreshWorkspaceTabs();
    const timer = setInterval(() => {
      void refreshWorkspaceTabs();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshWorkspaceTabs]);

  // Surface CLI crash events from the desktop backend as a toast.
  const [crashToast, setCrashToast] = useState<{ id: string; reason: string } | null>(null);
  useEffect(() => {
    if (isWebRuntime) return;
    let closed = false;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ id: string; reason: string }>("cli:crash", (ev) => {
          if (closed) return;
          setCrashToast({ id: ev.payload.id, reason: ev.payload.reason });
        }),
      )
      .then((unsub) => {
        unlisten = unsub;
      })
      .catch(() => {
        /* Tauri event API unavailable — skip silently */
      });
    return () => {
      closed = true;
      unlisten?.();
    };
  }, []);

  // Tell the backend which tab is focused so a restart can reopen on it (#1244).
  useEffect(() => {
    if (!activeTabId) return;
    invoke("rpc_send", {
      line: JSON.stringify({ cmd: "tab_activate", tabId: activeTabId }),
    }).catch(() => {});
  }, [activeTabId]);

  const openTab = useCallback(() => {
    invoke("rpc_send", { line: JSON.stringify({ cmd: "tab_open" }) }).catch((err) =>
      console.error("tab_open failed", err),
    );
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      if (tabs.length <= 1) return;
      invoke("rpc_send", { line: JSON.stringify({ cmd: "tab_close", tabId: id }) }).catch((err) =>
        console.error("tab_close failed", err),
      );
    },
    [tabs.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        openTab();
      } else if (mod && (e.key === "w" || e.key === "W") && activeTabId && tabs.length > 1) {
        e.preventDefault();
        closeTab(activeTabId);
      } else if (mod && e.key === "Tab") {
        if (tabs.length <= 1) return;
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const next = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
        const target = tabs[next];
        if (target) setActiveTabId(target.id);
      } else if (mod && (e.key === "b" || e.key === "B")) {
        if (e.altKey) {
          e.preventDefault();
          setCtxCollapsed((v) => !v);
        } else {
          e.preventDefault();
          setSideCollapsed((v) => !v);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openTab, closeTab, activeTabId, tabs]);

  const onSetTheme = useCallback((nextTheme: Theme) => {
    setTheme(nextTheme);
    setThemeStyle(defaultStyleForTheme(nextTheme));
  }, []);

  const onSetThemeStyle = useCallback((nextStyle: ThemeStyle) => {
    setThemeStyle(nextStyle);
    setTheme(themeForStyle(nextStyle));
  }, []);

  const onToggleTheme = useCallback(() => {
    onSetTheme(theme === THEME.DARK ? THEME.LIGHT : THEME.DARK);
  }, [onSetTheme, theme]);

  const [mobileSideOpen, setMobileSideOpen] = useState(false);
  const onToggleMobileSide = useCallback(() => setMobileSideOpen((v) => !v), []);

  const onToggleCurrency = useCallback(() => {
    setCurrency((c) => {
      const next = c === "CNY" ? "USD" : "CNY";
      localStorage.setItem("reasonix.currency", next);
      window.dispatchEvent(new CustomEvent("reasonix:currency", { detail: next }));
      return next;
    });
  }, []);

  return (
    <>
      {tabs.map((t) => (
        <TabRuntime
          key={t.id}
          tabId={t.id}
          active={t.id === activeTabId}
          currency={currency}
          registerDispatch={registerDispatch}
          onNewTab={openTab}
          onCloseTab={() => closeTab(t.id)}
          canCloseTab={tabs.length > 1}
          theme={theme}
          themeStyle={themeStyle}
          onSetTheme={onSetTheme}
          onSetThemeStyle={onSetThemeStyle}
          onToggleTheme={onToggleTheme}
          fontScale={fontScale}
          onSetFontScale={setFontScale}
          fontFamily={fontFamily}
          onSetFontFamily={setFontFamily}
          sideCollapsed={sideCollapsed}
          ctxCollapsed={ctxCollapsed}
          onToggleSide={() => setSideCollapsed((v) => !v)}
          onToggleCtx={() => setCtxCollapsed((v) => !v)}
          onToggleCurrency={onToggleCurrency}
          mobileSideOpen={mobileSideOpen}
          onToggleMobileSide={onToggleMobileSide}
          tabsList={tabs}
          activeTabId={activeTabId}
          setActiveTabId={setActiveTabId}
          workspaceTabs={workspaceTabs}
          activeWorkspaceId={activeWorkspaceId}
          onSwitchWorkspace={switchWorkspace}
          onNewWorkspace={pickWorkspace}
          onCloseWorkspace={closeWorkspace}
        />
      ))}
      {crashToast ? (
        <div
          className="crash-toast"
          role="alert"
          onClick={() => setCrashToast(null)}
        >
          <span className="crash-toast-text">{t("crashToast.message")}</span>
          <button
            type="button"
            className="crash-toast-close"
            onClick={() => setCrashToast(null)}
            aria-label={t("crashToast.dismiss")}
          >
            <I.x size={12} />
          </button>
        </div>
      ) : null}
    </>
  );
}

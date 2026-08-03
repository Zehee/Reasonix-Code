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
import { announceEmbedReady, isEmbed, onEmbedMessage, postToParent } from "./lib/embed-bridge";
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
import { EmptyState, MainHead, NeedsSetupView } from "./ui/app-views";
import { Composer, type SlashCmd } from "./ui/composer";
import { ContextPanel } from "./ui/context-panel";
import { JobsPop } from "./ui/jobs-pop";
import { useElapsed } from "./ui/live";
import { SettingsModal, type PageId as SettingsPageId } from "./ui/settings";
import { Shortcut, localizeShortcutText, shortcutText } from "./ui/shortcut";
import { Sidebar } from "./ui/sidebar";
import { Splash, shouldShowSplash } from "./ui/splash";
import { StatusBar } from "./ui/statusbar";
import { TabRuntime, type TabRuntimeProps } from "./ui/tab-runtime";
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
import { TabBar, TitleBar } from "./ui/title-bar";
import { elideTranscriptMessages } from "./ui/transcript-elision";
import { useThemeSettings } from "./ui/use-theme-settings";
import { useAutoScroll } from "./ui/useAutoScroll";
import { useDisableTextAssist } from "./ui/useDisableTextAssist";
import { WorkdirInputModal } from "./ui/workdir-input-modal";
import { WorkdirPop } from "./ui/workdir-pop";
import type { WorkspaceTab } from "./ui/workspace-tabs";

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

export type State = {
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

export type DeltaBatchItem = {
  turn: number;
  channel: "content" | "reasoning";
  text: string;
};

export type Action =
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

type TabAction = Action;
export type TabDispatcher = (action: TabAction) => void;

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
    if (isEmbed && activeTabId) postToParent({ type: "reasonix:tab-activate", id: activeTabId });
  }, [activeTabId]);
  // Embed mode: the container page owns the workspace list (one iframe per
  // workspace) and broadcasts it here, so this dashboard's TabBar renders
  // and activates the container's tabs.
  useEffect(() => {
    if (!isEmbed) return;
    // Pull-style handshake: the container may have broadcast before React
    // mounted (iframe-load races the module graph); ask for a fresh copy.
    announceEmbedReady();
    return onEmbedMessage((msg) => {
      if (msg.type === "reasonix:tabs" && Array.isArray(msg.tabs)) {
        const next: TabMeta[] = msg.tabs.map((t: any) => ({
          id: String(t.id),
          workspaceDir: t.path ?? "",
        }));
        setTabs(next);
        const active = msg.tabs.find((t: any) => t.active);
        setActiveTabId(active ? String(active.id) : (next[0]?.id ?? ""));
      }
    });
  }, []);
  const dispatchersRef = useRef<Map<string, TabDispatcher>>(new Map());
  const pendingEventsRef = useRef<Map<string, TabAction[]>>(new Map());
  const pendingDeltasRef = useRef<Map<string, DeltaBatchItem[]>>(new Map());
  const rafScheduledRef = useRef(false);
  const tabsRef = useRef<TabMeta[]>([]);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const {
    currency,
    setCurrency,
    theme,
    setTheme,
    themeStyle,
    setThemeStyle,
    fontScale,
    setFontScale,
    fontFamily,
    setFontFamily,
    sideCollapsed,
    setSideCollapsed,
    ctxCollapsed,
    setCtxCollapsed,
  } = useThemeSettings();

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
              if (isEmbed) return; // container drives tabs in embed mode
              setTabs((prev) =>
                prev.some((t) => t.id === tabId)
                  ? prev
                  : [...prev, { id: tabId, workspaceDir: ev.workspaceDir }],
              );
              setActiveTabId((prev) => (ev.active || !prev ? tabId : prev));
              return;
            }
            if (ev.type === "$tab_closed" && tabId) {
              if (isEmbed) return; // container drives tabs in embed mode
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
    if (isWebRuntime()) return;
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
      if (isWebRuntime()) return;
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
    if (isWebRuntime()) return;
    try {
      await invoke("pick_workspace");
    } catch {
      // best-effort
    }
  }, []);

  const closeWorkspace = useCallback(
    async (id: string) => {
      if (isWebRuntime()) return;
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
    if (isWebRuntime()) return;
    void refreshWorkspaceTabs();
    const timer = setInterval(() => {
      void refreshWorkspaceTabs();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshWorkspaceTabs]);

  // Surface CLI crash events from the desktop backend as a toast.
  const [crashToast, setCrashToast] = useState<{ id: string; reason: string } | null>(null);
  // Surface CLI spawn/switch errors (main.rs emits cli:error) so a failed
  // workspace switch is visible instead of silent.
  const [cliError, setCliError] = useState<string | null>(null);
  useEffect(() => {
    if (isWebRuntime()) return;
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

  // Surface CLI spawn/switch failures (main.rs emits cli:error) globally.
  useEffect(() => {
    if (isWebRuntime()) return;
    let closed = false;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>("cli:error", (ev) => {
          if (closed) return;
          setCliError(String(ev.payload ?? "Unknown error"));
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
    if (isEmbed) {
      postToParent({ type: "reasonix:tab-new" });
      return;
    }
    invoke("rpc_send", { line: JSON.stringify({ cmd: "tab_open" }) }).catch((err) =>
      console.error("tab_open failed", err),
    );
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      if (tabs.length <= 1) return;
      if (isEmbed) {
        postToParent({ type: "reasonix:tab-close", id });
        return;
      }
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

  const onSetTheme = useCallback(
    (nextTheme: Theme) => {
      setTheme(nextTheme);
      setThemeStyle(defaultStyleForTheme(nextTheme));
    },
    [setTheme, setThemeStyle],
  );

  const onSetThemeStyle = useCallback(
    (nextStyle: ThemeStyle) => {
      setThemeStyle(nextStyle);
      setTheme(themeForStyle(nextStyle));
    },
    [setTheme, setThemeStyle],
  );

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
  }, [setCurrency]);

  return (
    <>
      {tabs.map((t) => (
        <TabRuntime
          key={t.id}
          tabId={t.id}
          active={t.id === activeTabId}
          currency={currency}
          registerDispatch={registerDispatch}
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
          onCloseWorkspace={closeWorkspace}
        />
      ))}
      {crashToast ? (
        <div className="crash-toast" role="alert" onClick={() => setCrashToast(null)}>
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
      {cliError ? (
        <div className="crash-toast" role="alert" onClick={() => setCliError(null)}>
          <span className="crash-toast-text">{cliError}</span>
          <button
            type="button"
            className="crash-toast-close"
            onClick={() => setCliError(null)}
            aria-label={t("crashToast.dismiss")}
          >
            <I.x size={12} />
          </button>
        </div>
      ) : null}
    </>
  );
}

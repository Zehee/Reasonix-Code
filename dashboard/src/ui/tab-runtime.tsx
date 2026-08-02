import { invoke, isWebRuntime } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Settings } from "../App";
import type { SessionInfo, TabDispatcher } from "../App";
import { CommandPalette, Toast, buildCommands, useCommandPalette } from "../CommandPalette";
import { WorkspaceProvider } from "../Markdown";
import { getLang, getLangLabel, getSupportedLangs, setLang, t, useLang } from "../i18n";
import { I } from "../icons";
import { readSessionFromUrl, writeSessionToUrl } from "../lib/session-url";
import { setActiveTabIdInBridge } from "../lib/tauri-bridge";
import type {
  CheckpointVerdict,
  ChoiceVerdict,
  ConfirmationChoice,
  OutgoingCommand,
  PlanVerdict,
  RevisionVerdict,
  SettingsPatch,
} from "../protocol";
import type { QQDesktopSettingsState } from "../qq-settings";
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
} from "../theme";
import { AboutModal } from "./about";
import { EmptyState, MainHead, NeedsSetupView } from "./app-views";
import { Composer, type SlashCmd } from "./composer";
import { ContextPanel } from "./context-panel";
import { JobsPop } from "./jobs-pop";
import { useElapsed } from "./live";
import {
  defaultExportFilename,
  fallbackSkillDesc,
  formatConversationMarkdown,
  reduce,
  zeroUsage,
} from "./session-state";
import { SettingsModal, type PageId as SettingsPageId } from "./settings";
import { Shortcut, localizeShortcutText, shortcutText } from "./shortcut";
import { Sidebar } from "./sidebar";
import { Splash, shouldShowSplash } from "./splash";
import { StatusBar } from "./statusbar";
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
} from "./thread";
import { TabBar, TitleBar } from "./title-bar";
import { elideTranscriptMessages } from "./transcript-elision";
import { useAutoScroll } from "./useAutoScroll";
import { useDisableTextAssist } from "./useDisableTextAssist";
import { WorkdirInputModal } from "./workdir-input-modal";
import { WorkdirPop } from "./workdir-pop";
import type { WorkspaceTab } from "./workspace-tabs";

export interface TabRuntimeProps {
  tabId: string;
  active: boolean;
  currency: "CNY" | "USD";
  registerDispatch: (tabId: string, d: TabDispatcher | null) => void;
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
  onCloseWorkspace: (id: string) => void;
}

/** All "new / switch workspace" entries (title-bar '+', tab-bar '+', the ws-crumb and the statusbar seg) open the same picker. Picking a path in the desktop shell starts/switches the workspace instance; the web build persists the preference. */
export function TabRuntime({
  tabId,
  active,
  currency,
  registerDispatch,
  onCloseTab,
  canCloseTab,
  theme,
  themeStyle,
  onSetTheme,
  onSetThemeStyle,
  onToggleTheme,
  fontScale,
  onSetFontScale,
  fontFamily,
  onSetFontFamily,
  sideCollapsed,
  ctxCollapsed,
  onToggleSide,
  onToggleCtx,
  onToggleCurrency,
  tabsList,
  activeTabId,
  setActiveTabId,
  mobileSideOpen,
  onToggleMobileSide,
  workspaceTabs,
  activeWorkspaceId,
  onSwitchWorkspace,
  onCloseWorkspace,
}: TabRuntimeProps) {
  // All "new / switch workspace" entries (title-bar '+', tab-bar '+', the
  // ws-crumb and the statusbar seg) open the same picker. Picking a path
  // in the desktop shell starts/switches the workspace instance; the web
  // build just persists the preference (see the WorkdirPop onPick below).
  const openWorkspacePicker = useCallback(
    (anchor?: { top?: number; bottom?: number; left: number }) => {
      setWdAnchor(anchor);
      setWdOpen(true);
    },
    [],
  );
  const [state, dispatch] = useReducer(reduce, {
    ready: false,
    needsSetup: false,
    busy: false,
    messages: [],
    pendingConfirms: [],
    pendingPathAccess: [],
    pendingChoices: [],
    pendingPlans: [],
    pendingCheckpoints: [],
    pendingRevisions: [],
    activePlan: null,
    usage: zeroUsage(),
    sessions: [],
    settings: null,
    qq: null,
    balance: null,
    mentionResults: null,
    mentionPreview: null,
    mcpSpecs: [],
    mcpBridged: false,
    skills: [],
    sessionFiles: [],
    memory: [],
    memoryDetail: null,
    jobs: [],
    activeSkill: null,
    queuedSends: [],
    retryNonce: 0,
  });
  useLang();
  useDisableTextAssist();
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState<{ msg: string; yolo?: boolean } | null>(null);
  const [splashOn, setSplashOn] = useState<boolean>(() => shouldShowSplash());
  const [wdOpen, setWdOpen] = useState(false);
  const [wdAnchor, setWdAnchor] = useState<
    { top?: number; bottom?: number; left: number } | undefined
  >(undefined);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const threadInnerRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPageId>("general");
  const [jobsOpen, setJobsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // Pending session swap — set on sidebar click, cleared once the bridge's
  // $session_loaded lands (via the effect below). Big sessions take a beat to
  // pull off disk; without this the click looks dead.
  const [loadingSession, setLoadingSession] = useState<string | null>(null);
  const [workdirModalOpen, setWorkdirModalOpen] = useState(false);
  useEffect(() => {
    if (loadingSession && state.currentSession === loadingSession) {
      setLoadingSession(null);
    }
  }, [loadingSession, state.currentSession]);
  const openSettingsAt = useCallback((page: SettingsPageId = "general") => {
    setSettingsPage(page);
    setSettingsOpen(true);
  }, []);
  const palette = useCommandPalette(active);

  useEffect(() => {
    registerDispatch(tabId, dispatch);
    return () => registerDispatch(tabId, null);
  }, [tabId, registerDispatch]);

  const sendRpc = useCallback(
    (cmd: OutgoingCommand) => {
      const payload = { tabId, ...cmd };
      invoke("rpc_send", { line: JSON.stringify(payload) }).catch((err) =>
        console.error(`${cmd.cmd} failed`, err),
      );
    },
    [tabId],
  );

  const queryMentions = useCallback(
    (query: string, nonce: number) => sendRpc({ cmd: "mention_query", query, nonce }),
    [sendRpc],
  );
  const previewMention = useCallback(
    (path: string, nonce: number) => sendRpc({ cmd: "mention_preview", path, nonce }),
    [sendRpc],
  );
  const markMentionPicked = useCallback(
    (path: string) => sendRpc({ cmd: "mention_picked", path }),
    [sendRpc],
  );
  const saveSettings = useCallback(
    (patch: SettingsPatch) => sendRpc({ cmd: "settings_save", ...patch }),
    [sendRpc],
  );
  const loadQQSettings = useCallback(() => sendRpc({ cmd: "qq_status_get" }), [sendRpc]);
  const connectQQ = useCallback(() => sendRpc({ cmd: "qq_connect" }), [sendRpc]);
  const disconnectQQ = useCallback(() => sendRpc({ cmd: "qq_disconnect" }), [sendRpc]);
  const saveQQConfig = useCallback(
    (patch: { appId?: string; appSecret?: string; sandbox: boolean }) =>
      sendRpc({ cmd: "qq_config_save", ...patch }),
    [sendRpc],
  );
  const saveApiKey = useCallback(
    (key: string) => sendRpc({ cmd: "setup_save_key", key }),
    [sendRpc],
  );
  const addMcpSpec = useCallback(
    (spec: string) => sendRpc({ cmd: "mcp_specs_add", spec }),
    [sendRpc],
  );
  const removeMcpSpec = useCallback(
    (spec: string) => sendRpc({ cmd: "mcp_specs_remove", spec }),
    [sendRpc],
  );
  const newChat = useCallback(() => {
    sendRpc({ cmd: "new_chat" });
    dispatch({ t: "clear" });
  }, [sendRpc]);

  const pickWorkspace = useCallback(async () => {
    // Browsers can't expose absolute filesystem paths (webkitdirectory only
    // hands back relative + File handles), so the web runtime opens a custom
    // server-backed directory browser instead of the native dialog. Desktop
    // (Tauri) still gets the OS picker for free.
    if (isWebRuntime) {
      setWorkdirModalOpen(true);
      return;
    }
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: t("workdir.title"),
        defaultPath: state.settings?.workspaceDir,
      });
      if (typeof picked === "string" && picked.length > 0) {
        // Desktop: switch to (or start) the chosen workspace instance —
        // main.rs spawns a new CLI if it isn't running yet, and the
        // WorkspaceTabs poll picks it up as a new active workspace tab.
        invoke("switch_workspace", { path: picked }).catch((err) =>
          console.error("switch_workspace failed", err),
        );
      }
    } catch (err) {
      console.error("pickWorkspace failed", err);
    }
  }, [state.settings?.workspaceDir]);

  const flashToast = useCallback((msg: string, opts?: { yolo?: boolean; duration?: number }) => {
    setToast({ msg, yolo: opts?.yolo });
    window.setTimeout(() => setToast(null), opts?.duration ?? 1600);
  }, []);

  // Drag-and-drop: dropping files/folders onto the window inserts them
  // as @-mentions in the draft (relative to workspaceDir when inside it).
  // activeRef gates the handler — without it, a single drop hits every
  // mounted tab's draft (issue #1027, exposed once #1063 restored tabs).
  const dropActiveRef = useRef(active);
  useEffect(() => {
    dropActiveRef.current = active;
  }, [active]);
  useEffect(() => {
    const ws = state.settings?.workspaceDir;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import("@tauri-apps/api/webview");
        const webview = mod.getCurrentWebview();
        const handle = await webview.onDragDropEvent((event: any) => {
          if (!dropActiveRef.current) return;
          if (event.payload.type === "enter") {
            document.body.style.setProperty("--drop-overlay-label", `"${t("dragDrop.overlay")}"`);
            document.body.dataset.dragOver = "1";
            return;
          }
          if (event.payload.type === "leave") {
            delete document.body.dataset.dragOver;
            return;
          }
          if (event.payload.type !== "drop") return;
          delete document.body.dataset.dragOver;
          const paths = event.payload.paths ?? [];
          if (paths.length === 0) return;
          const mentions = paths.map((p: string) => {
            const norm = p.replace(/\\/g, "/");
            if (ws) {
              const wsNorm = ws.replace(/\\/g, "/").replace(/\/+$/, "");
              if (norm === wsNorm || norm.startsWith(`${wsNorm}/`)) {
                return norm.slice(wsNorm.length).replace(/^\/+/, "") || ".";
              }
            }
            return norm;
          });
          setDraft((d) => {
            const prefix = d.trim() ? `${d.replace(/\s+$/, "")} ` : "";
            return `${prefix}${mentions.map((m: string) => `@${m}`).join(" ")} `;
          });
          for (const m of mentions) markMentionPicked(m as string);
          composerRef.current?.focus();
        });
        if (cancelled) handle();
        else unlisten = handle;
      } catch (err) {
        console.error("drag-drop listen failed", err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      delete document.body.dataset.dragOver;
    };
  }, [state.settings?.workspaceDir, markMentionPicked]);

  const send = useCallback(
    (override?: string) => {
      const text = (override ?? draft).trim();
      if (!text || !state.ready || state.busy) return;

      // /btw <question> — route to side-question RPC instead of user_input
      const btwMatch = /^\/btw(?:\s+([\s\S]+))?$/.exec(text);
      if (btwMatch) {
        const question = btwMatch[1]?.trim() ?? "";
        if (!question) return;
        sendRpc({ cmd: "btw", text: question });
        if (!override) setDraft("");
        return;
      }

      const skillMatch = text.match(/^\/([a-zA-Z0-9_-]+)(\s+.*)?$/);
      if (skillMatch) {
        const [, name, args] = skillMatch;
        const skill = state.skills.find((s) => s.name === name);
        if (skill) {
          const clientId = `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const trimmedArgs = args?.trim() ?? "";
          dispatch({
            t: "start_skill",
            skill: { name: skill.name, runAs: skill.runAs },
            args: trimmedArgs,
            clientId,
          });
          sendRpc({ cmd: "skill_run", name: skill.name, args: trimmedArgs || undefined });
          if (!override) setDraft("");
          return;
        }
      }
      const clientId = `c-${Date.now()}`;
      dispatch({ t: "send_user", text, clientId });
      sendRpc({ cmd: "user_input", text });
      if (!override) setDraft("");
    },
    [draft, state.ready, state.busy, state.skills, sendRpc],
  );

  const abort = useCallback(() => sendRpc({ cmd: "abort" }), [sendRpc]);

  // When /retry returns the last user text, set it as the composer draft
  useEffect(() => {
    if (state.retryNonce > 0 && state.retryText) {
      setDraft(state.retryText);
      composerRef.current?.focus();
    }
    // Only fire when retryNonce changes — retryText alone would re-fire on re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.retryNonce]);

  useEffect(() => {
    if (state.busy || !state.ready || state.queuedSends.length === 0) return;
    const next = state.queuedSends[0];
    if (!next) return;
    dispatch({ t: "shift_queued_send" });
    send(next);
  }, [state.busy, state.ready, state.queuedSends, send]);

  const resolveConfirm = useCallback(
    (id: number, response: ConfirmationChoice) => {
      sendRpc({ cmd: "confirm_response", id, response, kind: "shell" });
      dispatch({ t: "resolve_confirm", id });
    },
    [sendRpc],
  );
  const onApproveConfirm = useCallback(
    (id: number) => resolveConfirm(id, { type: "run_once" }),
    [resolveConfirm],
  );
  const onRejectConfirm = useCallback(
    (id: number) => resolveConfirm(id, { type: "deny" }),
    [resolveConfirm],
  );
  const onAlwaysAllowConfirm = useCallback(
    (id: number, prefix: string) => resolveConfirm(id, { type: "always_allow", prefix }),
    [resolveConfirm],
  );
  const resolvePathAccess = useCallback(
    (id: number, response: ConfirmationChoice) => {
      sendRpc({ cmd: "confirm_response", id, response, kind: "path" });
      dispatch({ t: "resolve_path_access", id });
    },
    [sendRpc],
  );
  const resolveChoice = useCallback(
    (id: number, response: ChoiceVerdict) => {
      sendRpc({ cmd: "choice_response", id, response });
      dispatch({ t: "resolve_choice", id });
    },
    [sendRpc],
  );
  const resolvePlan = useCallback(
    (id: number, response: PlanVerdict) => {
      sendRpc({ cmd: "plan_response", id, response });
      dispatch({ t: "resolve_plan", id, verdict: response });
    },
    [sendRpc],
  );
  const resolveCheckpoint = useCallback(
    (id: number, response: CheckpointVerdict) => {
      sendRpc({ cmd: "checkpoint_response", id, response });
      dispatch({ t: "resolve_checkpoint", id, verdict: response });
    },
    [sendRpc],
  );
  const resolveRevision = useCallback(
    (id: number, response: RevisionVerdict) => {
      sendRpc({ cmd: "revision_response", id, response });
      dispatch({ t: "resolve_revision", id, verdict: response });
    },
    [sendRpc],
  );

  // Read the latest session inside the stable restore callback below.
  const currentSessionRef = useRef(state.currentSession);
  currentSessionRef.current = state.currentSession;
  const restoreScrollTop = useCallback(() => {
    const session = currentSessionRef.current;
    if (!session) return null;
    const raw = localStorage.getItem(`reasonix.scroll.${session}`);
    const n = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(n) ? n : null;
  }, []);

  const { showJumpButton, scrollToBottom } = useAutoScroll(
    threadRef,
    threadInnerRef,
    state.busy,
    restoreScrollTop,
  );

  // Persist the transcript scroll offset per session so a restart reopens
  // the conversation where the user left it (#1244).
  useEffect(() => {
    const el = threadRef.current;
    const session = state.currentSession;
    if (!el || !session) return;
    const key = `reasonix.scroll.${session}`;
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
        if (atBottom) localStorage.removeItem(key);
        else localStorage.setItem(key, String(Math.round(el.scrollTop)));
      }, 250);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, [state.currentSession]);

  useEffect(() => {
    if (!active) return;
    if (!jobsOpen) return;
    sendRpc({ cmd: "jobs_list" });
    const id = window.setInterval(() => sendRpc({ cmd: "jobs_list" }), 1500);
    return () => window.clearInterval(id);
  }, [active, jobsOpen, sendRpc]);

  useEffect(() => {
    if (!active) return;
    if (state.busy) return;
    sendRpc({ cmd: "jobs_list" });
  }, [active, state.busy, sendRpc]);

  useEffect(() => {
    if (!active) return;
    loadQQSettings();
  }, [active, loadQQSettings]);

  const initialUrlSession = useRef<string | null>(readSessionFromUrl());
  const urlSessionDispatched = useRef(false);
  useEffect(() => {
    if (!active) return;
    if (urlSessionDispatched.current) return;
    if (!state.ready) return;
    if (state.sessions.length === 0) return;
    urlSessionDispatched.current = true;
    const target = initialUrlSession.current;
    if (!target) return;
    // Always attempt to load — state.messages starts empty on initial connect
    // even when the URL session matches the overview currentSession. Without
    // this the conversation panel shows nothing.
    if (!state.sessions.some((s) => s.name === target)) {
      writeSessionToUrl(null);
      return;
    }
    sendRpc({ cmd: "session_load", name: target });
  }, [active, state.ready, state.sessions, state.currentSession, sendRpc]);

  useEffect(() => {
    // Every TabRuntime stays mounted (display:none on inactive), so each registers its own keydown — without this gate Cmd+N would fire newChat() in every tab and wipe the inactive ones' sessions.
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "a" || e.key === "A")) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") e.preventDefault();
        return;
      }
      if (mod && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        composerRef.current?.focus();
      } else if (mod && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        newChat();
      } else if (mod && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        setWdAnchor(undefined);
        setWdOpen((v) => !v);
      } else if (mod && e.key === ",") {
        e.preventDefault();
        if (settingsOpen) setSettingsOpen(false);
        else openSettingsAt("general");
      } else if (mod && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        setJobsOpen((v) => !v);
      } else if (e.key === "Escape" && state.busy) {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
        e.preventDefault();
        abort();
      } else if (e.key === "Enter" && !mod && !e.shiftKey && !e.altKey) {
        // Defer to any control that already handles Enter — native inputs/buttons,
        // ARIA button/link widgets (sidebar rows, file pills), or anything that called
        // preventDefault — so we only grant when focus is on inert layout (#2015).
        if (e.defaultPrevented) return;
        const target = e.target as HTMLElement | null;
        if (
          target?.isContentEditable ||
          target?.closest('input, textarea, button, select, a, [role="button"], [role="link"]')
        ) {
          return;
        }
        if (settingsOpen || jobsOpen || wdOpen) return;
        // Enter grants the pending authorization prompt (run once), matching the
        // TUI where Enter confirms the highlighted choice (#1962).
        const confirm = state.pendingConfirms.at(-1);
        if (confirm) {
          e.preventDefault();
          resolveConfirm(confirm.id, { type: "run_once" });
          return;
        }
        const pathAccess = state.pendingPathAccess.at(-1);
        if (pathAccess) {
          e.preventDefault();
          resolvePathAccess(pathAccess.id, { type: "run_once" });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    active,
    state.busy,
    state.pendingConfirms,
    state.pendingPathAccess,
    resolveConfirm,
    resolvePathAccess,
    settingsOpen,
    jobsOpen,
    wdOpen,
    abort,
    newChat,
    openSettingsAt,
  ]);

  const commands = buildCommands({
    newChat: () => {
      newChat();
      flashToast(t("app.toast.newSession"));
    },
    clearChat: () => {
      dispatch({ t: "clear" });
      flashToast(t("app.toast.cleared"));
    },
    focusComposer: () => composerRef.current?.focus(),
    openSettings: () => openSettingsAt("general"),
    about: () => setAboutOpen(true),
    abort,
    copyLast: () => {
      const last = [...state.messages].reverse().find((m) => m.kind === "assistant");
      if (!last || last.kind !== "assistant") return;
      const text = last.segments
        .filter((s): s is { kind: "text"; text: string } => s.kind === "text")
        .map((s) => s.text)
        .join("\n\n")
        .trim();
      if (text) {
        void navigator.clipboard.writeText(text);
        flashToast(t("app.toast.copied"));
      }
    },
    conversationCopy: () => {
      conversationCopy();
    },
    exportMarkdown: () => {
      exportConversation();
    },
    pickWorkspace,
    newTab: openWorkspacePicker,
    closeTab: onCloseTab,
    busy: state.busy,
    canCloseTab,
    hasMessages: state.messages.length > 0,
  });

  const slashCommands: SlashCmd[] = [
    {
      cmd: "/help",
      desc: t("app.cmd.help"),
      run: () => {
        setDraft("/");
        composerRef.current?.focus();
      },
    },
    {
      cmd: "/new",
      desc: t("app.cmd.newSession"),
      run: () => newChat(),
      kb: shortcutText(["mod", "N"]),
    },
    { cmd: "/clear", desc: t("app.cmd.clearChat"), run: () => dispatch({ t: "clear" }) },
    { cmd: "/abort", desc: t("app.cmd.abort"), run: () => abort(), kb: "esc" },
    {
      cmd: "/copy",
      desc: t("app.cmd.copyLast"),
      run: () => {
        const last = [...state.messages].reverse().find((m) => m.kind === "assistant");
        if (last?.kind === "assistant") {
          const text = last.segments
            .filter((s): s is { kind: "text"; text: string } => s.kind === "text")
            .map((s) => s.text)
            .join("\n\n");
          if (text) {
            void navigator.clipboard.writeText(text);
            flashToast(t("app.toast.copied"));
          }
        }
      },
    },
    { cmd: "/model", desc: t("app.cmd.switchModel"), run: () => openSettingsAt("models") },
    { cmd: "/theme", desc: t("app.cmd.toggleTheme"), run: onToggleTheme },
    {
      cmd: "/currency",
      desc: t("app.cmd.toggleCurrency"),
      run: onToggleCurrency,
    },
    {
      cmd: "/lang",
      desc: t("app.cmd.toggleLang"),
      run: () => {
        const langs = getSupportedLangs();
        const next = langs[(langs.indexOf(getLang()) + 1) % langs.length] ?? "en";
        setLang(next);
        const langName = getLangLabel(next);
        flashToast(t("app.toast.langSwitched", { lang: langName }));
      },
    },
    {
      cmd: "/export",
      desc: t("app.cmd.exportMd"),
      run: () => exportConversation(),
    },
    {
      cmd: "/feedback",
      desc: t("app.cmd.feedback"),
      run: () => {
        void openUrl("https://github.com/esengine/DeepSeek-Reasonix/issues/new/choose").catch(
          () => undefined,
        );
      },
    },
    {
      cmd: "/compact",
      desc: t("app.cmd.compact"),
      run: () => sendRpc({ cmd: "compact_history" }),
    },
    {
      cmd: "/retry",
      desc: t("app.cmd.retry"),
      run: () => sendRpc({ cmd: "retry" }),
    },
    {
      cmd: "/btw",
      desc: t("app.cmd.btw"),
      run: () => {
        // Sets the draft to /btw so the user can type their question.
        // The send() handler detects the /btw prefix and routes to the btw RPC.
        setDraft("/btw ");
        composerRef.current?.focus();
      },
    },
    ...state.skills.map((s) => ({
      cmd: `/${s.name}`,
      desc: s.description?.trim() || fallbackSkillDesc(s),
      insertOnly: true,
      run: () => {
        dispatch({
          t: "start_skill",
          skill: { name: s.name, runAs: s.runAs },
          clientId: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        });
        sendRpc({ cmd: "skill_run", name: s.name });
      },
    })),
  ];

  const elapsed = useElapsed(state.busy);
  const workspaceLabel = state.settings?.workspaceDir
    ? state.settings.workspaceDir.split(/[\\/]/).pop() || "workspace"
    : "Reasonix";
  const session = (() => {
    const firstUser = state.messages.find((m) => m.kind === "user");
    if (firstUser && firstUser.kind === "user") {
      const cleaned = firstUser.text.replace(/\s+/g, " ").trim();
      if (cleaned) return cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned;
    }
    if (state.currentSession) {
      const s = state.sessions.find((x) => x.name === state.currentSession);
      if (s?.summary?.trim()) return s.summary.trim();
      const m = state.currentSession.match(/^desktop-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
      if (m)
        return t("app.session.format", {
          month: m[2],
          day: m[3],
          hour: m[4],
          minute: m[5],
        });
    }
    return state.messages.length === 0
      ? t("app.session.new", { workspace: workspaceLabel })
      : workspaceLabel;
  })();

  const exportConversation = useCallback(async () => {
    const userLabel = t("app.exportUserLabel");
    const md = formatConversationMarkdown(state.messages, userLabel);
    if (!md) {
      flashToast(t("app.toast.emptySession"));
      return;
    }
    try {
      const filename = defaultExportFilename(session);
      const path = await saveDialog({
        defaultPath: filename,
        filters: [{ name: "Markdown", extensions: ["md"] }],
        title: t("app.toast.exportDialogTitle"),
      });
      if (!path) return;
      await invoke("write_text_file", { path, content: md });
      flashToast(t("app.toast.exportedMd"));
    } catch (err) {
      console.error("export failed", err);
      flashToast(t("app.toast.exportFailed", { error: String(err) }));
    }
  }, [state.messages, session, flashToast]);

  const conversationCopy = useCallback(() => {
    const userLabel = t("app.exportUserLabel");
    const md = formatConversationMarkdown(state.messages, userLabel);
    if (!md) {
      flashToast(t("app.toast.emptySession"));
      return;
    }
    void navigator.clipboard.writeText(md);
    flashToast(t("app.toast.copiedMd"));
  }, [state.messages, flashToast]);

  return (
    <WorkspaceProvider
      value={{ dir: state.settings?.workspaceDir, editor: state.settings?.editor }}
    >
      <div
        className="app"
        data-theme={theme}
        data-theme-style={themeStyle}
        data-side-collapsed={sideCollapsed}
        data-ctx-collapsed={ctxCollapsed}
        data-mobile-side-open={mobileSideOpen}
        style={{ display: active ? undefined : "none" }}
      >
        {/* 移动端遮罩层：点击关闭侧边栏抽屉 */}
        <div className="mobile-overlay" aria-hidden="true" onClick={onToggleMobileSide} />

        <TitleBar
          session={session}
          model={state.settings?.model}
          sideOn={!sideCollapsed}
          ctxOn={!ctxCollapsed}
          onToggleSide={onToggleSide}
          onToggleCtx={onToggleCtx}
          onOpenCommands={() => palette.setOpen(true)}
          onOpenSettings={() => openSettingsAt("general")}
          onCopy={conversationCopy}
          onExport={exportConversation}
          onClear={() => dispatch({ t: "clear" })}
          hasMessages={state.messages.length > 0}
          mobileSideOpen={mobileSideOpen}
          onToggleMobileSide={onToggleMobileSide}
          workspaceTabs={workspaceTabs}
          activeWorkspaceId={activeWorkspaceId}
          onSwitchWorkspace={onSwitchWorkspace}
          onNewWorkspace={openWorkspacePicker}
          onCloseWorkspace={onCloseWorkspace}
        />

        <TabBar
          tabs={tabsList}
          activeId={activeTabId}
          setActive={setActiveTabId}
          onClose={(id) => {
            if (tabsList.length <= 1) return;
            invoke("rpc_send", {
              line: JSON.stringify({ cmd: "tab_close", tabId: id }),
            }).catch((err) => console.error("tab_close failed", err));
          }}
          onNew={openWorkspacePicker}
          singleTab={tabsList.length <= 1}
        />

        <Sidebar
          sessions={state.sessions}
          activeName={state.currentSession}
          loadingName={loadingSession}
          onNewChat={() => {
            newChat();
            onToggleMobileSide && mobileSideOpen && onToggleMobileSide();
          }}
          onLoadSession={(name) => {
            if (name === state.currentSession || name === loadingSession) return;
            setLoadingSession(name);
            sendRpc({ cmd: "session_load", name });
            // 移动端选择会话后自动收起抽屉
            if (mobileSideOpen) onToggleMobileSide();
          }}
          onDeleteSession={(name) => sendRpc({ cmd: "session_delete", name })}
          onOpenSettings={() => {
            openSettingsAt("general");
            if (mobileSideOpen) onToggleMobileSide();
          }}
          onOpenRules={() => {
            openSettingsAt("rules");
            if (mobileSideOpen) onToggleMobileSide();
          }}
          onOpenCommands={() => {
            palette.setOpen(true);
            if (mobileSideOpen) onToggleMobileSide();
          }}
          onOpenAbout={() => {
            setAboutOpen(true);
            if (mobileSideOpen) onToggleMobileSide();
          }}
        />

        <main className="main" style={{ position: "relative" }}>
          {state.needsSetup ? (
            <NeedsSetupView
              workspaceDir={state.settings?.workspaceDir}
              onPickWorkspace={pickWorkspace}
              onSubmit={(key) => sendRpc({ cmd: "setup_save_key", key })}
            />
          ) : (
            <>
              <MainHead
                session={session}
                model={state.settings?.model}
                workspaceDir={state.settings?.workspaceDir}
                busy={state.busy}
                hasMessages={state.messages.length > 0}
                onAbort={abort}
                onNewChat={newChat}
                onCopy={conversationCopy}
                onExport={exportConversation}
                onOpenWorkdir={openWorkspacePicker}
              />
              <div className="thread" ref={threadRef} style={{ position: "relative" }}>
                {loadingSession ? (
                  <div className="thread-loading-overlay">
                    {t("sidebarPanel.loading")} {loadingSession}
                  </div>
                ) : null}
                <div className="thread-inner" ref={threadInnerRef}>
                  {state.activePlan ? (
                    <>
                      <PlanBanner
                        plan={state.activePlan}
                        onDismiss={state.busy ? undefined : () => dispatch({ t: "dismiss_plan" })}
                      />
                      <ActivePlanTaskCard plan={state.activePlan} />
                    </>
                  ) : null}

                  {state.messages.length === 0 ? (
                    <EmptyState
                      onPick={(text) => {
                        const trimmed = text.trim();
                        if (trimmed.startsWith("/")) {
                          const cmd = trimmed.split(/\s+/)[0] ?? "";
                          const match = slashCommands.find((s) => s.cmd === cmd);
                          if (match) {
                            match.run();
                            return;
                          }
                        }
                        send(text);
                      }}
                      workspaceDir={state.settings?.workspaceDir}
                    />
                  ) : null}

                  {state.messages.map((m, i) => {
                    if (m.kind === "user") {
                      const dividerLabel = `turn ${m.turn}`;
                      const prev = state.messages[i - 1];
                      const needsDivider = !prev || prev.kind === "user";
                      return (
                        <div key={`u-${i}`}>
                          {needsDivider ? <TurnDivider label={dividerLabel} /> : null}
                          <UserMsg text={m.text} skill={m.skill} />
                        </div>
                      );
                    }
                    if (m.kind === "assistant") {
                      return (
                        <AssistantMsg
                          // Index, not turn — replayed transcripts arrive with turn=0
                          // for every assistant row (the server doesn't reconstruct
                          // turn numbers from JSONL), so a turn-keyed list collapsed
                          // every assistant into one slot and switching sessions left
                          // the same stale row visible.
                          key={`a-${i}`}
                          segments={m.segments}
                          pending={m.pending}
                          model={state.model}
                          onApproveConfirm={onApproveConfirm}
                          onRejectConfirm={onRejectConfirm}
                          onAlwaysAllowConfirm={onAlwaysAllowConfirm}
                          pendingConfirms={state.pendingConfirms}
                        />
                      );
                    }
                    if (m.kind === "error") {
                      return (
                        <div
                          key={`e-${i}`}
                          className="warn-card"
                          style={{
                            borderColor: "var(--tone-err)",
                            background: "var(--danger-soft)",
                          }}
                        >
                          <span className="ico" style={{ color: "var(--tone-err)" }}>
                            <I.warning size={16} />
                          </span>
                          <div>
                            <div className="tt">{t("app.errorLabel")}</div>
                            <div className="ds">{m.message}</div>
                          </div>
                        </div>
                      );
                    }
                    if (m.kind === "warning") {
                      if (state.settings?.showSystemEvents === false) return null;
                      return (
                        <div key={m.id} className="sys-event-row" title={m.text}>
                          <span className="line" />
                          <span className="label">{m.text}</span>
                          <span className="line" />
                        </div>
                      );
                    }
                    return null;
                  })}

                  {/* Pending approvals */}
                  {state.pendingPlans.map((p) => (
                    <PlanApprovalCard
                      key={`pp-${p.id}`}
                      p={p}
                      onApprove={() => resolvePlan(p.id, { type: "approve" })}
                      onRefine={() => resolvePlan(p.id, { type: "refine" })}
                      onCancel={() => resolvePlan(p.id, { type: "cancel" })}
                    />
                  ))}
                  {state.pendingCheckpoints.map((c) => (
                    <CheckpointApprovalCard
                      key={`cp-${c.id}`}
                      c={c}
                      onContinue={() => resolveCheckpoint(c.id, { type: "continue" })}
                      onRevise={() => resolveCheckpoint(c.id, { type: "revise" })}
                      onStop={() => resolveCheckpoint(c.id, { type: "stop" })}
                    />
                  ))}
                  {state.pendingRevisions.map((r) => (
                    <RevisionApprovalCard
                      key={`rv-${r.id}`}
                      r={r}
                      onAccept={() => resolveRevision(r.id, { type: "accepted" })}
                      onReject={() => resolveRevision(r.id, { type: "rejected" })}
                    />
                  ))}
                  {state.pendingConfirms.map((c) => (
                    <ConfirmApprovalCard
                      key={`cc-${c.id}`}
                      c={c}
                      onAllow={() => resolveConfirm(c.id, { type: "run_once" })}
                      onAlwaysAllow={(prefix) =>
                        resolveConfirm(c.id, { type: "always_allow", prefix })
                      }
                      onDeny={() => resolveConfirm(c.id, { type: "deny" })}
                    />
                  ))}
                  {state.pendingPathAccess.map((p) => (
                    <PathAccessApprovalCard
                      key={`pa-${p.id}`}
                      p={p}
                      onAllow={() => resolvePathAccess(p.id, { type: "run_once" })}
                      onAlwaysAllow={(prefix) =>
                        resolvePathAccess(p.id, { type: "always_allow", prefix })
                      }
                      onDeny={() => resolvePathAccess(p.id, { type: "deny" })}
                    />
                  ))}
                  {state.pendingChoices.map((c) => (
                    <ChoiceApprovalCard
                      key={`ch-${c.id}`}
                      c={c}
                      onPick={(optionId) => resolveChoice(c.id, { type: "pick", optionId })}
                      onCancel={() => resolveChoice(c.id, { type: "cancel" })}
                    />
                  ))}

                  {!state.ready ? (
                    <div
                      style={{
                        padding: 12,
                        color: "var(--muted)",
                        fontFamily: "Geist Mono, monospace",
                        fontSize: 11,
                      }}
                    >
                      {t("app.connecting")}
                    </div>
                  ) : null}
                </div>
                {showJumpButton ? (
                  <button
                    className="thread-jump-bottom"
                    onClick={() => scrollToBottom(true)}
                    title={t("app.jumpToBottom") ?? "Jump to bottom"}
                    aria-label={t("app.jumpToBottom") ?? "Jump to bottom"}
                  >
                    <I.chev size={16} />
                  </button>
                ) : null}
              </div>

              <Composer
                draft={draft}
                setDraft={setDraft}
                onSend={() => send()}
                onAbort={abort}
                disabled={!state.ready}
                busy={state.busy}
                busyLabel={
                  state.busy
                    ? state.activeSkill
                      ? `Skill · ${state.activeSkill.name}`
                      : "Reasoning"
                    : undefined
                }
                busyElapsedMs={elapsed}
                textareaRef={composerRef}
                modelLabel={state.settings?.model ?? "deepseek-v4-flash"}
                reasoningEffort={state.settings?.reasoningEffort ?? "high"}
                onModelChange={(model) => {
                  saveSettings({ model });
                  flashToast(t("app.toast.modelSwitched", { model }));
                }}
                onEffortChange={(reasoningEffort) => {
                  saveSettings({ reasoningEffort });
                  flashToast(t("app.toast.effortSwitched", { effort: reasoningEffort }));
                }}
                editMode={state.settings?.editMode ?? "review"}
                onEditModeChange={(mode) => {
                  saveSettings({ editMode: mode });
                  if (mode === "yolo") {
                    flashToast(t("app.yolo.toast"), { yolo: true, duration: 3000 });
                  } else {
                    flashToast(t("app.toast.modeSwitched", { mode: mode.toUpperCase() }));
                  }
                }}
                workspaceDir={state.settings?.workspaceDir}
                slashCommands={slashCommands}
                onMentionQuery={queryMentions}
                onMentionPreview={previewMention}
                onMentionPicked={markMentionPicked}
                mentionResults={state.mentionResults}
                queuedSends={state.queuedSends}
                onQueueWhileBusy={(text) => {
                  dispatch({ t: "enqueue_send", text });
                  setDraft("");
                }}
                onDequeueSend={(index) => dispatch({ t: "dequeue_send", index })}
              />
            </>
          )}
        </main>

        <ContextPanel
          settings={state.settings}
          usage={state.usage}
          mcpSpecs={state.mcpSpecs}
          mcpBridged={state.mcpBridged}
          sessionFiles={state.sessionFiles}
          memory={state.memory}
          memoryDetail={state.memoryDetail}
          onReadMemory={(path) => sendRpc({ cmd: "memory_read", path })}
        />

        <StatusBar
          settings={state.settings}
          balance={state.balance}
          usage={state.usage}
          busy={state.busy}
          ready={state.ready}
          currency={currency}
          theme={theme}
          themeStyle={themeStyle}
          jobs={state.jobs}
          jobsOpen={jobsOpen}
          onToggleJobs={() => setJobsOpen((v) => !v)}
          onSetThemeStyle={onSetThemeStyle}
          onToggleCurrency={onToggleCurrency}
          onOpenSettings={() => openSettingsAt("general")}
          onOpenWorkdir={openWorkspacePicker}
        />

        <CommandPalette
          open={palette.open}
          onClose={() => palette.setOpen(false)}
          commands={commands}
        />

        <WorkdirPop
          open={wdOpen}
          onClose={() => setWdOpen(false)}
          recent={state.settings?.recentWorkspaces ?? []}
          current={state.settings?.workspaceDir}
          anchor={wdAnchor}
          onPick={(path) => {
            if (isWebRuntime) {
              // Plain browser: the CLI server owns the workspace; just
              // persist the preference (the next load picks it up).
              saveSettings({ workspaceDir: path });
              return;
            }
            // Desktop shell: switch to (or start) that workspace
            // instance. main.rs spawns a new CLI if it isn't running
            // yet, and the WorkspaceTabs poll picks the instance up
            // as a new active workspace tab.
            invoke("switch_workspace", { path }).catch((err) =>
              console.error("switch_workspace failed", err),
            );
          }}
          onBrowse={pickWorkspace}
        />

        <WorkdirInputModal
          open={workdirModalOpen}
          initialPath={state.settings?.workspaceDir}
          onCancel={() => setWorkdirModalOpen(false)}
          onConfirm={(path) => {
            saveSettings({ workspaceDir: path });
            setWorkdirModalOpen(false);
          }}
        />

        {aboutOpen ? <AboutModal onClose={() => setAboutOpen(false)} /> : null}

        {settingsOpen && state.settings ? (
          <SettingsModal
            settings={state.settings}
            balance={state.balance}
            usage={state.usage}
            currency={currency}
            theme={theme}
            themeStyle={themeStyle}
            onSetTheme={onSetTheme}
            onSetThemeStyle={onSetThemeStyle}
            fontScale={fontScale}
            onSetFontScale={onSetFontScale}
            fontFamily={fontFamily}
            onSetFontFamily={onSetFontFamily}
            initialPage={settingsPage}
            mcpSpecs={state.mcpSpecs}
            mcpBridged={state.mcpBridged}
            skills={state.skills}
            memory={state.memory}
            memoryDetail={state.memoryDetail}
            qq={state.qq}
            onClose={() => setSettingsOpen(false)}
            onSave={saveSettings}
            onSaveApiKey={saveApiKey}
            onLoadQQ={loadQQSettings}
            onConnectQQ={connectQQ}
            onDisconnectQQ={disconnectQQ}
            onSaveQQConfig={saveQQConfig}
            onOpenQQApplyLink={() =>
              openUrl("https://q.qq.com/qqbot/openclaw/login.html").catch(() => undefined)
            }
            onPickWorkspace={pickWorkspace}
            onAddMcpSpec={addMcpSpec}
            onRemoveMcpSpec={removeMcpSpec}
            onReadMemory={(path) => sendRpc({ cmd: "memory_read", path })}
          />
        ) : null}

        <JobsPop
          open={jobsOpen}
          onClose={() => setJobsOpen(false)}
          jobs={state.jobs}
          onStop={(jobId) => sendRpc({ cmd: "jobs_stop", jobId })}
          onStopAll={() => sendRpc({ cmd: "jobs_stop_all" })}
        />

        <Toast message={toast} />

        {splashOn ? <Splash onDone={() => setSplashOn(false)} /> : null}
      </div>
    </WorkspaceProvider>
  );
}

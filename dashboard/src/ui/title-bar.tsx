import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t, useLang } from "../i18n";
import { I } from "../icons";
import { Shortcut, localizeShortcutText } from "./shortcut";
import { WorkspaceTabs, type WorkspaceTab } from "./workspace-tabs";

interface TitleBarProps {
  session: string;
  model?: string;
  sideOn: boolean;
  ctxOn: boolean;
  onToggleSide: () => void;
  onToggleCtx: () => void;
  onOpenCommands: () => void;
  onOpenSettings: () => void;
  onCopy: () => void;
  onExport: () => void;
  onClear: () => void;
  hasMessages: boolean;
  /** 移动端：汉堡菜单状态 */
  mobileSideOpen: boolean;
  onToggleMobileSide: () => void;
  workspaceTabs: WorkspaceTab[];
  activeWorkspaceId: string | null;
  onSwitchWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onCloseWorkspace: (id: string) => void;
}

export function TitleBar({
  session,
  model,
  sideOn,
  ctxOn,
  onToggleSide,
  onToggleCtx,
  onOpenCommands,
  onOpenSettings,
  onCopy,
  onExport,
  onClear,
  hasMessages,
  mobileSideOpen,
  onToggleMobileSide,
  workspaceTabs,
  activeWorkspaceId,
  onSwitchWorkspace,
  onNewWorkspace,
  onCloseWorkspace,
}: TitleBarProps) {
  useLang();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  // Desktop shell build number + installed CLI version, shown as a small
  // badge on the right side of the title bar.
  const [ver, setVer] = useState<{ build: string; cli: string } | null>(null);
  useEffect(() => {
    let closed = false;
    void (async () => {
      try {
        const build = await invoke("desktop_build");
        const env = (await invoke("check_environment")) as { cli_version?: string } | undefined;
        if (closed) return;
        setVer({ build: String(build ?? "dev"), cli: String(env?.cli_version ?? "") });
      } catch {
        /* non-Tauri shell — no badge */
      }
    })();
    return () => {
      closed = true;
    };
  }, []);
  const moreWrapRef = useRef<HTMLDivElement>(null);
  const isMac = document.documentElement.dataset.platform === "macos";
  const isWeb = document.documentElement.dataset.web === "true";

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setIsMaximized);
    let unlisten: (() => void) | undefined;
    win
      .listen("tauri://resize", async () => {
        setIsMaximized(await win.isMaximized());
      })
      .then((fn: (() => void) | undefined) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreWrapRef.current && !moreWrapRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const win = getCurrentWindow();

  return (
    <header className="titlebar">
      <div className="tb-left">
        {isMac && !isWeb ? (
          <div className="mac-controls" aria-label={t("app.titlebar.windowControls")}>
            <button
              type="button"
              className="mac-ctrl close"
              title={t("app.titlebar.close")}
              aria-label={t("app.titlebar.close")}
              onMouseDown={(e) => {
                e.stopPropagation();
                win.close();
              }}
            >
              <WinClose />
            </button>
            <button
              type="button"
              className="mac-ctrl minimize"
              title={t("app.titlebar.minimize")}
              aria-label={t("app.titlebar.minimize")}
              onMouseDown={(e) => {
                e.stopPropagation();
                win.minimize();
              }}
            >
              <WinMinimize />
            </button>
            <button
              type="button"
              className="mac-ctrl zoom"
              title={isMaximized ? t("app.titlebar.restore") : t("app.titlebar.maximize")}
              aria-label={isMaximized ? t("app.titlebar.restore") : t("app.titlebar.maximize")}
              onMouseDown={(e) => {
                e.stopPropagation();
                win.toggleMaximize();
              }}
            >
              {isMaximized ? <WinRestore /> : <WinMaximize />}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="tb-mobile-menu"
          aria-label="打开会话列表"
          aria-expanded={mobileSideOpen}
          onClick={onToggleMobileSide}
        >
          {mobileSideOpen ? <I.x size={18} /> : <I.panel_l size={18} />}
        </button>
        <button
          type="button"
          className="iconbtn tb-desktop-side-btn"
          data-on={sideOn}
          title={localizeShortcutText(t("app.titlebar.sidebar"))}
          onClick={onToggleSide}
        >
          <I.panel_l size={14} />
        </button>
        <div className="tb-meta" data-tauri-drag-region>
          <div className="brand" data-tauri-drag-region>
            <span className="mark" />
            <span className="brand-name">Reasonix</span>
          </div>
          {session && (
            <div className="crumbs" data-tauri-drag-region>
              <span className="sep">/</span>
              <span className="cur">{model ?? "—"}</span>
            </div>
          )}
        </div>
        <WorkspaceTabs
          tabs={workspaceTabs.map((t) => ({ ...t, active: t.id === activeWorkspaceId }))}
          activeId={activeWorkspaceId}
          onSelect={onSwitchWorkspace}
          onNew={onNewWorkspace}
          onClose={onCloseWorkspace}
        />
      </div>

      <span className="grow" data-tauri-drag-region />

      <div className="tb-right">
        {ver ? (
          <span className="tb-version" title="Desktop build · CLI version">
            {ver.build === "dev" ? "dev" : `build ${ver.build}`}
            {ver.cli ? ` · cli ${ver.cli}` : ""}
          </span>
        ) : null}
        <button
          type="button"
          className="iconbtn"
          data-on={ctxOn}
          title={t("app.titlebar.contextPanel")}
          onClick={onToggleCtx}
        >
          <I.panel_r size={14} />
        </button>

        <div ref={moreWrapRef} style={{ position: "relative" }}>
          <button
            type="button"
            className="iconbtn"
            title={t("app.titlebar.more")}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <I.more size={14} />
          </button>
          {menuOpen ? (
            <div
              className="popup"
              style={{
                top: "calc(100% + 6px)",
                right: 0,
                left: "auto",
                bottom: "auto",
                width: 220,
              }}
            >
              <div className="popup-list">
                <div
                  className="popup-item"
                  onClick={() => {
                    onOpenCommands();
                    setMenuOpen(false);
                  }}
                >
                  <span className="ico">
                    <I.search size={12} />
                  </span>
                  <div className="nm">
                    <span>{t("app.titlebar.commandPalette")}</span>
                  </div>
                  <span className="kb">
                    <Shortcut keys={["mod", "K"]} />
                  </span>
                </div>
                <div
                  className="popup-item"
                  onClick={() => {
                    if (hasMessages) onCopy();
                    setMenuOpen(false);
                  }}
                  style={{ opacity: hasMessages ? 1 : 0.5 }}
                >
                  <span className="ico">
                    <I.copy size={12} />
                  </span>
                  <div className="nm">
                    <span>{t("app.titlebar.copyMd")}</span>
                  </div>
                </div>
                <div
                  className="popup-item"
                  onClick={() => {
                    if (hasMessages) onExport();
                    setMenuOpen(false);
                  }}
                  style={{ opacity: hasMessages ? 1 : 0.5 }}
                >
                  <span className="ico">
                    <I.download size={12} />
                  </span>
                  <div className="nm">
                    <span>{t("app.titlebar.exportMd")}</span>
                  </div>
                </div>
                <div
                  className="popup-item"
                  onClick={() => {
                    onClear();
                    setMenuOpen(false);
                  }}
                >
                  <span className="ico">
                    <I.x size={12} />
                  </span>
                  <div className="nm">
                    <span>{t("app.titlebar.clearChat")}</span>
                  </div>
                </div>
                <div
                  className="popup-item"
                  onClick={() => {
                    onOpenSettings();
                    setMenuOpen(false);
                  }}
                >
                  <span className="ico">
                    <I.cog size={12} />
                  </span>
                  <div className="nm">
                    <span>{t("app.titlebar.settings")}</span>
                  </div>
                  <span className="kb">
                    <Shortcut keys={["mod", ","]} />
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {!isMac && !isWeb ? (
          <div className="win-controls">
            <button
              type="button"
              className="win-ctrl"
              title={t("app.titlebar.minimize")}
              onMouseDown={(e) => {
                e.stopPropagation();
                win.minimize();
              }}
            >
              <WinMinimize />
            </button>
            <button
              type="button"
              className="win-ctrl"
              title={isMaximized ? t("app.titlebar.restore") : t("app.titlebar.maximize")}
              onMouseDown={(e) => {
                e.stopPropagation();
                win.toggleMaximize();
              }}
            >
              {isMaximized ? <WinRestore /> : <WinMaximize />}
            </button>
            <button
              type="button"
              className="win-ctrl close"
              title={t("app.titlebar.close")}
              onMouseDown={(e) => {
                e.stopPropagation();
                win.close();
              }}
            >
              <WinClose />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

interface TabBarProps {
  tabs: { id: string; workspaceDir?: string }[];
  activeId: string;
  setActive: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  singleTab?: boolean;
}

export function TabBar({
  tabs,
  activeId,
  setActive,
  onClose,
  onNew,
  singleTab,
}: TabBarProps) {
  useLang();
  return (
    <div className="tabbar">
      {tabs.map((tab) => {
        const ws = tab.workspaceDir ?? "";
        const label =
          ws
            .replace(/[\\/]$/, "")
            .split(/[\\/]/)
            .pop() || "workspace";
        return (
          <div
            key={tab.id}
            className="tab"
            data-active={tab.id === activeId}
            onClick={() => setActive(tab.id)}
            title={ws}
          >
            <span className="tab-name">{label}</span>
            {!singleTab && tabs.length > 1 && (
              <button
                type="button"
                className="tab-close"
                aria-label={t("workspaceTab.close")}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <I.x size={10} />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="tab-new"
        onClick={onNew}
        title={t("workspaceTab.new")}
      >
        <I.plus size={12} />
      </button>
    </div>
  );
}

function WinClose() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function WinMinimize() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <path d="M1 5L9 5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function WinMaximize() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <rect
        x="1"
        y="1"
        width="8"
        height="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function WinRestore() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <rect
        x="2"
        y="0.5"
        width="7.5"
        height="7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M2.5 0.5V2H0.5V9.5H8V7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export default TitleBar;
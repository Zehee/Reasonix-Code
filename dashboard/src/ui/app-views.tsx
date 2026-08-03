import { useState } from "react";
import { t, useLang } from "../i18n";
import { I } from "../icons";
import { BrandLogo } from "./brand";

export function MainHead({
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

export function EmptyState({
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
      <div style={{ margin: "0 auto 14px", width: 56 }}>
        <BrandLogo size={56} />
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

export function NeedsSetupView({
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

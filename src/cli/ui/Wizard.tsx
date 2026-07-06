/** First-run / re-configure wizard — saves to `~/.reasonix/config.json`. */

import { mkdirSync, statSync } from "node:fs";
import { Box, Text, useApp, useInput } from "ink";
import { TextInput } from "ink";
// biome-ignore lint/style/useImportType: JSX (jsx: "react") needs React as a value at runtime
import React, { useEffect, useState } from "react";
import {
  type ReasonixConfig,
  defaultConfigPath,
  isPlausibleKey,
  loadBaseUrl,
  loadTheme,
  readConfig,
  redactKey,
  resolveThemePreference,
  writeConfig,
} from "../../config.js";
import {
  detectSystemLanguage,
  getLanguage,
  getSupportedLanguages,
  notifyLanguageChange,
  onLanguageChange,
  setLanguage,
  t,
} from "../../i18n/index.js";
import type { LanguageCode } from "../../i18n/types.js";
import { type SelectItem, SingleSelect } from "./Select.js";
import { ThemeProvider, useTheme } from "./theme/context.js";
import { themeChoiceLabel } from "./theme/labels.js";
import { FG, type ThemeName, listThemeNames, resolveThemeName } from "./theme/tokens.js";

export interface WizardProps {
  /** Called once the config has been saved. */
  onComplete: (cfg: ReasonixConfig) => void;
  /** Called if the user presses Esc to abort. */
  onCancel?: () => void;
  /** Skip the API-key step if a key already exists (env or config). */
  existingApiKey?: string;
  /** Force the API-key step so `reasonix setup` can replace a saved key. */
  forceApiKeyStep?: boolean;
  /** Verifies the submitted key before the wizard can continue. */
  validateApiKey?: (apiKey: string) => Promise<ApiKeyValidationResult>;
  /** Pre-fill selections when re-running (reconfigure flow). */
  initial?: {
    theme?: ThemeName | "auto";
  };
}

export type ApiKeyValidationResult =
  | { ok: true }
  | { ok: false; reason: "rejected" | "failed"; message?: string };

type Step = "language" | "theme" | "apiKey" | "review" | "saved";

interface WizardData {
  language: LanguageCode;
  theme: ThemeName;
  apiKey: string;
}



const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  EN: "English",
  "zh-CN": "简体中文",
  de: "Deutsch",
  ru: "Русский",
  ja: "日本語",
};

export function Wizard({
  onComplete,
  onCancel,
  existingApiKey,
  forceApiKeyStep = false,
  validateApiKey = validateDeepSeekApiKey,
  initial,
}: WizardProps) {
  const { exit } = useApp();
  const [, setLanguageVersion] = useState(0);
  useEffect(() => onLanguageChange(() => setLanguageVersion((v) => v + 1)), []);

  const [previewTheme, setPreviewTheme] = useState<ThemeName>(() =>
    resolveThemePreference(initial?.theme ?? loadTheme(), process.env.REASONIX_THEME),
  );

  const [step, setStep] = useState<Step>("language");
  const [data, setData] = useState<WizardData>(() => ({
    language: getLanguage(),
    theme: resolveThemePreference(initial?.theme ?? loadTheme(), process.env.REASONIX_THEME),
    apiKey: existingApiKey ?? "",
  }));
  const [error, setError] = useState<string | null>(null);

  useInput((_input, key) => {
    if (key.escape && step !== "saved" && onCancel) onCancel();
  });

  const content = (() => {
    if (step === "language") {
      return (
        <LanguageStep
          initialValue={data.language}
          onSubmit={(lang) => {
            setLanguage(lang);
            notifyLanguageChange();
            setData((d) => ({ ...d, language: lang }));
            setStep("theme");
          }}
        />
      );
    }

    if (step === "theme") {
      return (
        <ThemeStep
          initialValue={data.theme}
          onPreview={setPreviewTheme}
          onSubmit={(theme) => {
            setData((d) => ({ ...d, theme }));
            setStep(existingApiKey && !forceApiKeyStep ? "review" : "apiKey");
          }}
        />
      );
    }

    if (step === "apiKey") {
      return (
        <ApiKeyStep
          initialValue={data.apiKey}
          validateApiKey={validateApiKey}
          onSubmit={(key) => {
            setData((d) => ({ ...d, apiKey: key }));
            setError(null);
            setStep("review");
          }}
          error={error}
          onError={setError}
        />
      );
    }

    if (step === "review") {
      return (
        <StepFrame title={t("wizard.reviewTitle")} step={1} total={0}>
          <Box flexDirection="column">
            <SummaryLine
              label={t("wizard.reviewLabelLanguage")}
              value={LANGUAGE_LABELS[data.language]}
            />
            <SummaryLine label={t("wizard.reviewLabelApiKey")} value={redactKey(data.apiKey)} />
            <SummaryLine label={t("wizard.reviewLabelTheme")} value={data.theme} />
            <Box marginTop={1}>
              <Text>{t("wizard.reviewSavesTo", { path: defaultConfigPath() })}</Text>
            </Box>
            {error ? (
              <Box marginTop={1}>
                <Text color="ansi:red">{error}</Text>
              </Box>
            ) : null}
            <Box marginTop={1}>
              <Text color={FG.faint}>{t("wizard.reviewFooter")}</Text>
            </Box>
          </Box>
          <ReviewConfirm
            onConfirm={() => {
              try {
                const prev = readConfig();
                const next: ReasonixConfig = {
                  ...prev,
                  apiKey: data.apiKey,
                  theme: data.theme,
                  setupCompleted: true,
                };
                writeConfig(next);
                setStep("saved");
                onComplete(next);
              } catch (e) {
                setError(t("wizard.reviewSaveError", { message: (e as Error).message }));
              }
            }}
          />
        </StepFrame>
      );
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="ansi:green" paddingX={1}>
        <Text bold color="ansi:green">
          {t("wizard.savedTitle")}
        </Text>
        <Box marginTop={1}>
          <Text>{t("ui.welcome")}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={FG.faint}>{t("wizard.savedShellHint")}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={FG.faint}>{t("wizard.savedFooter")}</Text>
        </Box>
        <ExitOnEnter onExit={exit} />
      </Box>
    );
  })();

  return <ThemeProvider name={previewTheme}>{content}</ThemeProvider>;
}

const THEME_NAMES = listThemeNames();

function ThemeStep({
  initialValue,
  onPreview,
  onSubmit,
}: {
  initialValue: ThemeName;
  onPreview: (theme: ThemeName) => void;
  onSubmit: (theme: ThemeName) => void;
}) {
  const resolvedInitial = resolveThemeName(initialValue);
  const initialIndex = Math.max(
    0,
    THEME_NAMES.indexOf(resolvedInitial as (typeof THEME_NAMES)[number]),
  );
  const [index, setIndex] = useState(initialIndex);
  const theme = useTheme();

  useInput((_input, key) => {
    if (key.upArrow) {
      const next = (index - 1 + THEME_NAMES.length) % THEME_NAMES.length;
      setIndex(next);
      onPreview(THEME_NAMES[next]!);
    } else if (key.downArrow) {
      const next = (index + 1) % THEME_NAMES.length;
      setIndex(next);
      onPreview(THEME_NAMES[next]!);
    } else if (key.return) {
      onSubmit(THEME_NAMES[index]!);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.tone.brand} paddingX={1}>
      <Text bold color={theme.tone.brand}>
        {t("wizard.themeTitle")}
      </Text>
      <Box marginTop={1}>
        <Text color={FG.faint}>{t("wizard.themeSubtitle")}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {THEME_NAMES.map((name, i) => (
          <Box key={name}>
            <Text color={i === index ? theme.tone.brand : undefined}>
              {i === index ? "▸ " : "  "}
            </Text>
            <Text bold={i === index} color={i === index ? theme.fg.strong : theme.fg.body}>
              {themeChoiceLabel(name)}
            </Text>
            <Text color={theme.fg.meta}>{" — "}</Text>
            <Text color={theme.fg.meta}>{t(`wizard.themeCaption.${name}`)}</Text>
          </Box>
        ))}
      </Box>
      <Box
        marginTop={1}
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.fg.faint}
        paddingX={1}
      >
        <Text color={theme.fg.meta}>{t("wizard.themeSampleHeading")}</Text>
        <Box marginTop={1}>
          <Text color={theme.tone.accent}>{"◆ "}</Text>
          <Text color={theme.tone.accent}>{t("wizard.themeSampleReasoning")}</Text>
        </Box>
        <Box>
          <Text color={theme.tone.info}>{"▣ "}</Text>
          <Text color={theme.fg.body}>{"fs.readFile("}</Text>
          <Text color={theme.tone.ok}>{'"main.ts"'}</Text>
          <Text color={theme.fg.body}>{")"}</Text>
        </Box>
        <Box>
          <Text color={theme.fg.meta}>~/project/main.ts:42</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.tone.ok}>ok</Text>
          <Text color={theme.fg.faint}>{" · "}</Text>
          <Text color={theme.tone.warn}>warn</Text>
          <Text color={theme.fg.faint}>{" · "}</Text>
          <Text color={theme.tone.err}>err</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={FG.faint}>{t("wizard.themeFooter")}</Text>
      </Box>
    </Box>
  );
}

// ---------- step components ----------

function LanguageStep({
  initialValue,
  onSubmit,
}: {
  initialValue: LanguageCode;
  onSubmit: (lang: LanguageCode) => void;
}) {
  const items: SelectItem<LanguageCode>[] = getSupportedLanguages().map((code) => ({
    value: code,
    label: LANGUAGE_LABELS[code],
    hint: code === detectSystemLanguage() ? "(detected)" : undefined,
  }));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="ansi:cyan" paddingX={1}>
      <Text bold color="ansi:cyan">
        {t("wizard.languageTitle")}
      </Text>
      <Box marginTop={1}>
        <Text color={FG.faint}>{t("wizard.languageSubtitle")}</Text>
      </Box>
      <Box marginTop={1}>
        <SingleSelect<LanguageCode>
          items={items}
          initialValue={initialValue}
          onSubmit={onSubmit}
          footer={t("wizard.selectFooter")}
        />
      </Box>
    </Box>
  );
}

function ApiKeyStep({
  initialValue,
  validateApiKey,
  onSubmit,
  error,
  onError,
}: {
  initialValue?: string;
  validateApiKey: (apiKey: string) => Promise<ApiKeyValidationResult>;
  onSubmit: (key: string) => void;
  error: string | null;
  onError: (e: string | null) => void;
}) {
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="ansi:cyan" paddingX={1}>
      <Text bold color="ansi:cyan">
        {t("wizard.welcomeTitle")}
      </Text>
      <Box marginTop={1}>
        <Text>{t("wizard.apiKeyPrompt")}</Text>
      </Box>
      <Text color={FG.faint}>{t("wizard.apiKeyGetOne")}</Text>
      <Text color={FG.faint}>{t("wizard.apiKeySavedLocally", { path: defaultConfigPath() })}</Text>
      {initialValue ? (
        <Text color={FG.faint}>
          {t("wizard.apiKeyPreview", { redacted: redactKey(initialValue) })}
        </Text>
      ) : null}
      <Box marginTop={1}>
        <Text bold color="ansi:cyan">
          {t("wizard.apiKeyInputLabel")}
        </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(raw) => {
            const trimmed = raw.trim() || initialValue?.trim() || "";
            if (!isPlausibleKey(trimmed)) {
              onError(t("wizard.apiKeyInvalid"));
              setValue("");
              return;
            }
            setChecking(true);
            onError(null);
            void validateApiKey(trimmed).then((result) => {
              setChecking(false);
              if (!result.ok) {
                onError(
                  result.reason === "rejected"
                    ? t("wizard.apiKeyRejected")
                    : t("wizard.apiKeyCheckFailed", { message: result.message ?? "unknown" }),
                );
                setValue("");
                return;
              }
              onSubmit(trimmed);
            });
          }}
          mask="•"
          placeholder="sk-..."
        />
      </Box>
      {checking ? (
        <Box marginTop={1}>
          <Text color="ansi:yellow">{t("wizard.apiKeyChecking")}</Text>
        </Box>
      ) : error ? (
        <Box marginTop={1}>
          <Text color="ansi:red">{error}</Text>
        </Box>
      ) : value ? (
        <Box marginTop={1}>
          <Text color={FG.faint}>{t("wizard.apiKeyPreview", { redacted: redactKey(value) })}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// Hit `/models` instead of DeepSeek's `/user/balance`: the OpenAI-compat
// listing endpoint exists on every provider that pretends to be OpenAI
// (DeepSeek, DashScope/Tongyi, Moonshot, Zhipu, …), and 401/403 there
// still means "key bad" the same way.
export async function validateDeepSeekApiKey(
  apiKey: string,
  opts: {
    baseUrl?: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
  } = {},
): Promise<ApiKeyValidationResult> {
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  let baseUrl = opts.baseUrl ?? loadBaseUrl() ?? "https://api.deepseek.com";
  while (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const resp = await fetchImpl(`${baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (resp.ok) return { ok: true };
    if (resp.status === 401 || resp.status === 403) return { ok: false, reason: "rejected" };
    return { ok: false, reason: "failed", message: `HTTP ${resp.status}` };
  } catch (e) {
    return { ok: false, reason: "failed", message: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}



function ReviewConfirm({ onConfirm }: { onConfirm: () => void }) {
  useInput((_i, key) => {
    if (key.return) onConfirm();
  });
  return null;
}

function ExitOnEnter({ onExit }: { onExit: () => void }) {
  useInput((_i, key) => {
    if (key.return) onExit();
  });
  return null;
}

function StepFrame({
  title,
  step,
  total,
  children,
}: {
  title: string;
  step: number;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="ansi:cyan" paddingX={1}>
      <Box>
        <Text color={FG.faint}>{t("wizard.stepCounter", { step, total })}</Text>
        <Text bold color="ansi:cyan">
          {title}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text>{label.padEnd(12)}</Text>
      <Text bold>{value}</Text>
    </Box>
  );
}


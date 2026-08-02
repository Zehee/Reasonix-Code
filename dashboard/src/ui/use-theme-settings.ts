import { useCallback, useEffect, useState } from "react";
import {
  FONT_FAMILY,
  FONT_FAMILY_STACK,
  FONT_SCALE,
  FONT_SCALE_ZOOM,
  THEME,
  type FontFamily,
  type FontScale,
  type Theme,
  type ThemeStyle,
  defaultStyleForTheme,
  isFontFamily,
  isFontScale,
  isTheme,
  isThemeStyle,
  themeForStyle,
} from "../theme";

const STORAGE_KEYS = {
  currency: "reasonix.currency",
  theme: "reasonix.theme",
  themeStyle: "reasonix.themeStyle",
  fontScale: "reasonix.fontScale",
  fontFamily: "reasonix.fontFamily",
  sideCollapsed: "reasonix.sideCollapsed",
  ctxCollapsed: "reasonix.ctxCollapsed",
} as const;

export type Currency = "CNY" | "USD";

// Centralised user preferences hook. Replaces ~60 lines of duplicated
// localStorage boilerplate that used to live inline in App.
export interface UseThemeSettings {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  themeStyle: ThemeStyle;
  setThemeStyle: (s: ThemeStyle) => void;
  fontScale: FontScale;
  setFontScale: (s: FontScale) => void;
  fontFamily: FontFamily;
  setFontFamily: (f: FontFamily) => void;
  sideCollapsed: boolean;
  setSideCollapsed: (v: boolean) => void;
  ctxCollapsed: boolean;
  setCtxCollapsed: (v: boolean) => void;
}

function readInitialCurrency(): Currency {
  const v = localStorage.getItem(STORAGE_KEYS.currency);
  return v === "USD" ? "USD" : "CNY";
}

function readInitialTheme(): Theme {
  const v = localStorage.getItem(STORAGE_KEYS.theme);
  const style = localStorage.getItem(STORAGE_KEYS.themeStyle);
  if (isThemeStyle(style)) return themeForStyle(style);
  return isTheme(v) ? v : THEME.DARK;
}

function readInitialThemeStyle(): ThemeStyle {
  const style = localStorage.getItem(STORAGE_KEYS.themeStyle);
  if (isThemeStyle(style)) return style;
  const storedTheme = localStorage.getItem(STORAGE_KEYS.theme);
  return defaultStyleForTheme(isTheme(storedTheme) ? storedTheme : THEME.DARK);
}

function readInitialFontScale(): FontScale {
  const v = localStorage.getItem(STORAGE_KEYS.fontScale);
  return isFontScale(v) ? v : FONT_SCALE.MEDIUM;
}

function readInitialFontFamily(): FontFamily {
  const v = localStorage.getItem(STORAGE_KEYS.fontFamily);
  return isFontFamily(v) ? v : FONT_FAMILY.SANS;
}

function readInitialSideCollapsed(): boolean {
  return localStorage.getItem(STORAGE_KEYS.sideCollapsed) === "1";
}

function readInitialCtxCollapsed(): boolean {
  return localStorage.getItem(STORAGE_KEYS.ctxCollapsed) === "1";
}

export function useThemeSettings(): UseThemeSettings {
  const [currency, setCurrency] = useState<Currency>(readInitialCurrency);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [themeStyle, setThemeStyle] = useState<ThemeStyle>(readInitialThemeStyle);
  const [fontScale, setFontScale] = useState<FontScale>(readInitialFontScale);
  const [fontFamily, setFontFamily] = useState<FontFamily>(readInitialFontFamily);
  const [sideCollapsed, setSideCollapsed] = useState<boolean>(readInitialSideCollapsed);
  const [ctxCollapsed, setCtxCollapsed] = useState<boolean>(readInitialCtxCollapsed);

  // Theme dataset + persistence
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeStyle = themeStyle;
    localStorage.setItem(STORAGE_KEYS.theme, theme);
    localStorage.setItem(STORAGE_KEYS.themeStyle, themeStyle);
  }, [theme, themeStyle]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.sideCollapsed, sideCollapsed ? "1" : "0");
  }, [sideCollapsed]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ctxCollapsed, ctxCollapsed ? "1" : "0");
  }, [ctxCollapsed]);

  useEffect(() => {
    // Chromium webview supports `zoom`; scales every px-based size without touching CSS rules.
    document.documentElement.style.setProperty("zoom", String(FONT_SCALE_ZOOM[fontScale]));
    localStorage.setItem(STORAGE_KEYS.fontScale, fontScale);
  }, [fontScale]);

  useEffect(() => {
    // CSS rules use var(--font-sans); changing it here re-styles every sans surface in one shot.
    document.documentElement.style.setProperty("--font-sans", FONT_FAMILY_STACK[fontFamily]);
    localStorage.setItem(STORAGE_KEYS.fontFamily, fontFamily);
  }, [fontFamily]);

  // Currency change requests from side surfaces (e.g. WorkdirPop).
  useEffect(() => {
    const onCur = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === "CNY" || detail === "USD") setCurrency(detail);
    };
    window.addEventListener("reasonix:currency", onCur);
    return () => window.removeEventListener("reasonix:currency", onCur);
  }, []);

  // Persist currency changes.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.currency, currency);
  }, [currency]);

  return {
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
  };
}

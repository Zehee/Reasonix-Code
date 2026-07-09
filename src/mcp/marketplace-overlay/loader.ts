import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface OverlayEntry {
  title: string;
  description: string;
}

let cache: Record<string, OverlayEntry> | null = null;
let cachedLang: string | null = null;

export function loadOverlay(lang: string): Record<string, OverlayEntry> | null {
  if (cachedLang === lang && cache) return cache;
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), `${lang}.json`),
    // Standalone binary layout.
    join(dirname(process.execPath), "mcp", "marketplace-overlay", `${lang}.json`),
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, "utf8");
      cache = JSON.parse(raw) as Record<string, OverlayEntry>;
      cachedLang = lang;
      return cache;
    } catch {
      /* try next */
    }
  }
  return null;
}

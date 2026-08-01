import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mkTmp = () => mkdtempSync(join(tmpdir(), "reasonix-theme-"));

// Import the module under test once — the test verifies the observable
// effect of saveTheme (no .tmp files left behind) by replacing the
// low-level fs.renameSync *before* constructing the manager, which
// makes the patch visible to the subsequently-imported module via
// CommonJS live bindings under the Node loader used by vitest.

import { type ThemeAssociation, ThemeManager } from "../src/themes/manager";

const baseAssociation = {
  theme: "default",
  displayName: "Default",
  createdAt: "",
  updatedAt: "",
  turns: [],
  memories: [],
} satisfies ThemeAssociation;

describe("theme-manager: saveTheme", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkTmp();
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes the theme file atomically without leaving .tmp artifacts", () => {
    const themesRoot = join(tmp, "themes");
    const mgr = new ThemeManager(themesRoot);
    mgr.saveTheme("default", baseAssociation);

    const files = readdirSync(themesRoot);
    expect(files).toContain("default.json");
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
    expect(JSON.parse(readFileSync(join(themesRoot, "default.json"), "utf8")).displayName).toBe(
      "Default",
    );
  });

  it("leaves no .tmp file behind when renameSync throws", () => {
    const fs = require("node:fs");
    const origRename = fs.renameSync;
    const themesRoot = join(tmp, "themes");
    fs.mkdirSync(themesRoot, { recursive: true });
    const themePath = join(themesRoot, "default.json");
    writeFileSync(themePath, "{}", "utf8");

    // Force every rename to fail — simulates EXDEV or a full disk.
    let renameCalls = 0;
    fs.renameSync = vi.fn(() => {
      renameCalls++;
      throw Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
    });

    try {
      const mgr = new ThemeManager(themesRoot);
      expect(() => mgr.saveTheme("default", baseAssociation)).toThrow(/EXDEV/);
      const files = fs.readdirSync(themesRoot);
      expect(files.filter((f: string) => f.endsWith(".tmp"))).toHaveLength(0);
      // Original file should be untouched.
      expect(readFileSync(themePath, "utf8")).toBe("{}");
      expect(renameCalls).toBe(1);
    } finally {
      fs.renameSync = origRename;
    }
  });
});

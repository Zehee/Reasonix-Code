import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { citationPathExists, setCitationRoot } from "../src/cli/ui/citation-check.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "citation-check-"));
  writeFileSync(join(dir, "exists.ts"), "export {};\n");
  setCitationRoot(dir);
});

afterEach(() => {
  setCitationRoot(undefined as unknown as string);
});

describe("citationPathExists", () => {
  it("resolves relative paths against the citation root", () => {
    expect(citationPathExists("exists.ts")).toBe(true);
    expect(citationPathExists("missing.ts")).toBe(false);
  });

  it("handles absolute paths on their own", () => {
    expect(citationPathExists(join(dir, "exists.ts"))).toBe(true);
    expect(citationPathExists(join(dir, "nope.ts"))).toBe(false);
  });

  it("treats directories as existing", () => {
    expect(citationPathExists(".")).toBe(true);
  });

  it("does not throw on malformed paths", () => {
    expect(citationPathExists("")).toBe(false);
    expect(citationPathExists("\u0000")).toBe(false);
  });

  it("ignores line suffixes that callers already stripped", () => {
    // The markdown splitter separates `path:12` into path + line, so the
    // function only ever sees the bare path — but a stray colon-12 input
    // must not crash (falls back to false on non-existent full string).
    const r = citationPathExists("exists.ts:12");
    expect(existsSync(join(dir, "exists.ts:12"))).toBe(r);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("user message rendering", () => {
  it("preserves whitespace and wraps long text in dashboard bubbles", () => {
    const dashboardCss = readFileSync("dashboard/src/styles.css", "utf8");

    expect(dashboardCss).toContain(".msg-text {");
    expect(dashboardCss).toContain("white-space: pre-wrap");
    expect(dashboardCss).toContain("overflow-wrap: anywhere");
    expect(dashboardCss).toContain(".msg-text .markdown");
    expect(dashboardCss).toContain("white-space: normal");
  });
});

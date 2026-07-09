import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("markdown code block rendering", () => {
  it("disables font ligatures in dashboard code blocks", () => {
    const dashboardCss = readFileSync("dashboard/src/styles.css", "utf8");

    expect(dashboardCss).toContain(".markdown .codeview");
    expect(dashboardCss).toContain("font-variant-ligatures: none");
    expect(dashboardCss).toContain('font-feature-settings: "liga" 0, "calt" 0');
  });
});

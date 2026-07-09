import { type ReactElement, createElement } from "react";
import { describe, expect, it } from "vitest";

import { extractFencedLang } from "../dashboard/src/Markdown";

const stub = (className: string): ReactElement => createElement("code", { className });

describe("dashboard extractFencedLang", () => {
  it("reads language- class from a child element", () => {
    expect(extractFencedLang(stub("language-ts"))).toBe("ts");
    expect(extractFencedLang(stub("language-python"))).toBe("python");
    expect(extractFencedLang(stub("language-c-sharp"))).toBe("c-sharp");
  });

  it("returns 'text' when no language- class is found", () => {
    expect(extractFencedLang(stub(""))).toBe("text");
    expect(extractFencedLang(stub("not-a-lang"))).toBe("text");
    expect(extractFencedLang("just a string")).toBe("text");
    expect(extractFencedLang(undefined)).toBe("text");
  });

  it("ignores non-string className values", () => {
    expect(extractFencedLang(createElement("code", { className: 42 }))).toBe("text");
  });
});

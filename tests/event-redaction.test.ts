import { describe, expect, it } from "vitest";
import { redactEventValue } from "../src/core/event-redaction.js";

describe("redactEventValue", () => {
  it("redacts a string under a sensitive key", () => {
    expect(redactEventValue({ apiKey: "sk-live-secret" })).toEqual({
      apiKey: "[redacted]",
    });
  });

  it("redacts a string array under a sensitive key (whole array → placeholder)", () => {
    // Previously the recursive descent dropped the parent key to null when
    // entering an array, so `apiKeys: ["sk-live-1", "sk-live-2"]` was
    // emitted verbatim into the event JSONL.
    expect(redactEventValue({ apiKeys: ["sk-live-1", "sk-live-2"] })).toEqual({
      apiKeys: "[redacted]",
    });
  });

  it("redacts an object array under a sensitive key (whole array → placeholder)", () => {
    expect(redactEventValue({ tokens: [{ name: "github", value: "ghp_xxx" }] })).toEqual({
      tokens: "[redacted]",
    });
  });

  it("redacts nested sensitive keys inside non-sensitive wrappers", () => {
    expect(redactEventValue({ user: { apiKey: "sk-live", name: "alice" } })).toEqual({
      user: { apiKey: "[redacted]", name: "alice" },
    });
  });

  it("redacts string values that look like a Bearer token", () => {
    expect(redactEventValue({ authorization: "Bearer xyz" })).toEqual({
      authorization: "[redacted]",
    });
  });

  it("preserves string arrays under non-sensitive keys", () => {
    expect(redactEventValue({ files: ["a.ts", "b.ts"] })).toEqual({
      files: ["a.ts", "b.ts"],
    });
  });

  it("preserves a top-level string array (no parent key to match)", () => {
    // The redactor has no key context at the top level — we deliberately
    // do NOT redact here, because that would change the type contract
    // (array → string) for non-secret top-level arrays.
    expect(redactEventValue(["secret1", "secret2"])).toEqual(["secret1", "secret2"]);
  });

  it("preserves a non-sensitive header value (key matches by name only when the value starts with 'Bearer ')", () => {
    expect(redactEventValue({ header: "Authorization" })).toEqual({
      header: "Authorization",
    });
  });
});

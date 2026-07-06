import { describe, expect, it } from "vitest";
import { canonicalizeSchema, shrinkDescription } from "../src/tools/schema-canon.js";

describe("canonicalizeSchema", () => {
  it("sorts properties keys alphabetically", () => {
    const input = { properties: { z: { type: "string" }, a: { type: "number" } } };
    const out = canonicalizeSchema(input) as Record<string, unknown>;
    expect(Object.keys((out.properties as Record<string, unknown>))).toEqual(["a", "z"]);
  });

  it("sorts required array", () => {
    const out = canonicalizeSchema({ required: ["z", "a", "m"] }) as Record<string, unknown>;
    expect(out.required).toEqual(["a", "m", "z"]);
  });

  it("removes $schema", () => {
    const out = canonicalizeSchema({ $schema: "http://json-schema.org/draft-07/schema", type: "string" }) as Record<string, unknown>;
    expect(out).not.toHaveProperty("$schema");
    expect(out).toHaveProperty("type");
  });

  it("removes empty description", () => {
    const out = canonicalizeSchema({ type: "string", description: "" }) as Record<string, unknown>;
    expect(out).not.toHaveProperty("description");
  });

  it("keeps non-empty description", () => {
    const out = canonicalizeSchema({ type: "string", description: "hello" }) as Record<string, unknown>;
    expect(out.description).toBe("hello");
  });

  it("recursively processes nested anyOf", () => {
    const input = {
      anyOf: [
        { properties: { b: { type: "string" }, a: { type: "number" } }, required: ["b", "a"] },
      ],
    };
    const out = canonicalizeSchema(input) as Record<string, unknown>;
    const first = (out.anyOf as unknown[])[0] as Record<string, unknown>;
    expect(Object.keys(first.properties as Record<string, unknown>)).toEqual(["a", "b"]);
    expect(first.required).toEqual(["a", "b"]);
  });

  it("handles plain arrays without sorting non-string elements", () => {
    const input = { items: [{ type: "string" }, { type: "number" }] };
    const out = canonicalizeSchema(input) as Record<string, unknown>;
    expect(out.items).toEqual([{ type: "string" }, { type: "number" }]);
  });
});

describe("shrinkDescription", () => {
  it("keeps first sentence when self-contained", () => {
    const desc = "Mark one approved-plan step as done. Call exactly once after finishing each step.";
    expect(shrinkDescription(desc)).toBe("Mark one approved-plan step as done.");
  });

  it("returns short descriptions unchanged", () => {
    const desc = "Short tool.";
    expect(shrinkDescription(desc)).toBe("Short tool.");
  });

  it("truncates long descriptions at sentence boundary", () => {
    const desc = "A very long description. ".repeat(20);
    const result = shrinkDescription(desc);
    expect(result.length).toBeLessThan(desc.length);
    expect(result.endsWith(".")).toBe(true);
  });
});

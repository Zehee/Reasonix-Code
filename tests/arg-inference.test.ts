import { describe, expect, it } from "vitest";
import { inferToolArgs } from "../src/tools/arg-inference.js";
import type { ToolSpec } from "../src/types.js";

function spec(props: Record<string, { type: "string" | "number" }>, required?: string[]): ToolSpec {
  return {
    type: "function",
    function: {
      name: "fixture",
      description: "",
      parameters: {
        type: "object",
        properties: props,
        ...(required ? { required } : {}),
      },
    },
  };
}

const runCmd = spec({ command: { type: "string" }, timeoutSec: { type: "number" } }, ["command"]);
const webFetch = spec({ url: { type: "string" }, timeoutSec: { type: "number" } }, ["url"]);

describe("inferToolArgs — shell-like KV boundary detection", () => {
  it("preserves multi-token command values: `command=git log --oneline | head -5 timeoutSec=30`", () => {
    const r = inferToolArgs("command=git log --oneline | head -5 timeoutSec=30", runCmd);
    expect(r).toEqual({ command: "git log --oneline | head -5", timeoutSec: 30 });
  });

  it("preserves multi-token command values: `command=npm test timeoutSec=30`", () => {
    const r = inferToolArgs("command=npm test timeoutSec=30", runCmd);
    expect(r).toEqual({ command: "npm test", timeoutSec: 30 });
  });

  it("does not corrupt command when an unknown key=value token is present: `command=echo a=b timeoutSec=30`", () => {
    // Previously the fuzzy substring matcher routed the unknown `a` key to
    // the `command` parameter (since 'a' is contained in 'command'),
    // overwriting the value with the unknown token's RHS.
    const r = inferToolArgs("command=echo a=b timeoutSec=30", runCmd);
    expect(r).toEqual({ command: "echo a=b", timeoutSec: 30 });
  });

  it("keeps multi-token values when the second token also looks like a kv: `command=git log --format=%H timeoutSec=30`", () => {
    // Previously the middle token `--format=%H` was treated as a top-level
    // parameter named `--format`, losing the relationship to the command.
    const r = inferToolArgs("command=git log --format=%H timeoutSec=30", runCmd);
    expect(r).toEqual({ command: "git log --format=%H", timeoutSec: 30 });
  });

  it("preserves the trailing unknown path: `command=ls path=src/a.ts`", () => {
    // `path` is not in this schema, so the token must roll into `command`
    // rather than become a top-level parameter.
    const r = inferToolArgs("command=ls path=src/a.ts", runCmd);
    expect(r).toEqual({ command: "ls path=src/a.ts" });
  });

  it('handles quoted multi-token values: `command="git log --oneline" timeoutSec=30`', () => {
    const r = inferToolArgs('command="git log --oneline" timeoutSec=30', runCmd);
    expect(r).toEqual({ command: "git log --oneline", timeoutSec: 30 });
  });

  it("preserves URL parameters with query strings: `url=https://example.com?x=1&y=2 timeoutSec=10`", () => {
    const r = inferToolArgs("url=https://example.com?x=1&y=2 timeoutSec=10", webFetch);
    expect(r).toEqual({ url: "https://example.com?x=1&y=2", timeoutSec: 10 });
  });

  it("preserves parameter order when keys appear out of order: `timeoutSec=5 command=ls`", () => {
    const r = inferToolArgs("timeoutSec=5 command=ls", runCmd);
    expect(r).toEqual({ timeoutSec: 5, command: "ls" });
  });
});

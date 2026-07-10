# Reasonix-Code — Flow Overview

A ground-up map of how the product is built, shipped, and run. Diagrams are
Mermaid (render on GitHub). File references point into the current tree.

This complements `ARCHITECTURE.md` (design philosophy + module layout). Here
the focus is **flow**: who calls whom, and where data goes.

---

## 1. The big picture

Reasonix-Code is one agent loop with multiple front-ends and one shipping unit
(the npm package). The desktop app is a thin native shell that installs the
same package and loads its runtime dashboard.

```mermaid
flowchart LR
    subgraph SHIP["Ship to users"]
        NPM["npm: reasonix-code<br/>(CLI + dashboard/dist + grammars)"]
        DESK["Desktop shell<br/>Tauri · manual build · build# suffix"]
    end

    subgraph FRONT["Front-ends (same loop)"]
        TUI["Terminal TUI<br/>Ink (packages/ink)"]
        DASH["Dashboard<br/>Vite/React in browser"]
        ACPF["ACP client<br/>(editor)"]
        CHAN["Channels<br/>Telegram / Weixin / QQ"]
    end

    subgraph CORE["Agent kernel (src/)"]
        LOOP["CacheFirstLoop<br/>src/loop.ts"]
        REPAIR["Tool-call repair<br/>src/repair/"]
        TOOLS["ToolRegistry<br/>src/tools.ts + tools/"]
        CTX["ContextManager<br/>src/context-manager.ts"]
    end

    subgraph EXT["External"]
        DS["DeepSeek API<br/>src/client.ts (SSE)"]
        MCP["MCP servers<br/>src/mcp/"]
        FS["Workspace FS<br/>+ code-query / semantic"]
    end

    subgraph STORE["Persistence (~/.reasonix)"]
        SESS["sessions/*.jsonl + meta"]
        TRANS["transcripts + usage.jsonl"]
        MEM["memory/ + REASONIX.md"]
    end

    NPM --> TUI
    NPM --> DASH
    DESK -. "npm install -g reasonix-code" .-> NPM
    DESK -- "spawn: reasonix-code code" --> TUI

    TUI --- LOOP
    DASH --- LOOP
    ACPF --- LOOP
    CHAN --- LOOP

    LOOP --> CTX
    LOOP --> REPAIR
    LOOP --> TOOLS
    LOOP <--> DS
    TOOLS <--> MCP
    TOOLS <--> FS
    LOOP --> SESS
    LOOP --> TRANS
    LOOP --> MEM
```

Key idea: **one loop, many sinks.** `CacheFirstLoop.step()` yields `LoopEvent`s
that fan out to the terminal (Ink), the browser (HTTP/SSE), ACP, and channel
bots — all reading the same underlying store.

---

## 2. Distribution & install flow

```mermaid
flowchart TD
    TAG["git push tag v*"] --> REL["workflow: release.yml<br/>build + npm publish"]
    REL -->|publish| REG["npm registry<br/>reasonix-code"]

    MANUAL["Actions: Build desktop<br/>(workflow_dispatch)"] --> DWF["workflow: desktop.yml<br/>win/mac/linux parallel"]
    DWF -->|asset build# N| DREL["rolling release<br/>desktop-latest"]

    REG --> CLI1["User: npm i -g reasonix-code"]
    REG --> CLI2["Desktop shell: npm i -g --prefix ~/.reasonix-code/npm-global reasonix-code@latest"]
    DREL --> CLI3["User: download reasonix-code-desktop-*.exe"]

    CLI1 --> RUN1["reasonix-code code ."]
    CLI3 --> RUN2["launch desktop shell"]
    RUN2 -. auto-install/upgrade .-> CLI2
```

- **CLI ships via npm**, triggered by a `v*` tag (`.github/workflows/release.yml`).
  The tarball includes `dist/`, `dashboard/dist`, `dashboard/index.html`,
  `dashboard/app.css`, tree-sitter grammars (`package.json` `files:`).
- **Desktop ships separately**, only on manual trigger
  (`.github/workflows/desktop.yml`). The shell does **not** follow tags; each
  build is distinguished by a `${{ github.run_number }}` suffix and lands in the
  rolling `desktop-latest` release.
- The desktop installer is ~2 MB: it bundles **only the splash**; the real UI
  is loaded at runtime from the CLI.

---

## 3. Desktop shell runtime flow

`desktop/src-tauri/src/main.rs` + `desktop/app.js`. The shell’s only job:
detect → install/upgrade (via npm, **with a prompt**) → spawn the CLI → load
its dashboard URL in the webview.

```mermaid
flowchart TD
    START["App start<br/>main.rs main()"] --> SETUP["setup: plugins · listen cli:url · HiDPI clamp<br/>main.rs:703"]
    SETUP --> SPLASH["webview: splash<br/>index.html + app.js"]
    SPLASH --> CHK["check_environment<br/>node≥22? npm? find_cli?<br/>main.rs:245"]

    CHK -- "no Node" --> NODE["button: Install Node.js<br/>install_node → browser<br/>main.rs:286"]
    CHK -- "no CLI" --> ASKINSTALL["button: Install reasonix-code<br/>(user clicks)"]
    CHK -- "CLI present" --> VER["latest_cli_version<br/>npm view reasonix-code version<br/>main.rs:267"]
    VER -- "local < latest" --> ASKUP["buttons: Upgrade / Continue<br/>(user chooses) app.js:171"]
    VER -- "up to date" --> LAUNCH

    ASKINSTALL --> INSTALL["install_cli<br/>npm i -g --prefix ~/.reasonix-code/npm-global reasonix-code@latest<br/>main.rs:341"]
    ASKUP -- Upgrade --> INSTALL
    ASKUP -- Continue --> LAUNCH
    INSTALL -- "install:done ok" --> LAUNCH["launch_backend<br/>main.rs:410"]

    LAUNCH --> FIND["find_cli: REASONIX_CLI → prefix → PATH<br/>main.rs:458"]
    FIND --> SPAWN["spawn_tui: reasonix-code code <cwd><br/>CREATE_NO_WINDOW · main.rs:518"]
    SPAWN --> DRAIN["drain stdout · scan stderr<br/>main.rs:545"]
    DRAIN --> PARSE["parse_dashboard_url: '/dashboard' + '→ http://…'<br/>main.rs:503"]
    PARSE --> EMIT["emit cli:url<br/>main.rs:727"]
    EMIT --> NAV["webview navigate → http://127.0.0.1:PORT/dashboard<br/>main.rs:671"]
```

Notes:
- Every spawned process uses `CREATE_NO_WINDOW` on Windows, so install/launch
  never pops a console (`main.rs:138,193,277,349,529`).
- The shell never bundles the dashboard; it discovers the URL the CLI prints to
  stderr and navigates there. Upgrade is **user-confirmed**, never automatic.
- `find_cli` honors `REASONIX_CLI` for developer override, then the managed
  prefix, then `PATH`.

---

## 4. CLI entry & command dispatch

```mermaid
flowchart LR
    BIN["reasonix-code<br/>dist/cli/index.js"] --> BOOT["boot guards<br/>node-version · heap · strip-bel · proxy<br/>cli/index.ts:3-61"]
    BOOT --> CMD["commander<br/>cli/index.ts:157"]
    CMD --> CODE["code [dir]<br/>commands/code.tsx"]
    CMD --> CHAT["chat<br/>commands/chat.tsx"]
    CMD --> RUN["run <task><br/>commands/run.ts"]
    CMD --> ACP["acp<br/>commands/acp.ts"]
    CMD --> UTIL["stats · sessions · replay · diff<br/>mcp · doctor · commit · update · index"]

    CODE --> TOOLSET["buildCodeToolset(rootDir)<br/>code/setup.ts:64"]
    TOOLSET --> CHAT
    CHAT --> ROOT["render(<App/>)<br/>commands/chat.tsx:457"]
    RUN --> LOOP2["new CacheFirstLoop<br/>run.ts:144"]
    ROOT --> APP["App.tsx builds<br/>DeepSeekClient + ImmutablePrefix + CacheFirstLoop<br/>App.tsx:1009-1048"]
    ACP --> LOOP3["CacheFirstLoop<br/>acp.ts:181"]
    APP --> STEPR["for await ev of loop.step()<br/>App.tsx:3470"]
```

The TUI boundary (`App.tsx`) is where the loop is actually constructed for
interactive use; `run` and `acp` build it inline for headless/bridge use.

---

## 5. The agent loop (one turn)

`CacheFirstLoop.step()` in `src/loop.ts`, built on the three cache regions from
`src/memory/runtime.ts`.

```mermaid
flowchart TD
    IN["user input"] --> GATE["budget gate (80/100%)<br/>loop.ts:742"]
    GATE --> HEAL["fixToolCallPairing + reset storm<br/>loop.ts:815"]
    HEAL --> FOLD0{"turn-start ratio<br/>> threshold?<br/>loop.ts:843"}
    FOLD0 -- yes --> FOLD1["ContextManager.fold<br/>context-manager.ts:325"]
    FOLD0 -- no --> ITER
    FOLD1 --> ITER["for iter = 0..maxIter<br/>loop.ts:875"]

    ITER --> BUILD["buildMessages = prefix.toMessages + apiReady(log)<br/>loop.ts:942,586"]
    BUILD --> CALL{"stream?"}
    CALL -- yes --> SSE["streamModelResponse → client.stream (SSE)<br/>loop/streaming.ts:36"]
    CALL -- no --> CHAT2["client.chat<br/>client.ts:283"]
    SSE --> PRO{"<<<NEEDS_PRO>>>?<br/>loop.ts:1054"}
    CHAT2 --> PRO
    PRO -- yes --> ESC["swap to v4-pro this turn · continue<br/>loop.ts:776"]
    PRO -- no --> REPAIR
    ESC --> REPAIR["repair.process(scavenge→truncation→storm)<br/>repair/index.ts:53 · loop.ts:1112"]
    REPAIR --> PERSIST["appendAndPersist assistant<br/>loop.ts:365"]
    PERSIST --> CALLS{"tool calls?"}
    CALLS -- no --> DONE["done"]
    CALLS -- yes --> DISPATCH["dispatchToolCallsChunked<br/>parallelSafe chunks + serial barrier<br/>loop/dispatch.ts:32"]
    DISPATCH --> AFTER["ContextManager.decideAfterUsage<br/>fold / exit-with-summary<br/>loop.ts:1195"]
    AFTER --> ITER
```

The three cache regions (`src/memory/runtime.ts`):

| Region | Mutability | Contents | Used by |
|---|---|---|---|
| `ImmutablePrefix` | fixed per session | system + sorted tool specs + few-shots | `buildMessages` |
| `AppendOnlyLog` | append-only (windowed + disk) | assistant/tool turns in order | persisted per session |
| `VolatileScratch` | reset each turn | R1 reasoning, transient plan | never sent upstream |

Cost controls wired into the loop: flash-first defaults (`src/config.ts:31`),
turn-end auto-compaction (`ContextManager`), `<<<NEEDS_PRO>>>` self-escalation
(`prompt-fragments.ts:12`), soft USD budget gate.

---

## 6. One loop, two sinks

```mermaid
flowchart LR
    LOOP["CacheFirstLoop.step()<br/>yields LoopEvent"] --> FAN{"App.tsx:3470<br/>for await ev"}

    FAN -->|role dispatch| TUIH["handle* hooks<br/>App.tsx:3520-3624"]
    TUIH --> STORE["agentStore.dispatch<br/>state/reducer.ts"]
    STORE --> INK["Ink render<br/>packages/ink → terminal"]

    FAN -->|loopEventToDashboard| BSE["broadcastDashboardEvent<br/>App.tsx:1330"]
    BSE --> SSE["SSE /api/events<br/>server/api/events.ts"]
    SSE --> BROWSER["EventSource → dashboard App<br/>dashboard/src/"]

    FAN --> TRANS["writeTranscript(ev) → JSONL"]
    FAN --> CTXB["ctx_breakdown broadcast"]
```

The dashboard HTTP server (`src/server/index.ts`):
- `startDashboardServer` binds `127.0.0.1` on an ephemeral port with a per-boot
  token; builds `http://host:port/?token=…` (`server/index.ts:221`).
- Routes: `/` SPA, `/assets/*` (serves `dashboard/dist`, rewrites imports/CSS
  with the token), `/api/events` (SSE), `/api/*` (`server/router.ts`).
- `DashboardContext` (`server/context.ts`) is the live seam: subscribe events,
  submit prompt, abort turn, stats, modal resolvers, switch session.

The printed `→ http://127.0.0.1:…/dashboard…` line is what the desktop shell
scrapes to know where to navigate.

---

## 7. Integrations & persistence

```mermaid
flowchart TD
    LOOP["CacheFirstLoop"] --> TOOLS["ToolRegistry"]
    TOOLS --> BUILTIN["built-ins<br/>filesystem · shell · web · memory<br/>skills · subagent · plan · code_query<br/>(parallelSafe: true)"]
    TOOLS --> MCPT["MCP-bridged tools<br/>src/mcp/registry.ts<br/>(parallelSafe default: false)"]
    TOOLS --> SEM["semantic_search<br/>src/index/semantic<br/>(parallelSafe: true)"]

    MCP["MCP servers<br/>stdio / sse / streamable-http"] --> MCPT
    MCPT -. handshake cache .-> MCPHC["~/.reasonix/mcp-handshake/<br/>(preserves prefix cache)"]

    LOOP --> PORTS["ports/*<br/>model-client · tool-host · memory-store<br/>checkpoint-store · event-sink · hook-runner"]
    PORTS --> DS["DeepSeek adapter"]

    LOOP --> SESS["sessions/<slug>/*.jsonl + meta<br/>memory/session.ts"]
    LOOP --> TR["transcripts + usage.jsonl<br/>transcript/ · telemetry/usage.ts"]
    LOOP --> MEM["memory/global · memory/<project><br/>+ REASONIX.md stack<br/>memory/user.ts · project.ts"]
    TOOLS --> CQ["code-query<br/>web-tree-sitter + dist/grammars<br/>code-query/"]
    SEM --> SEMIDX["<root>/.reasonix/semantic/<br/>JSONL + cosine scan"]
```

Storage roots (all under `~/.reasonix/` unless noted):

| What | Where | Source |
|---|---|---|
| Sessions (memory) | `sessions/<slug>/*.jsonl` + `.meta.json` sidecars | `src/memory/session.ts` |
| Transcripts (receipts) | transcript JSONL | `src/transcript/` |
| Usage rollup | `usage.jsonl` (5 MB / 365-day compaction) | `src/telemetry/usage.ts` |
| User/project memory | `memory/global`, `memory/<projectHash>` | `src/memory/user.ts` |
| Project memory | `REASONIX.md → CLAUDE.md → AGENTS.md` | `src/memory/project.ts` |
| MCP handshake cache | `mcp-handshake/` | `src/mcp/handshake-cache.ts` |
| Semantic index | `<root>/.reasonix/semantic/` | `src/index/semantic/` |
| Config | `config.json` | `src/config.ts` |

---

## 8. Where things live (quick index)

| Concern | Path |
|---|---|
| Agent loop | `src/loop.ts`, `src/loop/` (streaming, dispatch, force-summary) |
| Cache regions | `src/memory/runtime.ts` |
| Repair pipeline | `src/repair/` (scavenge, flatten, truncation, storm) |
| Tools | `src/tools.ts`, `src/tools/`, `src/code/setup.ts` |
| DeepSeek client | `src/client.ts` |
| TUI | `packages/ink`, `src/cli/ui/` (App.tsx, state/, hooks/) |
| Dashboard | `dashboard/` (served by `src/server/`) |
| Desktop shell | `desktop/src-tauri/src/main.rs`, `desktop/app.js` |
| MCP / ACP | `src/mcp/`, `src/acp/` |
| Code intel | `src/code-query/`, `src/index/semantic/` |
| Persistence | `src/memory/`, `src/transcript/`, `src/telemetry/` |
| Channels | `src/telegram/`, `src/weixin/`, `src/qq/` |
| Config/env | `src/config.ts`, `src/env.ts`, `.env.example` |
| Release | `.github/workflows/release.yml` (npm, on `v*` tag) |
| Desktop release | `.github/workflows/desktop.yml` (manual, build# suffix) |

---

## Reading order for a newcomer

1. `docs/ARCHITECTURE.md` — why it is shaped this way (the four pillars).
2. This doc, §5 — the turn loop is the heart; everything else hangs off it.
3. `src/cli/index.ts` → `commands/code.tsx` → `commands/chat.tsx` — how a
   session starts.
4. `src/cli/ui/App.tsx` — where the loop meets the screen and the dashboard.
5. `desktop/src-tauri/src/main.rs` — the thinnest possible native wrapper.

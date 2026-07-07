<p align="center">
  <img src="docs/logo.svg" alt="Reasonix-Code" width="640"/>
</p>

<p align="center">
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="./README.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/Zehee/Reasonix-Code"><img src="https://img.shields.io/github/v/release/Zehee/Reasonix-Code?style=flat-square&color=3fb950&labelColor=161b22&logo=github&logoColor=white" alt="release"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/Zehee/Reasonix-Code?style=flat-square&color=8b949e&labelColor=161b22" alt="license"/></a>
  <a href="./package.json"><img src="https://img.shields.io/node/v/reasonix-code.svg?style=flat-square&color=5fa04e&labelColor=161b22&logo=nodedotjs&logoColor=white" alt="node"/></a>
  <a href="https://github.com/Zehee/Reasonix-Code/stargazers"><img src="https://img.shields.io/github/stars/Zehee/Reasonix-Code?style=flat-square&color=dbab09&labelColor=161b22&logo=github&logoColor=white" alt="stars"/></a>
</p>

<p align="center">
  <a href="https://github.com/Zehee/Reasonix-Code/releases/latest">
    <img src="https://img.shields.io/badge/Download_CLI-blue?style=for-the-badge&logo=github&label=CLI%20.exe" alt="Download CLI"/>
  </a>
  <a href="https://github.com/Zehee/Reasonix-Code/releases/latest">
    <img src="https://img.shields.io/badge/Download_Desktop-blue?style=for-the-badge&logo=windows&label=Desktop%20.msi" alt="Download Desktop"/>
  </a>
</p>

**Reasonix-Code** is a lightweight, transparent, and controllable coding agent for developers who need AI to remember decisions across sessions — no vector databases, knowledge graphs, opaque "AI memory" black boxes, or MCP servers required.

Built-in memory (`remember`, `forget`, `recall_memory`) and 49 native tools covering filesystem, code search, shell, planning, theme tracking, and more — zero external dependencies, ready out of the box.

Built on the cache-first, flash-first loop of DeepSeek-Reasonix, our memory architecture is designed from the ground up for **coding scenarios**: deterministic turn refinement (no LLM), keyword-based search (no embeddings), and cross-session theme tracing in plain JSON files you can read and edit.

> **Status:** Active development. Independently evolved from the Reasonix TypeScript line (v0.x).

---

## The problem

Every coding agent faces the same fundamental fragmentation: **context compaction and session independence tear decisions apart.**

A real example — you spend weeks building an auth module:
- Day 1: decide on JWT + httpOnly cookie (vs localStorage)
- Day 3: implement the login endpoint
- Day 10: adjust cookie policy for Safari compatibility
- Day 30: a new session, and the Agent suggests putting the refresh token in **localStorage** — contradicting the decision made 29 days ago.

Each decision is in a separate session log. Between sessions, they're invisible to the Agent. This isn't a model capability problem — **it's an architecture problem.**

Reasonix-Code's three-layer memory architecture solves this by automatically capturing, indexing, and linking decisions across sessions, so the Agent sees the full timeline before suggesting a contradictory approach.

---

## Key features

### Three-layer memory architecture

Designed for cross-session decision tracing. When you work on a project over weeks, decisions like "why we chose JWT over session cookies" or "Safari cookie policy adjustments" are scattered across multiple sessions. Reasonix-Code automatically captures and links them.

```
┌──────────────────────────────────────────────┐
│  Layer 1: Raw (session logs)                  │
│  ~/.reasonix/sessions/*.jsonl                 │
│  Read-only audit trail                        │
├──────────────────────────────────────────────┤
│  Layer 2: Material Library                    │
│  ~/.reasonix/refined/<ws>.sqlite              │
│  ~/.reasonix/refined/<ws>/searches/*.json     │
│  ~/.reasonix/refined/<ws>/folds/*.json        │
│  Deterministic refinement + search + folds    │
├──────────────────────────────────────────────┤
│  Layer 3: Thematic (topic tracking)           │
│  ~/.reasonix/themes/*.json                    │
│  Cross-session topic timelines                │
└──────────────────────────────────────────────┘
```

### Deterministic refinement (no LLM)

Turn extraction uses keyword rules + Markdown structure analysis. Zero LLM calls, zero external dependencies. Fast, reproducible, explainable.

> Note: refinement no longer runs as a separate gradual denoising loop; it is invoked on demand by `fold()` and `search_context`.

```json
{
  "sessionId": "abcd-...",
  "turnId": 12,
  "summary": "Decided on JWT + httpOnly cookie over localStorage",
  "facts": ["JWT + httpOnly cookie selected"],
  "entities": { "files": ["src/auth/login.ts"], "tools": ["Write", "Edit"], "errors": [] }
}
```

### Search-as-you-scan

`search_context "auth JWT cookie"` hits the SQLite index, clusters adjacent turns (90s time window), and auto-refines unprocessed turns. The search itself builds the material library.

### Cross-session theme tracing

```
tag_theme "auth-flow" with sessionId="..." turnId=12
trace_theme "auth-flow"
  → Timeline of all related decisions, sorted chronologically
  → Even if they span 3 weeks and 8 sessions
```

### Cache-first, flash-first loop

The original DeepSeek optimization core: automatic prefix caching, flash-model line for cost control, aggressive context folding only when needed.

---

## Installation

### Windows (PowerShell)

```powershell
# Download and install (auto-adds to PATH, restart terminal after)
irm https://raw.githubusercontent.com/Zehee/Reasonix-Code/main/install.ps1 | iex
```

### Manual (standalone binary)

```powershell
# Download the latest release
iwr https://github.com/Zehee/Reasonix-Code/releases/latest/download/reasonix-code-v0.1.3.exe -OutFile reasonix.exe
```

---

## Quick start

```bash
# First run: setup wizard guides you through API key configuration.
# After that, cd into your project directory and run:
reasonix              # auto-detects cwd as workspace, enters code mode
reasonix chat         # interactive chat (no filesystem)
```

### From source (Node.js >=22 required)

```bash
git clone https://github.com/Zehee/Reasonix-Code.git
cd Reasonix-Code
npm install
npm run dev code      # code mode
npm run dev chat      # interactive chat
```

---

## Architecture overview

```
src/
├── cli/           Commander.js + Ink TUI
├── code/          Code mode toolset setup
├── tools/         Tool registry (filesystem, shell, memory, refine, theme)
├── refine/        Turn refinement engine (deterministic, no LLM)
├── themes/        Cross-session theme tracking
├── memory/        Session storage, project memory, user memory
├── loop/          CacheFirstLoop, dispatch, healing
├── mcp/           MCP client + transports
└── index/         Index exports
```

### Storage layout

```
~/.reasonix/
├── sessions/                      ← All sessions
│   ├── {workspace-slug}/          ← Workspace-isolated
│   │   ├── active.jsonl           ← Active conversation
│   │   ├── active.denoised.jsonl  ← Denoised evolution skeleton
│   │   ├── active.toolcache.jsonl   ← Pre-compressed shadow (raw tool results)
│   │   ├── active.meta.json       ← Metadata
│   │   ├── 20260701_120000.jsonl  ← Archived history (/new rotation)
│   │   └── 20260701_120000.toolcache.jsonl
│   ├── __chat__/                  ← Non-workspace sessions
│   ├── {root-hash}/checkpoints/   ← Git snapshots before file writes
│   └── *.plan.json, *.pending.json
├── refined/{workspace-slug}/      ← Refined index + fold/search views
│   ├── refined.sqlite
│   ├── folds/*.json               ← Fold views (decision clusters, turn refs)
│   └── searches/*.json            ← search_context snapshots
├── mcp-handshake/                 ← MCP handshake cache (global)
├── memory/                        ← User memory + project memory
└── config.json
```

---

## Cache strategy

Reasonix-Code's **cache-first loop** maximizes DeepSeek prefix-cache hit rate — every cache hit is **50× cheaper** than a miss ($0.0028 vs $0.14 per 1M input tokens). The strategy has three layers:

### 1. Prefix stability

The immutable prefix (system prompt + tool schemas + few-shots) is hashed and kept byte-identical across turns. Key mechanisms:

- **`sortToolSpecs()`** — locale-independent codepoint sort so tool order never shuffles
- **`canonicalizeMcpToolForCache()`** — sort JSON Schema keys recursively so MCP tool schemas are byte-stable
- **`_frozenToolsCache`** — frozen tool-spec snapshot avoids repeated cloning
- **Reasoning continuity** — old `reasoning_content` is not stripped between turns (preserves message content ⇒ cache hit)

### 2. Single-jump folding (no gradual denoising)

**Gradual denoising loops have been removed.** Context management now has only two states:

- **Phase 1: Append-only.** No compression; full tool results are kept.
- **Phase 2: Trigger Fold.** When the context nears its threshold, the entire history is denoised, clustered, and persisted as a fold view; the live prompt then cold-starts with a new four-layer structure.

Post-fold prompt structure:

```
[Fold recursive summary]
  → [Decision clusters / related turn IDs]
  → [Evolution framework: last 30 denoised turns]
  → [Hot zone: last 5 turns full fidelity]
  → [Current turn]
```

| Layer | Scope | Contents | Cache role |
|------|------|------|----------|
| Fold summary | Earlier folds | Recursive strategic summary | Long-term stable, cache hit |
| Decision clusters | Across folds | Decision facts, file refs, turn IDs | Highly stable, cache hit |
| Evolution framework | Pre-fold 30 turns | User intent, tool calls, conclusions | Hits within stable window |
| Hot zone | Last 5 turns | Full user/assistant/tool content | Changes every turn, expected miss |

A fold is a single jump, not a continuous process. After the jump the prefix enters a new stable window and the cache hit rate recovers. Every compressed turn remains restorable via its `turnId` from the archived JSONL or `fold_view.json`.

### 3. Error tolerance

Tool-call errors are handled leniently to avoid wasting turns:

- **`lenientJsonParse()`** — 5 repair strategies (brace wrap, trailing comma, single quotes, unquote keys)
- **`inferToolArgs()`** — fuzzy param name matching (`path` ↔ `file` ↔ `filepath`), function-call style parsing, shell-KV format
- **`fillMissingRequiredParam()`** — auto-fill missing required params with type defaults (string → `""`, number → `0`)
- **`shrinkToolResultForCacheStability()`** — oversized results truncated on append, not mid-turn

### MCP handshake cache

MCP server handshake results are persisted to `~/.reasonix/mcp-handshake/` keyed by a deterministic spec fingerprint (type, command/url, args, env, headers — sorted). On restart, tools register in the same order from cache — no handshake wait, no prefix-cache invalidation.

### Benchmarks

| Metric | Without optimizations | With cache strategy |
|--------|---------------------|-------------------|
| Input cost (20-turn session) | ~$0.037 | ~$0.016 (**57% less**) |
| Turns before 75% fold | ~166 | ~277 (**+67%**) |
| Cache miss on turn switch | 100% (reasoning stripped) | ~20% (reasoning preserved) |
| Session resume cache hit | 0% (content healed) | ~80% (content preserved) |
| MCP tool order restart | Random | Deterministic (cached) |

---

## Relationship to upstream

Reasonix-Code is a fork of [DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix) (TypeScript v0.x line). Key differences:

- **Independent direction** — not bound to the Go rewrite (main-v2) roadmap
- **Three-layer memory** — RFC #5539 design, not the v5 memory model
- **Robustness first** — self-healing session identifiers, redundant metadata, crash-safe writes
- **No npm publish** — distributed via GitHub Releases + `irm`

---

## License

MIT — see [LICENSE](./LICENSE).

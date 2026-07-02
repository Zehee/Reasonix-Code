<p align="center">
  <img src="docs/logo.svg" alt="Reasonix-Code" width="640"/>
</p>

<p align="center">
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/Zehee/Reasonix-Code"><img src="https://img.shields.io/github/v/release/Zehee/Reasonix-Code?style=flat-square&color=3fb950&labelColor=161b22&logo=github&logoColor=white" alt="release"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/Zehee/Reasonix-Code?style=flat-square&color=8b949e&labelColor=161b22" alt="license"/></a>
  <a href="./package.json"><img src="https://img.shields.io/node/v/reasonix-code.svg?style=flat-square&color=5fa04e&labelColor=161b22&logo=nodedotjs&logoColor=white" alt="node"/></a>
  <a href="https://github.com/Zehee/Reasonix-Code/stargazers"><img src="https://img.shields.io/github/stars/Zehee/Reasonix-Code?style=flat-square&color=dbab09&labelColor=161b22&logo=github&logoColor=white" alt="stars"/></a>
</p>

**Reasonix-Code** is a TypeScript coding agent that remembers decisions across sessions. Built on the cache-first, flash-first loop of DeepSeek-Reasonix, with a new three-layer memory architecture for cross-session theme tracing.

> **Status:** Active development. Based on the Reasonix TypeScript line (v0.x), independently evolved.

---

## Why not just use DeepSeek-Reasonix?

The upstream [DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix) is a general-purpose agent platform. Its Go rewrite (main-v2) uses a pooled session model where all conversations mix into one store, distinguished by topic IDs.

Reasonix-Code takes a different approach:

| | DeepSeek-Reasonix (main-v2) | Reasonix-Code |
|---|---|---|
| Session model | Pooled with topicId | Independent files, self-contained |
| Cross-session recall | Manual topic management | Automatic refinement + search |
| Memory architecture | v5 memory + topics | Three-layer: Raw → Material → Thematic |
| Design philosophy | Minimal changes | Robustness first, self-healing |

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
│  ~/.reasonix/searches/*.json                  │
│  Deterministic turn refinement + search       │
├──────────────────────────────────────────────┤
│  Layer 3: Thematic (topic tracking)           │
│  ~/.reasonix/themes/*.json                    │
│  Cross-session topic timelines                │
└──────────────────────────────────────────────┘
```

### Deterministic refinement (no LLM)

Turn extraction uses keyword rules + Markdown structure analysis. Zero LLM calls, zero external dependencies. Fast, reproducible, explainable.

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
# Download and run the installer
irm https://raw.githubusercontent.com/Zehee/Reasonix-Code/main/install.ps1 | iex

# Optionally add to PATH
irm https://raw.githubusercontent.com/Zehee/Reasonix-Code/main/install.ps1 | iex
.\install.ps1 -AddToPath
```

### Manual (standalone binary)

```powershell
# Download the latest release
irm https://github.com/Zehee/Reasonix-Code/releases/latest/download/reasonix-code.exe -o reasonix-code.exe
```

### From source (Node.js ≥22 required)

```bash
git clone https://github.com/Zehee/Reasonix-Code.git
cd Reasonix-Code
npm install
npm run build     # tsup bundling
npm run dev       # run directly
```

---

## Quick start

```bash
# Interactive chat
npx tsx src/cli/index.ts chat

# Code mode with full toolset
npx tsx src/cli/index.ts code

# Build standalone binary
npm run build:binary
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

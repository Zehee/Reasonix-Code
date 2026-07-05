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

**Reasonix-Code** is a lightweight, transparent, and controllable coding agent purpose-built for developers who want their AI to remember decisions across sessions — without the overhead of vector databases, knowledge graphs, or opaque "AI memory" black boxes.

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
# Download and install (auto-adds to PATH, restart terminal after)
irm https://raw.githubusercontent.com/Zehee/Reasonix-Code/main/install.ps1 | iex
```

### Manual (standalone binary)

```powershell
# Download the latest release
iwr https://github.com/Zehee/Reasonix-Code/releases/latest/download/reasonix-code-v0.1.0.exe -OutFile reasonix.exe
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

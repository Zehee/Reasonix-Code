# Reasonix-Code

<p align="center">
  <img src="desktop/icons/source.svg" alt="Reasonix-Code" width="200"/>
</p>

<p align="center">
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="./README.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/Zehee/Reasonix-Code/releases/latest"><img src="https://img.shields.io/github/v/release/Zehee/Reasonix-Code?style=flat-square&color=3fb950&labelColor=161b22&logo=github&logoColor=white" alt="release"/></a>
</p>

<p align="center">
  Desktop downloads: <a href="https://github.com/Zehee/Reasonix-Code/releases/latest/download/reasonix-code-desktop-windows.exe">Windows</a> | <a href="https://github.com/Zehee/Reasonix-Code/releases/latest/download/reasonix-code-desktop-macos.dmg">macOS</a> | <a href="https://github.com/Zehee/Reasonix-Code/releases/latest/download/reasonix-code-desktop-linux.deb">Linux</a>
</p>

> **Reasonix-Code** is a lightweight, transparent, and controllable coding agent for developers who need AI to remember decisions across sessions — no vector databases, knowledge graphs, opaque "AI memory" black boxes, or MCP servers required.

---

## Key features

- **Three-layer memory architecture** — Raw JSONL logs → SQLite refinement index → cross-session theme tracing, all plain files you can read and edit
- **49 native tools** — File operations, code search, shell execution, plan management, theme tracking, ready out of the box
- **Cache-first loop** — Maximizes DeepSeek prefix cache hit rate; every cache hit is 50× cheaper than a miss
- **Desktop app** — Multi-workspace tabs, CLI crash toasts, new tab focus, ~3 MB installer
- **Robustness first** — Self-healing session IDs, crash-safe writes, .bak fallback chain
- **Multi-channel** — Telegram / Weixin / QQ channel adapters

---

## Quick start

### Installation

Requires **Node.js >= 22**.

```bash
npm install -g reasonix-code
```

### Usage

```bash
# Setup wizard (first run)
reasonix-code setup

# Enter code mode (auto-detects current directory as workspace)
reasonix-code code

# Enter chat mode (no filesystem access)
reasonix-code chat

# View help
reasonix-code --help
```

### Desktop

```bash
# Install desktop app (~3 MB)
# Download: https://github.com/Zehee/Reasonix-Code/releases/tag/desktop-latest

# After launching, the desktop app automatically:
# 1. Detects/installs Node.js (if missing)
# 2. Detects/installs reasonix-code CLI
# 3. Opens multi-workspace tabs interface
```

---

## Command reference

### CLI subcommands

| Subcommand | Purpose |
|---|---|
| `reasonix-code code [dir]` | Code mode (file edits, plan mode, review gate) |
| `reasonix-code chat` | Chat mode (no filesystem access) |
| `reasonix-code run <task>` | Headless execution (CI-friendly) |
| `reasonix-code setup` | Interactive setup wizard |
| `reasonix-code sessions [name]` | List/open saved sessions |
| `reasonix-code prune-sessions` | Delete sessions older than N days |
| `reasonix-code replay <transcript>` | Replay JSONL transcript |
| `reasonix-code diff <a> <b>` | Compare two transcripts |
| `reasonix-code events <name>` | View session events |
| `reasonix-code stats [transcript]` | One-shot cost/cache analysis |
| `reasonix-code doctor` | Health check |
| `reasonix-code commit` | Generate commit message |
| `reasonix-code mcp` | MCP server management |
| `reasonix-code index` | Build semantic index |
| `reasonix-code version` / `reasonix-code update` | Version info |

### Runtime flags

| Flag | Purpose |
|---|---|
| `--no-session` | Don't persist session |
| `--session <name>` | Resume/pin to named session |
| `--continue` | Resume most recent session |
| `--new` | Force new session |
| `--budget <usd>` | Per-session USD cap |
| `--preset <auto\|flash\|pro>` | Model preset |
| `--mcp <spec>` | Attach MCP server |
| `--no-dashboard` | Don't start Dashboard |
| `--profile [path]` | CPU profiling |

### TUI shortcuts

| Key | Purpose |
|---|---|
| `Enter` | Send |
| `Shift+Enter` | Newline |
| `↑` / `↓` | Scroll history |
| `Ctrl+W` | Delete previous word |
| `Esc` | Cancel selection / abort turn |
| `Ctrl+C` | Abort current turn |
| `Tab` | Complete @-mention |

---

## Configuration

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DEEPSEEK_API_KEY` | - | DeepSeek API Key |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API endpoint |
| `REASONIX_LOG_LEVEL` | `INFO` | Log level |
| `REASONIX_PARALLEL_MAX` | `3` | Max parallel tool calls |
| `REASONIX_TOOL_DISPATCH` | - | Force serial dispatch |

### Configuration file

`~/.reasonix/config.json` stores user configuration.

---

## Storage layout

```
~/.reasonix/
├── sessions/                      ← All sessions
│   ├── {workspace-slug}/          ← Workspace-isolated
│   │   ├── active.jsonl           ← Active session
│   │   ├── {sessionId}__archive_{ts}.jsonl  ← Archived raw session
│   │   ├── {sessionId}.toolcache.jsonl     ← Tool result cache
│   │   └── {sessionId}.meta.json           ← Metadata
│   └── __chat__/                  ← Non-workspace sessions
├── refined/{workspace-slug}/      ← Refinement index
│   ├── refined.sqlite
│   ├── folds/*.json               ← Fold views
│   └── searches/*.json            ← Search views
├── mcp-handshake/                 ← MCP handshake cache
├── memory/                        ← User memory + project memory
└── config.json                    ← Global config
```

---

## Troubleshooting

### Common issues

| Problem | Solution |
|---|---|
| `command not found: reasonix-code` | Run `npm install -g reasonix-code` and restart terminal |
| Desktop can't start CLI | Check Node.js >= 22 is installed |
| Dashboard inaccessible | Check token in URL (`?token=...`) |
| Low cache hit rate | Check `--preset` is `flash`, check tool results aren't truncated |

### Logs

```bash
# Enable debug logging
REASONIX_LOG_LEVEL=DEBUG reasonix-code code

# View session events
reasonix-code events <session-name>

# Health check
reasonix-code doctor
```

---

## Development

```bash
git clone https://github.com/Zehee/Reasonix-Code.git
cd Reasonix-Code
npm install
npm run dev code      # Development mode
npm test              # Run tests
npm run lint          # Lint
npm run typecheck     # Type check
```

---

## Relationship to upstream

Reasonix-Code is a fork of [Reasonix](https://github.com/Reasonix/Reasonix) (TypeScript / Node.js line). Key differences:

- **Independent evolution** — not following the upstream Go rewrite
- **Three-layer memory** — plain file architecture, no vector databases
- **Desktop experience** — multi-workspace, CLI crash toasts, tab focus
- **Robustness** — self-healing session IDs, crash-safe writes

---

## License

MIT — see [LICENSE](./LICENSE).
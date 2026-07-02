<p align="center">
  <img src="docs/logo.svg" alt="Reasonix-Code" width="640"/>
</p>

<p align="center">
  <a href="./README.md">English</a>
  &nbsp;·&nbsp;
  <strong>简体中文</strong>
</p>

<p align="center">
  <a href="https://github.com/Zehee/Reasonix-Code"><img src="https://img.shields.io/github/v/release/Zehee/Reasonix-Code?style=flat-square&color=3fb950&labelColor=161b22&logo=github&logoColor=white" alt="release"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/Zehee/Reasonix-Code?style=flat-square&color=8b949e&labelColor=161b22" alt="license"/></a>
  <a href="./package.json"><img src="https://img.shields.io/node/v/reasonix-code.svg?style=flat-square&color=5fa04e&labelColor=161b22&logo=nodedotjs&logoColor=white" alt="node"/></a>
  <a href="https://github.com/Zehee/Reasonix-Code/stargazers"><img src="https://img.shields.io/github/stars/Zehee/Reasonix-Code?style=flat-square&color=dbab09&labelColor=161b22&logo=github&logoColor=white" alt="stars"/></a>
</p>

**Reasonix-Code** 是一个轻量、透明、可控的编程 agent，专为需要 AI 记住跨 session 决策的开发者设计——不需要向量数据库、知识图谱或黑盒式的"AI 记忆"。

基于 DeepSeek-Reasonix 的 cache-first、flash-first 循环核心，我们的记忆架构从零开始为 **编程场景** 设计：确定性提炼（不用 LLM）、关键词搜索（不用 embedding）、跨 session 主题追溯（纯 JSON 文件，可读可改）。

> **状态：** 活跃开发中。基于 Reasonix TypeScript 分支（v0.x），独立演进。

---

## 问题所在

每个 coding agent 都面临同一个根本断裂：**上下文压缩和会话独立让决策碎片化。**

一个真实的例子——你花数周做一个认证模块：
- 第 1 天：决定用 JWT + httpOnly cookie（而不是 localStorage）
- 第 3 天：实现登录接口
- 第 10 天：为 Safari 兼容调整 cookie 策略
- 第 30 天：新 session 启动，Agent 竟然建议把 refresh token 放 **localStorage** —— 与 29 天前的决策直接矛盾。

每一条决策都在独立的 session 日志里，跨 session 时 Agent 看不见。这不是模型能力问题——**这是架构问题。**

Reasonix-Code 的三层记忆架构通过自动捕获、索引和关联跨 session 的决策来解决这个问题，让 Agent 在提出矛盾建议前先看到完整的时间线。

---

## 核心能力

### 三层记忆架构

专为跨 session 决策追溯设计。当你花数周做一个项目时，"为什么选 JWT 而不是 session cookie"、"Safari cookie 策略调整"等决策散落在多个 session 中。Reasonix-Code 自动捕获并串联它们。

```
┌──────────────────────────────────────────────┐
│  第一层：原始日志                              │
│  ~/.reasonix/sessions/*.jsonl                 │
│  只读审计                                     │
├──────────────────────────────────────────────┤
│  第二层：材料库                                │
│  ~/.reasonix/refined/<ws>.sqlite              │
│  ~/.reasonix/searches/*.json                  │
│  确定性提炼 + 跨 session 搜索                  │
├──────────────────────────────────────────────┤
│  第三层：主题关联                               │
│  ~/.reasonix/themes/*.json                    │
│  跨 session 的主题时间线                        │
└──────────────────────────────────────────────┘
```

### 确定性提炼（不用 LLM）

基于关键词规则 + Markdown 结构分析。零 LLM 调用、零外部依赖。快速、可复现、可解释。

```json
{
  "sessionId": "abcd-...",
  "turnId": 12,
  "summary": "决定用 JWT + httpOnly cookie，不用 localStorage",
  "facts": ["JWT + httpOnly cookie 方案胜出"],
  "entities": { "files": ["src/auth/login.ts"], "tools": ["Write", "Edit"], "errors": [] }
}
```

### 搜索即打捞

`search_context "auth JWT cookie"` 命中 SQLite 索引后，自动将相邻 turn 按时间窗口聚簇（90 秒），并提炼未处理的 turn。搜索本身就在构建材料库。

### 跨 session 主题追溯

```
tag_theme "auth-flow" with sessionId="..." turnId=12
trace_theme "auth-flow"
  → 按时间线展示所有相关决策
  → 即使跨越 3 周、8 个 session
```

### Cache-first 循环

继承 DeepSeek 核心优化：自动前缀缓存、flash 模型成本控制、智能上下文折叠。

---

## 安装

### Windows (PowerShell)

```powershell
# 下载并执行安装脚本
irm https://raw.githubusercontent.com/Zehee/Reasonix-Code/main/install.ps1 | iex

# 加入 PATH
irm https://raw.githubusercontent.com/Zehee/Reasonix-Code/main/install.ps1 | iex
.\install.ps1 -AddToPath
```

### 独立二进制

```powershell
irm https://github.com/Zehee/Reasonix-Code/releases/latest/download/reasonix-code.exe -o reasonix-code.exe
```

### 源码运行（需 Node.js ≥22）

```bash
git clone https://github.com/Zehee/Reasonix-Code.git
cd Reasonix-Code
npm install
npm run build
npm run dev
```

---

## 快速开始

```bash
# 交互式对话
npx tsx src/cli/index.ts chat

# 代码模式（完整工具集）
npx tsx src/cli/index.ts code

# 打包独立二进制
npm run build:binary
```

---

## 架构概览

```
src/
├── cli/           Commander.js + Ink TUI
├── code/          代码模式工具集装配
├── tools/         工具注册（文件系统、shell、记忆、提炼、主题）
├── refine/        对话轮次提炼引擎（确定性，不用 LLM）
├── themes/        跨 session 主题追踪
├── memory/        会话存储、项目记忆、用户记忆
├── loop/          CacheFirstLoop、调度、修复
├── mcp/           MCP 客户端 + 传输层
└── index/         导出入口
```

---

## 与上游的关系

Reasonix-Code 是 [DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix)（TypeScript v0.x 分支）的一个 fork。主要区别：

- **独立方向** — 不跟随 Go 重写版本（main-v2）的路线
- **三层记忆** — 实现 RFC #5539 设计，不采用 v5 memory 模型
- **鲁棒性优先** — 自愈 session ID、冗余元数据、崩溃安全写入
- **不发 npm 包** — 通过 GitHub Releases + `irm` 分发

---

## 许可证

MIT — 见 [LICENSE](./LICENSE)。

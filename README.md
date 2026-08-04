# Reasonix-Code

<p align="center">
  <img src="desktop/icons/source.svg" alt="Reasonix-Code" width="200"/>
</p>

<p align="center">
  <a href="./README.en.md">English</a>
  &nbsp;·&nbsp;
  <strong>简体中文</strong>
</p>

<p align="center">
  <a href="https://github.com/Zehee/Reasonix-Code/releases/latest"><img src="https://img.shields.io/github/v/release/Zehee/Reasonix-Code?style=flat-square&color=3fb950&labelColor=161b22&logo=github&logoColor=white" alt="release"/></a>
</p>

<p align="center">
  桌面版下载：<a href="https://github.com/Zehee/Reasonix-Code/releases/tag/desktop-latest">Windows / macOS / Linux</a>
</p>

> **Reasonix-Code** 是一个轻量、透明、可控的编程 agent，专为需要 AI 记住跨 session 决策的开发者设计——不需要向量数据库、知识图谱、黑盒式的"AI 记忆"，也不需要安装任何 MCP 服务器。

---

## 核心特性

- **三层记忆架构** — 原始 JSONL 日志 → SQLite 提炼索引 → 跨 session 主题追溯，纯文件可读可改
- **主题追踪** — 跨 session 标记决策（`tag_theme`），追溯完整演进时间线（`trace_theme`），即使跨越数周、多个 session 也能串联
- **49 个原生工具** — 文件操作、代码搜索、Shell 执行、计划管理、主题追踪，开箱即用
- **Cache-first 循环** — 最大化 DeepSeek 前缀缓存命中率，每次缓存命中比未命中便宜 50 倍
- **桌面版** — 多工作区 tabs、CLI 崩溃提示、新建 tab 聚焦，约 3 MB 安装包
- **鲁棒性优先** — 自愈 sessionId、崩溃安全写入、.bak 回退链
- **多频道** — Telegram / Weixin / QQ 频道适配器

### 主题追踪

**没有主题追踪时会发生什么？**

你花数周做一个认证模块：

```
时间轴
──────────────────────────────────────────────────────►
  第 X 天          数日后          一周后           数周后
   │               │                │                │
   ▼               ▼                ▼                ▼
[JWT 方案]    [登录接口实现]    [Safari 调整]    [新 session 启动]
   │               │                │                │
   ▼               ▼                ▼                ▼
 上下文膨胀 → 早期决策被压缩 → session 边界切断 → Agent 建议 localStorage
```

**问题的本质**：不是 Agent "忘了"，而是**上下文压缩 + session 边界**让早期决策的物理载体（对话轮次）被系统性地销毁。Agent 想记住，但它的"大脑"里已经没有这些信息了。

**主题追踪解决的不是"记忆"，而是"打捞"**——决策过程的原始记录一直躺在 `~/.reasonix/sessions/*.jsonl` 里，只是没有任何机制把它们重新串起来。主题追踪把碎片化的决策重新挂回同一条时间线。

**有了主题追踪后**，Agent 在提出建议前会先追溯 `auth-flow` 主题的完整历史，然后问：

> "我们周一明确排除了 localStorage。周五的调整是为了解决 Safari 问题。你这次修改是想推翻原决策，还是只是补充？"

**工作机制**：

1. **提炼**（自动、零 LLM）— 基于关键词 + Markdown 结构分析，把原始 turn 压缩成结构化摘要，存入 SQLite
2. **搜索**（`search_context`）— 跨 session 关键词命中，按 90 秒时间窗口聚簇，自动提炼未处理的 turn
3. **主题挂载**（`tag_theme`）— 将相关 turn 关联到主题，形成按时间线排列的历史档案
4. **主题追溯**（`trace_theme`）— 查看主题的完整演进过程，可选包含每个 turn 的降噪内容

```bash
# 搜索跨 session 的历史材料
search_context query="auth JWT cookie"

# 标记当前 turn 到主题
tag_theme theme="auth-flow" sessionId="..." turnId=12

# 追溯主题的完整演进时间线
trace_theme theme="auth-flow"

# 包含每个 turn 的降噪内容
trace_theme theme="auth-flow" includeContent=true

# 列出所有主题
list_themes
```

**设计原则**：
- **搜索即权重** — 只提炼被搜索过的内容，无人提及的决策留在原始记录中
- **搜索同时是打捞** — `search_context` 命中未提炼的 turns 时自动触发提炼入库，材料库随着使用自然增长
- **主题只保存引用** — 内容仍存放在材料库和原始日志中，删除主题不会丢失数据

主题存储在 `~/.reasonix/themes/<name>.json`，纯 JSON 可读可改。
---

## 快速开始

### 安装

需要 **Node.js >= 22**。

```bash
npm install -g reasonix-code
```

### 使用

```bash
# 设置向导（首次运行）
reasonix-code setup

# 进入代码模式（自动检测当前目录为工作区）
reasonix-code code

# 查看帮助
reasonix-code --help
```

### 桌面版

```bash
# 安装桌面版（约 3 MB）
# 下载地址：https://github.com/Zehee/Reasonix-Code/releases/tag/desktop-latest

# 桌面版启动后自动：
# 1. 检测/安装 Node.js（如缺失）
# 2. 检测/安装 reasonix-code CLI
# 3. 弹出多工作区 tabs 界面
```

---

## 命令参考

### CLI 子命令

| 子命令 | 用途 |
|---|---|
| `reasonix-code code [dir]` | 代码模式（文件编辑、计划模式、审查门） |
| `reasonix-code run <task>` | Headless 执行（CI 友好） |
| `reasonix-code setup` | 交互式配置向导 |
| `reasonix-code sessions [name]` | 列出/打开保存的会话 |
| `reasonix-code prune-sessions` | 删除超过 N 天的会话 |
| `reasonix-code replay <transcript>` | 回放 JSONL 日志 |
| `reasonix-code diff <a> <b>` | 对比两个日志 |
| `reasonix-code events <name>` | 查看 session 事件 |
| `reasonix-code stats [transcript]` | 一次性成本/缓存分析 |
| `reasonix-code doctor` | 健康检查 |
| `reasonix-code commit` | 生成 commit message |
| `reasonix-code mcp` | MCP 服务器管理 |
| `reasonix-code index` | 构建语义索引 |
| `reasonix-code version` / `reasonix-code update` | 版本信息 |

### 运行时标志

| 标志 | 用途 |
|---|---|
| `--no-session` | 不保存 session |
| `--session <name>` | 恢复/锁定到指定 session |
| `--continue` | 恢复最近 session |
| `--new` | 强制新建 session |
| `--budget <usd>` | 每 session USD 上限 |
| `--preset <auto\|flash\|pro>` | 模型预设 |
| `--mcp <spec>` | 附加 MCP 服务器 |
| `--no-dashboard` | 不启动 Dashboard |
| `--profile [path]` | CPU 性能分析 |

### TUI 快捷键

| 按键 | 用途 |
|---|---|
| `Enter` | 发送 |
| `Shift+Enter` | 换行 |
| `↑` / `↓` | 滚动历史 |
| `Ctrl+W` | 删除前一个词 |
| `Esc` | 取消选择 / 中止当前 turn |
| `Ctrl+C` | 中止当前 turn |
| `Tab` | 补全 @-mention |

---

## 配置

### 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `DEEPSEEK_API_KEY` | - | DeepSeek API Key |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API 地址 |
| `REASONIX_LOG_LEVEL` | `INFO` | 日志级别 |
| `REASONIX_PARALLEL_MAX` | `3` | 最大并行工具调用数 |
| `REASONIX_TOOL_DISPATCH` | - | 强制串行调度 |

### 配置文件

`~/.reasonix/config.json` 存储用户配置。

---

## 存储布局

```
~/.reasonix/
├── sessions/                      ← 所有会话
│   ├── {workspace-slug}/          ← 按工作区隔离
│   │   ├── active.jsonl           ← 当前活跃会话
│   │   ├── {sessionId}__archive_{ts}.jsonl  ← 归档原始会话
│   │   ├── {sessionId}.toolcache.jsonl     ← 工具结果缓存
│   │   └── {sessionId}.meta.json           ← 元数据
│   └── __chat__/                  ← 无工作区会话
├── refined/{workspace-slug}/      ← 提炼索引
│   ├── refined.sqlite
│   ├── folds/*.json               ← fold 视图
│   └── searches/*.json            ← 搜索视图
├── mcp-handshake/                 ← MCP 握手缓存
├── memory/                        ← 用户记忆 + 项目记忆
└── config.json                    ← 全局配置
```

---

## 故障排除

### 常见问题

| 问题 | 解决方案 |
|---|---|
| `command not found: reasonix-code` | 运行 `npm install -g reasonix-code` 并重启终端 |
| 桌面版无法启动 CLI | 检查 Node.js >= 22 是否安装 |
| Dashboard 无法访问 | 检查 token 是否正确（URL 中的 `?token=...`） |
| 缓存命中率低 | 检查 `--preset` 是否为 `flash`，检查 tool result 是否被截断 |

### 日志

```bash
# 启用调试日志
REASONIX_LOG_LEVEL=DEBUG reasonix-code code

# 查看 session 事件
reasonix-code events <session-name>

# 健康检查
reasonix-code doctor
```

---

## 开发

```bash
git clone https://github.com/Zehee/Reasonix-Code.git
cd Reasonix-Code
npm install
npm run dev code      # 开发模式
npm test              # 运行测试
npm run lint          # 代码检查
npm run typecheck     # 类型检查
```

---

## 与上游的关系

Reasonix-Code 是 [Reasonix](https://github.com/Reasonix/Reasonix)（TypeScript / Node.js 分支）的 fork。主要区别：

- **独立演进** — 不跟随上游 Go 重写版本
- **三层记忆** — 纯文件架构，非向量数据库
- **桌面体验** — 多工作区、CLI 崩溃提示、tab 聚焦
- **鲁棒性** — 自愈 sessionId、崩溃安全写入

---

## 许可证

MIT — 见 [LICENSE](./LICENSE)。
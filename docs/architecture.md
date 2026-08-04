# Reasonix-Code 架构

## 项目定位

Reasonix-Code 是 [Reasonix](https://github.com/esengine/DeepSeek-Reasonix)（TypeScript / Node.js 分支）的 fork，独立演进。

**核心改造方向**：
- **独立路线** — 不跟随上游 Go 重写版本（main-v2）
- **三层记忆** — 实现跨 session 决策追溯（原始 JSONL → SQLite 提炼 → 主题 JSON）
- **鲁棒性优先** — 自愈 sessionId、崩溃安全写入、.bak 回退链
- **桌面体验** — 多工作区 tabs、CLI 崩溃提示、新建 tab 聚焦
- **成本控制** — flash-first 默认、`<<<NEEDS_PRO>>>` 自报告升级、预算门

## 与上游的关系

| 维度 | 上游 Reasonix (Node.js) | Reasonix-Code |
|---|---|---|
| 演进路线 | 跟随上游 Go 重写 | 独立演进 |
| 记忆模型 | v5 向量记忆 | 三层文件记忆（JSONL + SQLite + 主题 JSON） |
| 会话恢复 | 基础 .jsonl | .bak 回退链 + 崩溃安全写入 |
| 桌面版 | 无 | Tauri 壳 + 多工作区 tabs |
| 工具修复 | 基础 | 5 策略 lenientJsonParse + fuzzyMatchParamStrict |
| 成本控制 | 基础 | flash-first + auto-compaction + `<<<NEEDS_PRO>>>` |

## 设计哲学

Reasonix-Code 是**面向 DeepSeek 前缀缓存优化的编程 agent**。每一层设计都服务于一个目标：**让模型在不同 session 之间不再自我矛盾**。

核心差异化不是"更聪明的模型"，而是"跨 session 设计决策的可追溯性"。

## 四大核心模块

### 模块 1 — Cache-First 循环

**问题**：DeepSeek 对缓存输入收费仅为未命中的 1/50（0.0028 vs 0.14）。大多数 agent 循环每轮重排/重写/注入时间戳，实际缓存命中率 <20%。

**解决方案**：将上下文分为四个区域：

```
┌─────────────────────────────────────────┐
│ 不可变前缀                               │ ← session 内固定
│  system + tool_specs + few_shots        │   缓存命中候选
├─────────────────────────────────────────┤
│ 只追加日志                               │ ← 单调增长
│  [assistant₁][tool₁][assistant₂]...     │   保留前轮前缀
├─────────────────────────────────────────┤
│ 折叠视图                                 │ ← 按需生成
│  epoch summaries + decision clusters    │   跨 session 搜索
│  + evolution framework + hot zone       │
├─────────────────────────────────────────┤
│ 热区原文                                 │ ← 最近 5 轮
│  完整 user/assistant/tool 内容          │   每轮变化
└─────────────────────────────────────────┘
```

**指标**：`prompt_cache_hit_tokens / (hit + miss)` 每轮暴露，并在 TUI 顶栏显示。

#### 并行工具调度

每个工具声明 `parallelSafe?: boolean`（默认 `false`）。循环调度器将连续的并行安全调用分组到 chunk 中，通过 `Promise.allSettled` 竞争执行；第一个非并行安全调用结束 chunk 单独运行（serial barrier — 保持读后写顺序）。

| 环境变量 | 默认值 | 效果 |
|---|---|---|
| `REASONIX_PARALLEL_MAX` | `3`（硬上限 `16`）| 最大 chunk 大小 |
| `REASONIX_TOOL_DISPATCH=serial` | 未设置 | 强制串行调度 |

### 模块 2 — 三层记忆架构

**问题**：你花数周做一个认证模块——第 1 天决定用 JWT + httpOnly cookie，第 30 天新 session 启动，Agent 竟然建议把 refresh token 放 localStorage。

**解决方案**：

```
┌──────────────────────────────────────────────┐
│  第一层：原始日志                              │
│  ~/.reasonix/sessions/*.jsonl                 │
│  只读审计                                     │
├──────────────────────────────────────────────┤
│  第二层：材料库                                │
│  ~/.reasonix/refined/<ws>/refined.sqlite      │
│  ~/.reasonix/refined/<ws>/searches/*.json     │
│  ~/.reasonix/refined/<ws>/folds/*.json        │
│  确定性提炼 + 跨 session 搜索 + fold 视图      │
├──────────────────────────────────────────────┤
│  第三层：主题关联                               │
│  ~/.reasonix/themes/*.json                    │
│  跨 session 主题时间线                        │
└──────────────────────────────────────────────┘
```

**确定性提炼（不用 LLM）**：基于关键词规则 + Markdown 结构分析。零 LLM 调用、零外部依赖。

**搜索即打捞**：`search_context "auth JWT cookie"` 命中 SQLite 索引后，自动将相邻 turn 按时间窗口聚簇（90 秒），并提炼未处理的 turn。

**跨 session 主题追溯**：

```
tag_theme "auth-flow" sessionId="..." turnId=12
trace_theme "auth-flow"
  → 按时间线展示所有相关决策
  → 即使跨越 3 周、8 个 session
```

### 模块 3 — 工具调用修复

**问题**：DeepSeek 实际故障模式：
- Tool-call JSON 在 `<think>` 中发出，未出现在最终 message
- 参数在 schema >10 个参数或深层嵌套时丢失
- 同一工具重复调用（call-storm）
- JSON 在 `max_tokens` 处截断

**解决方案**：四道修复管线：

1. **`lenientJsonParse`** — 5 种修复策略（包裹花括号、去尾逗号、单引号转双引号、去键引号、单引号 key 补双引号）
2. **`inferToolArgs`** — 模糊参数名匹配（`path` ↔ `file` ↔ `filepath`）、函数调用风格、Shell KV 格式、`fuzzyMatchParamStrict`（精确/大小写/别名三档）
3. **`fillMissingRequiredParam`** — 缺失 required 参数自动填充类型默认值
4. **`StormBreaker`** — 滑动窗口内相同 `(tool, args)` 抑制 + 注入反思 turn

### 模块 4 — 成本控制

**问题**：默认使用 frontier 模型（v4-pro，flash 的 12 倍成本）+ 完整工具结果累积 → 活跃用户每月 $150-$250。

**解决方案**：

#### 4.1 分层默认（flash-first）

| 预设 | 模型 | 费用 |
|---|---|---|
| `flash` | `v4-flash` | 1× |
| `auto`（默认） | `v4-flash` → `v4-pro` 困难 turn | 1–3× |
| `pro` | `v4-pro` | ~12× |

#### 4.2 模型自报告升级（`<<<NEEDS_PRO>>>`）

模型自行决定任务是否超出当前 tier。如果任务确实需要更强推理，模型在响应首行发出 `<<<NEEDS_PRO>>>` 标记。系统中止当前 flash 调用，在 pro 上重试该 turn。

#### 4.3 预算门

每轮检查预算：≥80% 警告，≥100% 拒绝下一轮。

## 模块布局

```
src/
├── client.ts               # DeepSeek 客户端（fetch + SSE）
├── loop.ts                 # CacheFirstLoop 主循环
├── loop/                   # 循环子模块
│   ├── dispatch.ts         # 工具调用调度（并行 chunk + serial barrier）
│   ├── streaming.ts        # SSE 流处理
│   ├── healing.ts          # 崩溃恢复
│   └── force-summary.ts    # 迭代限制后强制摘要
├── repair/                 # 工具调用修复管线（scavenge/flatten/storm）
├── context-manager.ts      # 上下文折叠决策
├── tools/                  # 工具实现
│   ├── filesystem.ts       # 读/列/搜/编辑/写（含 symlink 感知）
│   ├── shell.ts            # run_command + run_background
│   ├── jobs.ts             # 后台进程注册表
│   ├── memory.ts           # remember / forget / list
│   ├── skills.ts           # 技能发现与调用
│   ├── subagent.ts         # 隔离子 agent
│   ├── plan.ts             # 计划提交与审批
│   ├── web.ts              # web_search + web_fetch（多引擎）
│   └── refine.ts           # 提炼搜索
├── repair/                 # 修复管线
│   ├── scavenge.ts         # 从 reasoning_content 抢救 tool call
│   ├── flatten.ts          # 扁平 schema 点号表示
│   ├── truncation.ts       # 截断 JSON 修复
│   └── storm.ts            # call-storm 抑制
├── refine/                 # 对话轮次提炼引擎
├── memory/                 # 会话与记忆存储
│   ├── runtime.ts          # ImmutablePrefix + AppendOnlyLog + VolatileScratch
│   ├── session.ts          # JSONL 持久化（含 .bak 回退）
│   ├── archiver.ts         # 归档策略
│   ├── fold-view.ts        # fold 视图持久化
│   ├── search-view.ts      # 搜索视图持久化
│   ├── project.ts          # REASONIX.md 加载
│   ├── user.ts             # 用户/项目记忆存储
│   └── subdir.ts           # 子目录会话
├── themes/                 # 跨 session 主题追踪
├── mcp/                    # MCP 客户端 + 传输层（stdio + SSE + streamable-http）
├── server/                 # Dashboard HTTP 服务器
├── cli/                    # CLI 入口 + TUI
├── code/                   # 代码模式工具集
├── code-query/             # 基于 web-tree-sitter 的代码查询
├── index/                  # 语义索引（Ollama/OpenAI-compat）
├── qq/                     # QQ 频道适配器
├── telegram/               # Telegram 适配器
├── weixin/                 # 微信适配器
├── acp/                    # Agent Client Protocol
├── telemetry/              # 成本 + 缓存命中统计
└── i18n/                   # 国际化（EN / zh-CN / de / ru / ja）
```

## 设计演进

- **v0.0.x** — Pillar 1 端到端，修复管线完成，Ink TUI 脚手架
- **v0.1.x** — τ-bench 数据发布，流式优化，transcript 回放
- **v0.2.x** — `reasonix-code code` 代码模式，review/auto gate，后台任务，hooks
- **v0.3.x** — MCP 客户端（stdio + SSE + streamable-http），session 持久化
- **v0.4.x** — V4 模型支持，skills，memory，subagents
- **v0.5.x** — 成本控制（flash-first、auto-compaction、`<<<NEEDS_PRO>>>`）
- **v0.6.x** — 三层记忆架构，跨 session 主题追踪
- **v0.7.x** — 桌面版多工作区，workspace tabs
- **v0.8.x** — 鲁棒性优先（自愈 sessionId、崩溃安全写入、.bak 回退）
- **v0.9.x** — 工具调用修复增强（lenientJsonParse 5 策略、fuzzyMatchParamStrict）
- **v0.10.x** — Dashboard 重构（App.tsx 3257→790 行），workspace tabs 替代原生菜单（以上为 DeepSeek-Reasonix 上游历史）
- **v0.1.x / v0.2.x** — Reasonix-Code 独立版本线；当前版本 **0.2.4**

## 明确的非目标

- 多 agent 编排作为一等公民（subagent 是成本降低机制，非协调原语）
- RAG / 向量检索（关键词搜索已足够）
- 非 DeepSeek 后端支持（可通过 `--model` 覆盖，但不测试）
- Web UI / SaaS（Dashboard 是本地嵌入式，非服务）

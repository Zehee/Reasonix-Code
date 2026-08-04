# Prompt 真实性核验报告

> 核验目的：prompt 大多继承自上游，本文核验每个节点声称的工具与逻辑在本项目中是否真实存在、实现状态如何。
> 核验日期：2026-08-04 · 核验范围：全部 21 个 prompt 节点 · 状态图例：✅ 存在 / ⚠️ 部分或措辞偏差 / 🔴 声称无实现 / 🔶 改名
>
> **后续处置（2026-08-04 已完成）**：🔴1 引用校验已实现（src/cli/ui/citation-check.ts + markdown.tsx / markdown-view.tsx 缺失路径渲染红色删除线 ❌）；🔴2 自动升级已实现（src/loop.ts 回合内 repair+tool-error 计数 ≥3 触发 deepseek-v4-pro 重试 + typed breakdown warning，测试 tests/loop-auto-escalation.test.ts）；⚠️1 `ls` 文案已改为 `list_directory`。

## 总览

| 结论 | 数量 | 说明 |
|---|---|---|
| ✅ 存在且一致 | 大多数 | 47 个工具全部真实注册；记忆/技能/折叠/计划/作业等机制齐全 |
| ⚠️ 措辞偏差 | 3 | 引用 `ls`、MCP fallback 语气、前导 `/` 机制描述 |
| 🔴 声称无实现 | 3 | 引用校验、3+ 错误自动升级、子代理带项目记忆（CLI 主路径） |

---

## 🔴 声称无实现（已处置 ✅）

### 1. 引用校验机制 — 影响节点 1、13 — **已实现（2026-08-04）**
- 新增 `src/cli/ui/citation-check.ts`（`setCitationRoot` + `citationPathExists`，无缓存）
- `markdown.tsx` renderInlineText：FILE_REF_RE 命中路径不存在 → 红色删除线 + ❌（不再 OSC8 链接）
- `markdown-view.tsx` RenderSpan：同规则（红删除线 + ❌，去除下划线链接）
- App.tsx 启动时 `setCitationRoot(codeMode.rootDir ?? cwd)`
- 测试：tests/citation-check.test.ts（5 用例）
- 注意：仅 CLI TUI 生效；dashboard 浏览器端未做（服务器无法 stat 客户端 fs 的语义未定）

- **声称**：`src/code/prompt.ts:21` 与 `src/cli/index.ts:69` — "Reasonix VALIDATES citations and broken paths render in **red strikethrough with ❌**"
- **实际**：全库（CLI TUI、dashboard、server）均无链接路径存在性校验。`markdown.tsx:448-453` 的红色删除线只是 `~~del~~` 通用语法渲染；`markdown-lines.ts:35,199-222` 仅拆分 fileRef 做 OSC8 链接，无校验。
- **影响**：模型若依赖系统校验会得到误导；broken path 不会被标记。
- **选项**：A) 实现校验（模型输出后扫描 fileRef 验证路径 → 染红）；B) 修改 prompt 文案（去掉系统校验声称，改为"引用路径应可验证"的模型指导）。

### 2. "3+ repair 错误自动升级" — 影响节点 2 — **已实现（2026-08-04）**
- `src/loop.ts`：回合内计数器 `_autoEscalate`（repair.scavenged+truncationsFixed + tool 错误 `{"error":…}`）
- 模型响应后检查：计数 ≥3 且非 pro → yield typed-breakdown warning（`⇧ auto-escalated … (repair: X, tool errors: Y)`）+ 切 deepseek-v4-pro 重试本回合 + 回合末恢复
- 测试：tests/loop-auto-escalation.test.ts（升级/不升级/恢复 3 用例）

- **声称**：`src/prompt-fragments.ts:24` — "the system also escalates automatically if you hit 3+ repair / SEARCH-mismatch errors in a single turn (the user sees a typed breakdown)"
- **实际**：仅 `<<<NEEDS_PRO>>>` 显式标记触发升级（`src/loop.ts:1069-1071`）；repair 相关只有重复调用抑制（`repair/storm.ts` + loop.ts:265-266），不升级模型；"typed breakdown" 无输出。
- **选项**：A) 实现（loop 内计数 repair/SEARCH 错误 → 达 3 触发与显式标记相同的升级路径 + 输出分类明细）；B) 修改文案（删除自动升级声称）。

### 3. CLI 主会话子代理不带项目记忆 — 设计事实（非 prompt 声称，但影响行为预期）

- **代码**：`src/tools/subagent.ts:467-469` 的 `registerSubagentTool` 会 `applyProjectMemory`，但该函数只在库 API 导出（`src/index.ts:101`），**未被** `buildCodeToolset`（`src/code/setup.ts`）调用——`spawn_subagent` 工具在 `reasonix-code code` 会话中根本不注册。
- **实际子代理路径**（run_skill / explore 等，`setup.ts:119-146`）：`system: skill.body`，无任何记忆追加。
- **影响**：子代理看不到项目记忆/全局记忆；对依赖上下文的技能（如 review 需要 diff 上下文由 task 传入）尚可，但"子代理自动继承记忆"不成立。

---

## ⚠️ 措辞偏差（建议小修）

| # | 位置 | 声称 | 实际 | 建议 |
|---|---|---|---|---|
| 1 | prompt.ts:17 | "don't `ls` / `read_file` to figure out who you are" | 无 `ls` 工具（真实名 `list_directory`） | ✅ 已改 `list_directory`（2026-08-04） |
| 2 | prompt.ts:124 | "If an MCP tool fails or times out, fall back to the built-in" | 无系统级 fallback，纯模型行为指导 | 语气改为 "you may fall back to the built-in"（可选） |
| 3 | prompt.ts:101 | "Never use a leading `/` in arguments — Windows reads it as drive root" | 实现实际拒绝"解析后逃逸 workspace 的路径"（`src/tools/shell/parse.ts:349-360`），前导 `/` 会被相对化处理 | 措辞微调（可选，功能方向一致） |

---

## ✅ 核验通过的重点项

### 工具层（47/47 全部真实注册，无死声明）

- **文件系统**（`src/tools/filesystem.ts`）：read_file / list_directory / directory_tree / search_files / grep / glob / get_file_info / write_file / edit_file / multi_edit / delete_range / delete_symbol / create_directory / move_file / delete_file / delete_directory / copy_file
- **Shell/作业**（`src/tools/shell.ts` + `jobs.ts`）：run_command（cwd 固定 + 逃逸拒绝）/ run_background / job_output / wait_for_job / stop_job / list_jobs
- **记忆**（`src/tools/memory.ts`）：remember / forget / recall_memory
- **代码查询**（`src/tools/code-query.ts`）：get_symbols / find_in_code（web-tree-sitter）
- **计划**（`src/tools/plan-core.ts`）：submit_plan（approve/refine/cancel）/ mark_step_complete / revise_plan
- **主题/精炼**（`src/tools/theme-tools.ts` + `refine.ts`）：list_themes / trace_theme / tag_theme / search_context（maxClusters=5）/ load_turns_context（mode full|material）/ list_search_views / list_fold_views
- **其余**：todo_write / ask_choice / create_skill / install_skill / add_mcp_server / run_skill / web_search / web_fetch（searchEnabled 条件注册）/ java_source（条件注册）/ semantic_search（ollama 索引兼容时注册）

### 关键行为核验

| 声称 | 位置 | 状态 |
|---|---|---|
| read_file 支持 `range:"A-B"` / `head:N` / `tail:N` | `src/tools/filesystem.ts:356-381` | ✅ range 优先、1-indexed 闭区间、越界 clamp |
| read-before-edit 强制（未读拒绝） | `src/tools/fs/edit.ts:21-25,147-151,322-326` + `filesystem.ts:890-894` | ✅ 4 个变更工具全实现；write_file 计为 read；fold 清 tracker（loop.ts:331） |
| multi_edit all-or-nothing + 写阶段回滚 | `src/tools/fs/edit.ts:282-405` | ✅ 先内存验证全部 edits，写失败逆序回滚 |
| edit gate 文案 "edit blocks: N/M applied" / "User rejected this edit" | `src/cli/ui/edit-history.ts:43` / `App.tsx:2183-2187` | ✅ 与 prompt 措辞一致 |
| plan mode "unavailable in plan mode" 拦截 | `src/tools.ts:345-350` | ✅ 白名单只读命令放行 |
| `/plan` 斜杠命令 | `src/cli/ui/slash/commands.ts:302` | ✅（另有 `/mode plan`） |
| 记忆截断数值 | 项目 8000 / 全局 8000 / 用户 4000 / 技能索引 4000 / 工具描述 ≤120 | ✅ 全部与声称一致 |
| 项目记忆查找链 | `src/memory/project.ts:11-17` | ⚠️ 实际为 REASONIX.md → **.claude/CLAUDE.md** → CLAUDE.md → AGENTS.md → AGENT.md（比声称多一个候选） |
| `#g` 前缀写全局记忆 | `src/cli/ui/hash-memory.ts:44-50` | ✅（`^#g\s+` 正则，需空格） |
| HIGH PRIORITY 约束块 | `src/memory/user.ts:400-416` + config.memory.customTypes | ✅ |
| `/skill <name>` + run_skill 工具 | `slash/commands.ts:195` + `src/tools/skills.ts:106` | ✅ |
| 内置 6 技能（4 subagent + 2 inline） | `src/skills.ts:657-711` | ✅ runAs 与文档一致 |
| NEGATIVE_CLAIM_RULE 内嵌 | subagent.ts:107、subagent-types.ts:24/40、skills.ts:482/502/531/578 | ⚠️ 共 **7 处**（4 个 subagent 型 body；test/qq 未引用） |
| 子代理 escalation 追加 | `src/tools/subagent.ts:111-113` | ✅ 按 spawn 时模型 id |
| shrinkDescription 应用于全部工具 spec | `src/tools.ts:236-255` | ✅（仅参数推断路径不走，不进请求） |
| fold ≤1024 tokens + COMPACTION_SUMMARY_MARKER | `context-manager.ts:670-674` + `packages/core-utils/src/compaction.ts:4-5` | ✅ |
| /new、/cwd 的 replaceSystem | `src/loop.ts:427/456` | ✅ |
| ImmutablePrefix.toMessages（system + fewShots） | `src/memory/runtime.ts:73-75` | ✅ fewShots 默认空 |

---

## 🔶 改名/命名注意

- 内置技能 `security-review`（连字符）对应顶层快捷工具 `security_review`（下划线，`src/tools/skills.ts:220`）
- `grep` 注册在 `filesystem.ts:559`（`tools/grep.ts` 是纯实现文件，非死代码）
- `spawn_subagent` 工具（`registerSubagentTool`）仅库 API 导出，CLI 主会话不注册

## 结论与建议（2026-08-04 处置完成）

1. **引用校验**（🔴1）：**已实现**——缺失路径在 TUI 渲染红色删除线 + ❌（citation-check.ts + 两条渲染路径 + 测试）。
2. **自动升级**（🔴2）：**已实现**——回合内 repair/工具错误计数 ≥3 自动重试 pro + typed breakdown（loop.ts + 测试）。
3. **`ls` 引用**（⚠️1）：**已修**——prompt.ts:17 改为 `list_directory`（文档已同步重新生成）。
4. 其余 21 节点内容与实现一致；节点 6 查找链已补 `.claude/CLAUDE.md`。
5. 遗留：dashboard 端引用校验未做（CLI TUI 已覆盖主要场景）。

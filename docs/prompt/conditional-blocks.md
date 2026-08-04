# 条件注入块

在 `codeSystemPrompt` 组装链中按条件注入的 prompt 块（`src/code/prompt.ts:194-223`）。

## 注入顺序与条件

| 块 | 位置 | 条件 | 估算 |
|---|---|---|---|
| `SEMANTIC_SEARCH_ROUTING` | `src/code/prompt.ts:139-148` | `opts.hasSemanticSearch`（semantic_search 工具注册时） | ~1,000 字符 |
| `HISTORY_TRACING_GUIDE` | `:150-175` | **无条件**（已知优化点：应加开关） | ~1,600 字符 |
| 记忆栈 `applyMemoryStack` | `src/memory/user.ts:458-481` | 始终 | 每文件 ≤8,000 字符 |
| 技能索引 | `src/skills.ts:440-465` | 有技能时 | ≤4,000 字符 |
| `.gitignore` 块 | `src/code/prompt.ts:202-217` | 文件存在时 | ~250 + 内容（截断 2,000） |
| `# User System Append` | `:218-221` | systemAppend / systemAppendFile 任一提供 | 用户定义 |

## 各块内容

### SEMANTIC_SEARCH_ROUTING（语义搜索路由）

`semantic_search`（向量）vs `grep`（字面正则）的选型：
- 描述性查询（"where do we handle X"、"how does Z work"）→ 先 `semantic_search`
- 精确 token 查询（标识符、正则、"find every call to foo"）→ 先 `grep`
- semantic_search 无结果才回退 grep（不要反向）

### HISTORY_TRACING_GUIDE（跨会话历史溯源）

主题（theme）溯源工作流：
1. 发现：`list_themes()`
2. 分支：存在 → `trace_theme()`；不存在 → 询问用户后 build
3. Build/refresh：`list_search_views`/`list_fold_views` → `search_context` → `load_turns_context(mode="material")` → `tag_theme` → 迭代完成后输出时间线报告

工具：`list_themes` / `list_search_views` / `list_fold_views` / `search_context` / `load_turns_context` / `tag_theme` / `trace_theme`。

> **已知优化点**：该块无条件注入（约 450 tokens），即使本次运行未注册 theme 工具。建议增加 `hasThemeTools` 开关（与 `hasSemanticSearch` 一致）。

### 记忆栈（applyMemoryStack）

注入顺序（`src/memory/user.ts:458-481`）：
1. project memory（`src/memory/project.ts`，截断 8,000 字符）
2. 全局 `REASONIX.md`
3. `~/.claude/CLAUDE.md`
4. user memory（`src/memory/user.ts:326-330`，截断 8,000）
5. skills index（`src/skills.ts:440-465`，≤4,000 字符）

每块格式：`# 标题 + 权威性说明 + 代码围栏内容`。

`highPriorityBlock`（`src/memory/user.ts:400-416`）：user memory 前的 `# HIGH PRIORITY constraints` 硬规则块。

技能索引头（`src/skills.ts:440-465`，约 700 字符）：`# Skills — playbooks you can invoke` + 每行 name + `[🧬 subagent]` 标签 + 描述（截断 130 字符）。

### .gitignore 块

包装说明（"treat every pattern as don't traverse..."）+ 文件内容（截断 2,000 字符，附 `… (truncated N chars)`）。

### User System Append

`systemAppend` / `systemAppendFile`（用户配置）合并追加，append-only 不替换默认提示。

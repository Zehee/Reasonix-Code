# 主系统提示词

## 1. code 模式（`src/code/prompt.ts`）

### 生成函数

- `codeSystemBase(modelId)`（`src/code/prompt.ts:9-11`）：`CODE_SYSTEM_TEMPLATE.replace("__ESCALATION_CONTRACT__", escalationContract(modelId))`
- `codeSystemPrompt(rootDir, opts)`（`src/code/prompt.ts:194-223`）：组装完整系统提示词
- 公共 API 常量 `CODE_SYSTEM_PROMPT`（`src/code/prompt.ts:135-136`）：冻结在 flash 措辞的历史快照，向后兼容

### 模板章节（`CODE_SYSTEM_TEMPLATE`，`src/code/prompt.ts:13-133`，约 10-12k 字符）

| 章节 | 行 | 主题 | 估算 |
|---|---|---|---|
| 开头 | 13 | 身份声明（Reasonix Code）+ 按工具名选工具 | ~150 |
| Identity is fixed by this prompt | 15-17 | 反外部平台配置污染（SOUL.md/AGENT.md 等） | ~570 |
| Cite or shut up — non-negotiable | 19-21 | 引用必须带证据链接；负面声明先 grep | ~560 |
| When auditing or reviewing this codebase | 23-32 | 审计 6 条护栏 | ~1,900 |
| Picking the right tool | 34-38 | submit_plan / ask_choice / todo_write 选型 | ~950 |
| Plan mode (/plan) | 40-42 | plan mode 更强约束 | ~330 |
| Delegating to subagents via Skills | 44-48 | 技能索引 + "默认不委派" | ~900 |
| When to edit vs. when to explore | 50-57 | 编辑时机 + edit gate 响应语义 | ~1,100 |
| Editing files | 59-83 | SEARCH/REPLACE 格式、read-before-edit | ~1,900 |
| Trust what you already know | 85-87 | 先查上下文再探索 | ~300 |
| Exploration | 89-96 | 搜索工具选型 + 高效阅读 | ~1,100 |
| Path conventions | 98-102 | 沙箱路径规则 | ~800 |
| Workspace is pinned | 104-106 | 不能换工作目录 | ~300 |
| Foreground vs background | 108-110 | run_command vs run_background | ~500 |
| Scope discipline on "run it" | 112-114 | 启动后即停 | ~450 |
| Style | 116-120 | 展示编辑不叙述 | ~220 |
| Tool Selection | 122-124 | MCP 工具优先于内置 | ~200 |
| Task integrity — non-negotiable | 126-128 | 不得擅自缩小目标 | ~330 |

### 调用方

| 调用方 | 位置 | 传参 |
|---|---|---|
| code 主命令 | `src/cli/commands/code.tsx:135` | `{ hasSemanticSearch, modelId, systemAppend, ... }` |
| ACP 模式 | `src/cli/commands/acp.ts:174-178` | `{ hasSemanticSearch: toolset.semantic.enabled, modelId, systemAppend }` |

## 2. run 命令（`src/cli/index.ts:64-86`）

`defaultSystemPrompt(modelId)`，约 1,900 字符 + `escalationContract(modelId)`（约 +1,100）。

三个段落：
1. **身份**：Reasonix, a helpful DeepSeek-powered assistant
2. **Cite or shut up — non-negotiable**：引用验证 + 负面声明先搜后断
3. **Don't invent what changes — search instead**：训练截止后易变事实先搜索

与 code 版差异：无工具选型/编辑章节（run 是 headless 一次性任务，不挂 code 工具集）。

## 3. 组装链（codeSystemPrompt，`src/code/prompt.ts:194-223`）

```
1. codeSystemBase(modelId)                   模板 + escalation 插值
2. + SEMANTIC_SEARCH_ROUTING                 （仅 opts.hasSemanticSearch）
3. + HISTORY_TRACING_GUIDE                    （无条件）
4. applyMemoryStack(base, rootDir)            记忆栈（见 conditional-blocks.md）
5. + .gitignore 块                            （文件存在时，内容截断 2000 字符）
6. + "# User System Append"                   （systemAppend / systemAppendFile 合并）
```

产物进入 `ImmutablePrefix`（`src/memory/runtime.ts:47-74`）参与前缀缓存哈希。

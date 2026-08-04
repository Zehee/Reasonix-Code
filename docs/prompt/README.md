# Prompt 工程文档

本项目（Reasonix-Code）所有模型提示词（prompt）的类型、生成来源与组装方式总览。

## 文档索引

| 文档 | 内容 |
|---|---|
| [system-prompts.md](system-prompts.md) | 主系统提示词（code / run / acp）+ 组装链 |
| [prompt.md](prompt.md) / [prompt.en.md](prompt.en.md) | 全部 prompt 节点原文（19 节点，按渲染顺序，中英双语） |
| [fragments.md](fragments.md) | 共享片段（TUI 格式 / 负面声明 / 升级契约） |
| [conditional-blocks.md](conditional-blocks.md) | 条件注入块（搜索路由 / 历史溯源 / .gitignore / 记忆栈） |
| [subagents-skills.md](subagents-skills.md) | 子代理 base/persona + 内置技能 body |
| [tools.md](tools.md) | 工具描述生成与收缩机制 |
| [context-compaction.md](context-compaction.md) | 上下文压缩指令（fold 摘要 / force-summary / fewShots） |
| [runtime-tasks.md](runtime-tasks.md) | 运行时小任务 prompt（/init / /title / /undo / plan mode） |

## 类型 × 生成来源矩阵

| 类型 | 生成来源 | 文件 | 性质 |
|---|---|---|---|
| code 主系统提示 | 静态模板 + 占位符插值 | `src/code/prompt.ts:13-133` | 静态（escalation 按模型插值） |
| run 默认系统提示 | 静态模板 + 插值 | `src/cli/index.ts:64-86` | 静态 |
| 条件片段 | 运行时拼接注入 | `src/code/prompt.ts:139-175,202-217` | 按能力/文件存在性 |
| 记忆/技能栈 | 运行时文件读取注入 | `src/memory/*`、`src/skills.ts` | 8k/4k 字符截断 |
| 共享片段 | 常量/函数导出 | `src/prompt-fragments.ts` | 静态，多处以 `${}` 拼接 |
| 子代理 base / persona | 静态模板 | `src/tools/subagent.ts:99-113`、`subagent-types.ts` | escalation 按模型追加 |
| 内置技能 body | 静态模板 | `src/skills.ts:467-655` | 拼接共享片段 |
| 用户技能 | 磁盘 SKILL.md | 用户目录 | 惰性加载 |
| 工具/参数描述 | 手写常量 → 发送前收缩 | `src/tools/*`、`src/tools/schema-canon.ts:95-111` | 收缩至 ≤120 字符 |
| MCP 工具描述 | 运行时透传（不收缩） | `src/mcp/registry.ts:99-102` | schema 仅做缓存规范化 |
| fold / force 摘要指令 | 每次摘要内联构造 | `src/context-manager.ts:670-674`、`src/loop/force-summary.ts:38-42` | 运行时生成 |
| 标题 / /init / /undo | 运行时小指令 | `session-title.ts`、`handlers/init.ts`、`undo-context.ts` | 运行时生成 |
| repair / refine | 无（算法/启发式） | `src/repair/`、`src/refine/` | 非 prompt |

## 核心设计约束：前缀缓存稳定性

所有 prompt 设计的第一约束是 **DeepSeek prefix-cache 字节稳定性**：

- 系统提示词进入 `ImmutablePrefix`（`src/memory/runtime.ts:47-74`）参与前缀缓存哈希；共享片段声明"嵌入式字面量，不插值"（`src/prompt-fragments.ts:3`）以保持跨会话稳定。
- 工具 schema 经 `canonicalizeSchema`（`src/tools/schema-canon.ts:27-77`）键排序/去 `$schema`，保证字节稳定。
- 修改任何静态 prompt 文本都会使缓存前缀失效（成本上升），这是 prompt 变更的隐含成本。

## 组装链（code 模式）

```
CODE_SYSTEM_TEMPLATE（身份→引用→审计→工具选型→编辑→探索→路径→风格→完整性）
  ├─ replace __ESCALATION_CONTRACT__ → escalationContract(modelId)   （运行时）
  └─ replace __TUI_FORMATTING_RULES__ → TUI_FORMATTING_RULES         （静态）
  + SEMANTIC_SEARCH_ROUTING        （仅 hasSemanticSearch）
  + HISTORY_TRACING_GUIDE          （无条件）
  + applyMemoryStack：project memory → 全局 REASONIX.md → CLAUDE.md → user memory → skills index
  + .gitignore 块                  （文件存在时，截断 2000 字符）
  + # User System Append           （systemAppend / systemAppendFile）
```

详见 [system-prompts.md](system-prompts.md)。

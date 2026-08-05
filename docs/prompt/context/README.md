# Prompt 节点上下文索引

> 每个节点单独文件，按编号 + 名称索引。逐文件编辑以降低单次上下文开销。
> 每个文件结构固定 5 部分：节点 / 来源 / 说明 / 原文 / v2（v2 留空待细化）。

| # | 文件 | 节点 | 来源 |
|---|---|---|---|
| 1 | [node-01-code-system-template.md](./node-01-code-system-template.md) | CODE_SYSTEM_TEMPLATE（身份与规则基座） | `src/code/prompt.ts:13-133` |
| 2 | [node-02-escalation-contract.md](./node-02-escalation-contract.md) | escalationContract（升级契约） | `src/prompt-fragments.ts:12-25` |
| 3 | [node-03-tui-formatting-rules.md](./node-03-tui-formatting-rules.md) | TUI_FORMATTING_RULES（格式规则） | `src/prompt-fragments.ts:4-9` |
| 4 | [node-04-semantic-search-routing.md](./node-04-semantic-search-routing.md) | SEMANTIC_SEARCH_ROUTING（搜索路由） | `src/code/prompt.ts:139-148` |
| 5 | [node-05-history-tracing-guide.md](./node-05-history-tracing-guide.md) | HISTORY_TRACING_GUIDE（跨会话历史追踪） | `src/code/prompt.ts:150-175` |
| 6 | [node-06-memory-project.md](./node-06-memory-project.md) | 记忆栈 · Project memory | `src/memory/project.ts:97-112` |
| 7 | [node-07-memory-global-reasonix.md](./node-07-memory-global-reasonix.md) | 记忆栈 · Global memory (~/.reasonix/REASONIX.md) | `src/memory/user.ts:333-349` |
| 8 | [node-08-memory-global-claude.md](./node-08-memory-global-claude.md) | 记忆栈 · Global memory (~/.claude/CLAUDE.md) | `src/memory/user.ts:374-389` |
| 9 | [node-09-memory-user.md](./node-09-memory-user.md) | 记忆栈 · User memory | `src/memory/user.ts:400-456` |
| 10 | [node-10-skills-index.md](./node-10-skills-index.md) | 记忆栈 · Skills 索引 | `src/skills.ts:440-465` |
| 11 | [node-11-gitignore.md](./node-11-gitignore.md) | 主链路 · .gitignore 块 | `src/code/prompt.ts:204-217` |
| 12 | [node-12-system-append.md](./node-12-system-append.md) | 主链路 · User System Append | `src/code/prompt.ts:218-221` |
| 13 | [node-13-run-default.md](./node-13-run-default.md) | run 模式 · defaultSystemPrompt | `src/cli/index.ts:64-86` |
| 14 | [node-14-subagent-base.md](./node-14-subagent-base.md) | subagent · SUBAGENT_BASE_SYSTEM | `src/tools/subagent.ts:99-109` |
| 15 | [node-15-subagent-explore.md](./node-15-subagent-explore.md) | subagent · EXPLORE persona | `src/tools/subagent-types.ts:11-25` |
| 16 | [node-16-subagent-verify.md](./node-16-subagent-verify.md) | subagent · VERIFY persona | `src/tools/subagent-types.ts:27-40` |
| 17 | [node-17-skills-bodies.md](./node-17-skills-bodies.md) | skills · 内置技能 body（6 个） | `src/skills.ts:467-630` |
| 18 | [node-18-fold-instruction.md](./node-18-fold-instruction.md) | 折叠摘要 · fold 指令 | `src/context-manager.ts:670-674` |
| 19 | [node-19-shrink-description.md](./node-19-shrink-description.md) | 工具描述 · shrinkDescription | `src/tools/schema-canon.ts:95-111` |
| 20 | [node-20-negative-claim-rule.md](./node-20-negative-claim-rule.md) | 共享片段 · NEGATIVE_CLAIM_RULE | `src/prompt-fragments.ts:30-36` |
| 21 | [node-21-tool-specs.md](./node-21-tool-specs.md) | 工具层 · Tool specs 注入（动态节点） | `src/tools/*.ts → src/tools/schema-canon.ts` |

## 工作流

1. 与用户讨论某个节点时，仅打开对应 `node-XX-*.md`
2. 用户在 v2 段落填入具体方案（中文）
3. 定稿后由助手同步更新源码（`src/code/prompt.ts` / `src/prompt-fragments.ts` / `src/skills.ts` / `src/cli/index.ts` 等）
4. 同步更新 `scripts/gen-prompt-docs.py` 的 N* / T* 字段以重生成 `docs/prompt/prompt.md` 与 `docs/prompt/prompt.en.md`
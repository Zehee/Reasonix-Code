# Node 10 · 记忆栈 · Skills 索引

## 来源

`src/skills.ts:440-465`

## 说明

`[🧬 subagent]` 标签说明 + 一行索引清单（截断保护）。

## 原文（中文翻译稿，供对照）

> ${basePrompt}
>
> # Skills — playbooks you can invoke
>
> One-liner index. Each entry is either a built-in or a user-authored playbook. Call `run_skill({ name: "<skill-name>", arguments: "<task>" })` — the `name` is JUST the skill identifier (e.g. `"explore"`), NOT the `[🧬 subagent]` tag that appears after it. Entries tagged `[🧬 subagent]` spawn an **isolated subagent** — its tool calls and reasoning never enter your context, only its final answer does. Use subagent skills for tasks that would otherwise flood your context (deep exploration, multi-step research, anything where you only need the conclusion). Plain skills are inlined: their body becomes a tool result you read and act on directly. The user can also invoke a skill via `/skill <name>`.
>
> ```
> - <skill-name>[ 🧬 subagent] — <clipped description>
> （索引行，超长截断）
> ```


## v2

_（待细化）_
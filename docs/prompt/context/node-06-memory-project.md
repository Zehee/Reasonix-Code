# Node 6 · 记忆栈 · Project memory

## 来源

`src/memory/project.ts:97-112`

## 说明

实际查找链 REASONIX.md → .claude/CLAUDE.md → CLAUDE.md → AGENTS.md → AGENT.md，8000 字符截断。`${filename}` / `${mem.content}` 为插入点。

## 原文（中文翻译稿，供对照）

> ${basePrompt}
>
> # Project memory (${filename})
>
> The user pinned these notes about this project — treat them as authoritative context for every turn:
>
> ```
> ${mem.content}
> ```


## v2

_（待细化）_
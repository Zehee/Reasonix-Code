# Node 9 · 记忆栈 · User memory（用户记忆）

## 来源

`src/memory/user.ts:400-456`

## 说明

HIGH PRIORITY 约束块（若有 high 条目）+ 全局用户记忆（4000 字符）+ 项目用户记忆。均视为权威，不重复验证。

## 原文（中文翻译稿，供对照）

> ${basePrompt}
>
> [插入条件：存在 priority:high 条目时]
> # HIGH PRIORITY constraints (must observe)
>
> These memories were declared `priority: high` (via config.memory.customTypes or the memory file itself). Treat them as hard rules — violations override any other guidance below.
>
> !!! [${scope}/${type}/${name}] ${description}
>
> # User memory — global (~/.reasonix/memory/global/MEMORY.md)
>
> Cross-project facts and preferences the user has told you in prior sessions. TREAT AS AUTHORITATIVE — don't re-verify via filesystem or web. One-liners index detail files; call `recall_memory` for full bodies only when the one-liner isn't enough.
>
> ```
> ${global.content}
> ```
>
> # User memory — this project
>
> Per-project facts the user established in prior sessions (not committed to the repo). TREAT AS AUTHORITATIVE. Same recall pattern as global memory.
>
> ```
> ${project.content}
> ```


## v2

_（待细化）_
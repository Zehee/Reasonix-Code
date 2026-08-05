# Node 9 · 记忆栈 · User memory（用户记忆）

## 来源

`src/memory/user.ts:400-456`

## 说明

HIGH PRIORITY 约束块（若有 high 条目）+ 全局用户记忆（4000 字符）+ 项目用户记忆。均视为权威，不重复验证。

## 原文（中文翻译稿，供对照）

> 动态模板。`applyUserMemory` 在节点 8 之后追加。包含三段（按顺序）：
> 1. **HIGH PRIORITY 约束块**——仅在存在 `priority: high` 条目时插入
> 2. **用户全局记忆**（`~/.reasonix/memory/global/MEMORY.md`）——4000 字符截断
> 3. **项目用户记忆**——按项目区分，未提交到仓库
>
> 原文——
>
> > ${basePrompt}
> >
> > [插入条件：存在 priority:high 条目时]
> > # 高优先级约束（必须遵守）
> >
> > 这些记忆被声明为 `priority: high`（通过 `config.memory.customTypes` 或记忆文件本身）。把它们当作硬规则——违反会覆盖下面任何其它指引。
> >
> > !!! [${scope}/${type}/${name}] ${description}
> >
> > # 用户记忆 — 全局（~/.reasonix/memory/global/MEMORY.md）
> >
> > 用户在过去会话中告诉你的跨项目事实与偏好。**视为权威**——不要通过文件系统或网络重新验证。一行条目索引详细文件；只有当一行条目不够时才调用 `recall_memory` 取完整正文。
> >
> > ```
> > ${global.content}
> > ```
> >
> > # 用户记忆 — 本项目
> >
> > 用户在过去会话中建立的、按项目区分的事实（不提交到仓库）。**视为权威**。召回模式与全局记忆相同。
> >
> > ```
> > ${project.content}
> > ```

## v2

_（待细化）_

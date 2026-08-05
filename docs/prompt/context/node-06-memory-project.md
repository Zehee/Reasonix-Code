# Node 6 · 记忆栈 · Project memory

## 来源

`src/memory/project.ts:97-112`

## 说明

实际查找链 REASONIX.md → .claude/CLAUDE.md → CLAUDE.md → AGENTS.md → AGENT.md，8000 字符截断。`${filename}` / `${mem.content}` 为插入点。

## 原文（中文翻译稿，供对照）

> 这是一段**动态模板**——`applyProjectMemory` 在节点 1 末尾追加的内容。`${basePrompt}` 是"到目前为止已拼好的全部 system 提示词"，`${filename}` 是实际命中的文件名（`REASONIX.md` / `.claude/CLAUDE.md` / `CLAUDE.md` / `AGENTS.md` / `AGENT.md` 中第一个存在的），`${mem.content}` 是其正文（8000 字符截断）。
>
> 原文（说明语义而非渲染产物）——
>
> > # 项目记忆（${filename}）
> >
> > 用户为本项目固定的笔记——把它们视为每回合的权威上下文：
> >
> > ```
> > ${mem.content}
> > ```

## v2

_（待细化）_

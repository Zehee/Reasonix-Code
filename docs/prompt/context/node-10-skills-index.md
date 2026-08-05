# Node 10 · 记忆栈 · Skills 索引

## 来源

`src/skills.ts:440-465`

## 说明

`[🧬 subagent]` 标签说明 + 一行索引清单（截断保护）。

## 原文（中文翻译稿，供对照）

> 动态模板。`applySkillsIndex` 在节点 9 之后追加。包含：索引标题与说明 + 一行索引列表（每条形如 `- <skill-name>[ 🧬 subagent] — <clipped description>`，超过 `SKILLS_INDEX_MAX_CHARS` 时整体截断）。
>
> 原文——
>
> > # 技能 — 可调用的剧本
> >
> > 一行索引。每个条目要么是内置、要么是用户编写的剧本。调用 `run_skill({ name: "<skill-name>", arguments: "<task>" })` —— `name` 只是技能标识符（如 `"explore"`），不是它后面出现的 `[🧬 subagent]` 标签。标记 `[🧬 subagent]` 的条目会派生一个**隔离的 subagent**——它的工具调用和推理从不进入你的上下文，只有最终答案会。subagent 技能用于那些会淹没你上下文的场景（深度探索、多步研究、任何你只需要结论的事）。普通技能是内联的：它们的正文会变成你直接阅读并执行的工具结果。用户也可以通过 `/skill <name>` 调用技能。
> >
> > ```
> > - <skill-name>[ 🧬 subagent] — <clipped description>
> > （索引行，超长截断）
> > ```

## v2

_（待细化）_

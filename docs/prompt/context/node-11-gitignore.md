# Node 11 · 主链路 · .gitignore 块

## 来源

`src/code/prompt.ts:204-217`

## 说明

仓库 .gitignore 内容（2000 字符截断），作为遍历/编辑禁区清单。

## 原文（中文翻译稿，供对照）

> 动态模板。`codeSystemPrompt` 在记忆栈（节点 6-10）之后追加（如果项目根有 `.gitignore`）。`${withMemory}` 是含记忆栈的全部 system，`${gitignore 内容}` 是 .gitignore 文件正文（2000 字符截断，溢出标 `… (truncated N chars)`）。
>
> 原文——
>
> > # 项目 .gitignore
> >
> > 用户的仓库自带这份 .gitignore——把每个模式都当作"除非明确要求，不要遍历或编辑这些路径"：
> >
> > ```
> > ${gitignore 内容，2000 字符截断}
> > ```

## v2

_（待细化）_

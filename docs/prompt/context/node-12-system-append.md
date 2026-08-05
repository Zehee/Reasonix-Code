# Node 12 · 主链路 · User System Append

## 来源

`src/code/prompt.ts:218-221`

## 说明

systemAppend 与 systemAppendFile 合并追加（append-only，不替换默认）。

## 原文（中文翻译稿，供对照）

> 动态模板。`codeSystemPrompt` 最后追加（如果 `systemAppend` 或 `systemAppendFile` 任一非空）。`${result}` 是含前面全部 system 的字符串；追加段是把两个来源合并为一段，标题为 `# User System Append`。
>
> 原文——
>
> > # 用户系统附加
> >
> > ${systemAppend 与 systemAppendFile 合并，按传入顺序}

## v2

_（待细化）_

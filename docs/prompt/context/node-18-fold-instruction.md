# Node 18 · 折叠摘要 · fold 指令

## 来源

`src/context-manager.ts:670-674`

## 说明

上下文折叠时的 epoch 摘要指令（≤1024 tokens），system 复用主 agent 的。

## 原文（中文翻译稿，供对照）

> 这是上下文折叠时的摘要指令（`src/context-manager.ts:670-674`），作为 user 消息发给 fold 模型。`system` 复用主 agent 的（不重写）。
>
> 原文（翻译）——
>
> > 把上面之前的折叠总结成一段简洁的 epoch 回顾（≤1024 tokens）。保留用户的原始目标、所有 "do not" / "never" / "avoid" 指令、达成的决定、检查过或修改过的文件、仍然相关的工具结果，以及任何未完成的 todos。跳过回合级的流水账。只输出平实散文——不要工具调用、不要 markdown 标题、不要 SEARCH/REPLACE 块。

## v2

_（待细化）_

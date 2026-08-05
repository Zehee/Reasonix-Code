# Node 20 · 共享片段 · NEGATIVE_CLAIM_RULE（负面声明规则）

## 来源

`src/prompt-fragments.ts:30-36`

## 说明

内嵌于 7 处（节点 14、15、16、17.1-17.4）：否定性断言（『X 不存在』）是头号幻觉形态，先搜索再断言缺失。

## 原文

> export const NEGATIVE_CLAIM_RULE = `Negative claims ("X is missing", "Y isn't implemented", "there's no Z") are the #1 hallucination shape. They feel safe to write because no citation seems possible — but that's exactly why you must NOT write them on instinct.
>
> If you have a search tool (\`grep\`, web search), call it FIRST before asserting absence:
> - Returns matches → you were wrong; correct yourself and cite the matches.
> - Returns nothing → state the absence WITH the search query as evidence: \`No callers of \\\`foo()\\\` found (grep "foo").\`
>
> If you have no search tool, qualify hard: "I haven't verified — this is a guess." Never assert absence with fake authority.`;

## v2

_（待细化）_
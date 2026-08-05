# Node 4 · SEMANTIC_SEARCH_ROUTING（搜索路由）

## 来源

`src/code/prompt.ts:139-148`

## 说明

仅当 `hasSemanticSearch`（semantic_search 工具注册时）。描述性查询先 semantic_search，精确 token 先 grep。

## 原文

> # Search routing
>
> You have BOTH `semantic_search` (vector index) and `grep` (literal regex).
>
> - **Descriptive queries** ("where do we handle X", "which file handles Y", "how does Z work", "find the logic that …", "the code that handles …") → call `semantic_search` first. It indexes the project semantically, so it can find the right file even when your wording shares no tokens with the code.
> - **Exact-token queries** (a specific identifier, regex, or "find all calls to foo") → call `grep`.
>
> If `semantic_search` returns nothing useful (low score, off-topic), fall back to `grep`. Don't reverse the order — `grep`ing a rephrased question wastes a turn.

## v2

_（待细化）_
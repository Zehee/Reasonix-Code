# Node 4 · SEMANTIC_SEARCH_ROUTING（搜索路由）

## 来源

`src/code/prompt.ts:139-148`

## 说明

仅当 `hasSemanticSearch`（semantic_search 工具注册时）。描述性查询先 semantic_search，精确 token 先 grep。

## 原文（中文翻译稿，供对照）

> # 搜索路由
>
> 你同时拥有 `semantic_search`（向量索引）和 `grep`（字面正则）。
>
> - **描述性查询**（"我们在哪里处理 X"、"哪个文件负责 Y"、"Z 是怎么工作的"、"找到做 … 的逻辑"、"负责 … 的代码"）→ 先调用 `semantic_search`。它按语义索引项目，即使你的措辞与代码没有任何共享 token 也能找到正确的文件。
> - **精确 token 查询**（特定标识符、正则、或"找到所有 foo 的调用"）→ 调用 `grep`。
>
> 如果 `semantic_search` 没有返回有用的东西（低分、离题），再回退到 `grep`。不要反着来——用 grep 去搜改写过的问句会浪费回合。


## v2

_（待细化）_
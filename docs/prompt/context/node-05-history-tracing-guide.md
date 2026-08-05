# Node 5 · HISTORY_TRACING_GUIDE（跨会话历史追踪）

## 来源

`src/code/prompt.ts:150-175`

## 说明

无条件。list_themes / trace_theme 工作流，主题 = 长期话题的时间线聚类。

## 原文（中文翻译稿，供对照）

> # 跨会话历史追踪
>
> 用于用户询问某个主题如何演变、某个决定为什么做出、或某个东西是怎么设计的时候——不是代码搜索（用 semantic_search / grep）。
>
> 主题（theme）是一个长期话题的回合时间线聚类（如登录模块的演进）。
>
> 工作流：
> 1. 发现：调用 list_themes()。
> 2. 分支：
>    • 存在：调用 trace_theme()。如果过时，走刷新流程。
>    • 不存在：问用户，然后走构建流程。
> 3. 构建 / 刷新流程：
>    list_search_views / list_fold_views（候选池）
>    -> search_context（找相关回合）
>    -> load_turns_context(mode="material")（核对内容，避免重复骨架）
>    -> tag_theme（挂接回合）
>    -> 迭代直到完成，然后给出按时间排序的报告。
>
> 工具：
> • 发现：list_themes()、list_search_views(sessionId?)、list_fold_views(sessionId?)。
> • 搜索：search_context(query, sessionName?, maxClusters=5, detail="normal") —— 跨会话找相关回合。
> • 核对：load_turns_context(references=[{sessionName, turnId}], mode="full"|"material") —— 取原始内容；优先 material 以减少冗余。
> • 挂接：tag_theme(theme, sessionId, turnId) —— 把回合挂到主题上。sessionId 等于 search_context 返回的 sessionName。
> • 追踪：trace_theme(theme, includeContent=false) —— 按时间引用；includeContent=true 附加骨架。


## v2

_（待细化）_
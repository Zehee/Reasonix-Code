# Node 5 · HISTORY_TRACING_GUIDE（跨会话历史追踪）

## 来源

`src/code/prompt.ts:150-175`

## 说明

无条件。list_themes / trace_theme 工作流，主题 = 长期话题的时间线聚类。

## 原文

> # Cross-session history tracing
>
> Use when the user asks how a topic evolved, why a decision was made, or how something got designed — NOT code search (use semantic_search / grep).
>
> A theme is a chronological cluster of turns about one long-running topic (e.g., the login module's evolution).
>
> Workflow:
> 1. Discover: call list_themes().
> 2. Branch:
>    • exists: call trace_theme(). If stale, run the build flow.
>    • doesn't: ask the user, then run the build flow.
> 3. Build / refresh flow:
>    list_search_views / list_fold_views (candidate pool)
>    -> search_context (find relevant turns)
>    -> load_turns_context(mode="material") (verify content, avoid duplicate skeletons)
>    -> tag_theme (attach turns)
>    -> iterate until done, then deliver the chronologically sorted report.
>
> Tools:
> • Discover: list_themes(), list_search_views(sessionId?), list_fold_views(sessionId?).
> • Search: search_context(query, sessionName?, maxClusters=5, detail="normal") — find relevant turns across sessions.
> • Verify: load_turns_context(references=[{sessionName, turnId}], mode="full"|"material") — fetch raw content; prefer material to reduce redundancy.
> • Attach: tag_theme(theme, sessionId, turnId) — attach a turn to a theme. sessionId equals the sessionName returned by search_context.
> • Trace: trace_theme(theme, includeContent=false) — chronological references; includeContent=true appends skeletons.

## v2

_（待细化）_
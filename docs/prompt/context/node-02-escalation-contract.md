# Node 2 · escalationContract（升级契约）

## 来源

`src/prompt-fragments.ts:12-25`

## 说明

替换节点 1 的 `__ESCALATION_CONTRACT__`。pro 模型为 no-op 变体；flash 及其它模型输出 `<<<NEEDS_PRO>>>` 阶梯。

## 原文

> /** Pro is the top tier — escalation is a no-op for it; flash + others get the full ladder. */
> export function escalationContract(modelId: string): string {
>   if (modelId === "deepseek-v4-pro") {
>     return `Cost-aware escalation note: you are running on \`${modelId}\` — the escalation tier. There is no higher tier to escalate to, so the \`<<<NEEDS_PRO>>>\` marker is a no-op for you; deliver the strongest answer you can directly. If asked which model you are, answer \`${modelId}\`.`;
>   }
>   return `Cost-aware escalation (you are running on \`${modelId}\`):
>
> If a task CLEARLY exceeds what this tier can do well — complex cross-file architecture refactors, subtle concurrency / security / correctness invariants you can't resolve with confidence, or a design trade-off you'd be guessing at — output the marker as the FIRST line of your response (nothing before it, not even whitespace on a separate line). This aborts the current call and retries this turn on deepseek-v4-pro, one shot.
>
> Two accepted forms:
> - \`<<<NEEDS_PRO>>>\` — bare marker, no rationale.
> - \`<<<NEEDS_PRO: <one-sentence reason>>>>\` — preferred. The reason text appears in the user-visible warning ("⇧ flash requested escalation — <your reason>"), so they understand WHY a more expensive call is happening. Keep it under ~150 chars, no newlines, no nested \`>\` characters. Examples: \`<<<NEEDS_PRO: cross-file refactor across 6 modules with circular imports>>>\` or \`<<<NEEDS_PRO: subtle session-token race; flash would likely miss the locking invariant>>>\`.
>
> Do NOT emit any other content in the same response when you request escalation. Use this sparingly: normal tasks — reading files, small edits, clear bug fixes, straightforward feature additions — stay on this tier. Request escalation ONLY when you would otherwise produce a guess or a visibly-mediocre answer. If in doubt, attempt the task here first; the system also escalates automatically if you hit 3+ repair / SEARCH-mismatch errors in a single turn (the user sees a typed breakdown). If asked which model you are, answer \`${modelId}\`.`;
> }

## v2

_（待细化）_
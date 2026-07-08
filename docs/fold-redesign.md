# Fold / 上下文压缩重构设计

> 目标：把当前上游的渐进式截断策略，改造成“单次跳变折叠 + 降噪骨架 + toolcache 召回”策略。

---

## 1. 最终 fold 后 prompt 结构

```text
<!-- fold: <fold_id> -->
<epoch summary（≤1024 tokens）>

...最多 5 个 epoch summary，第 6 个时清空前 5 个...

<!-- current-fold: <fold_id> -->
[Clusters]      ← 对本次 fold 涉及 turns 的规则聚簇
[Framework]     ← 本次 fold turns 的最近 30 轮降噪骨架
[Hotzone]       ← 本次 fold turns 的最近 5 轮原文

[未折叠的 live turns]
```

- `summary`：由 summarizer 对**上一次 fold 产生的三项**做文本摘要生成。
- `clusters/framework/hotzone`：只对**本次 fold 涉及的 raw turns** 生成。
- 第一次 fold 没有上一届三项，因此**不生成 summary**，只生成三项。
- 第 6 个 summary 产生时，清空前 5 个，只保留最新一个。

---

## 2. 单次 fold 流程

```text
触发条件：prompt token 占 ctxMax 75%（保持现有阈值）

输入：
  - 上一次 fold 留下的三项（clusters_{N-1}, framework_{N-1}, hotzone_{N-1}）
  - 本次 fold 需要处理的 raw turns（自上一次 fold 以来的 live turns）

处理：
  1. 对本次 raw turns 做 denoise。
  2. 把本次 raw turns 的 tool result 按 tool_call_id 写入 `.toolcache.jsonl`。
  3. 把 prompt 中对应 tool message 替换为占位符（保留 tool_call_id）。
  4. 对本次 raw turns 聚簇 → clusters_N。
  5. 取本次 raw turns 最后 30 轮 → framework_N。
  6. 取本次 raw turns 最后 5 轮原文 → hotzone_N。
  7. summarizer 输入 = 上一届三项（clusters_{N-1} + framework_{N-1} + hotzone_{N-1}），
     输出 epoch summary_N（max_tokens=1024）。
  8. 用 summary_N + clusters_N + framework_N + hotzone_N 重写 live JSONL。
  9. 把本次 fold 的 summary 和 clusters 写入 fold_view。

输出 prompt：
  [历史 summaries，最多 5 个] + [当前三项] + [空 live turns，等待新轮次]
```

---

## 3. FoldView 结构

```ts
interface FoldView {
  fold_id: string;               // 本次 fold 唯一 ID
  session_id: string;            // 当前 session ID
  parent_fold_id?: string;       // 上一个 fold 的 ID（可选）
  created_at: string;
  source_turn_range: [number, number]; // 本次 fold 覆盖的 raw turn 范围
  summary: string;               // epoch summary（≤1024 tokens）
  clusters: DecisionCluster[];   // 本次 raw turns 的聚簇
}
```

- 一个 `FoldView` 只关心**当前 fold 这一 epoch**。
- 不保留 framework/hotzone 全文（它们在 live JSONL 和 toolcache 里）。

---

## 4. Toolcache 规则

- tool result 在**写入时保持完整**，任何阶段不截断。
- 只在 fold 时把 tool result 从 prompt 中迁出，按 `tool_call_id` 写入 `.toolcache.jsonl`。
- 占位符格式保留现有 `[archived: <tool_name> (<size>) — 已降噪]`。
- `load_turns_context` 通过 `tool_call_id` 从 `.toolcache.jsonl` 召回完整内容（已实现）。

---

## 5. 需要清理的上游截断代码

这些机制会导致 toolcache 残缺，必须移除或禁用：

### 5.1 `src/loop.ts`

- `shrinkMessageForRetention()` — 截断 assistant tool_call args。
- `shrinkToolResultForCacheStability()` — 截断 tool result。
- `appendAndPersist()` 中对上述两个函数的调用（约 line 421）。
- `replaceTailAssistantMessage()` 中对 `shrinkMessageForRetention()` 的调用（约 line 437）。

### 5.2 `src/loop/healing.ts`

- `healLoadedMessages()` 中的 `shrinkOversizedToolResults()` 调用。
- `healLoadedMessagesByTokens()` 中的 `shrinkOversizedToolResultsByTokens()` 和 `shrinkOversizedToolCallArgsByTokens()` 调用。
- 保留 `fixToolCallPairing()`（只修复 unpaired tool_calls，不截断）。

### 5.3 `src/context-manager.ts`

- `snipStaleToolResults()` 调用（fold 内 line 485）。
- `pruneStaleToolResults()` 调用（fold 内 line 489）。
- `pinnedPrefixLen()` 及相关 pinned prefix 逻辑。
- `partitionFoldRegion()` 中保留旧 summary / 小 user turn 的逻辑。
- `collectPinnedSkills()` 和 skill-pin memo tail 追加逻辑。
- `extractPinnedConstraints()` 和 constraints tail 追加逻辑。
- `summarizeForFold()` 中对 `healLoadedMessages()` 的调用（因为不再 shrink）。

### 5.4 `src/loop/shrink.ts`

- `snipStaleToolResultsProactive()` 当前无调用方，可保留但确认不启用。
- `shrinkOversizedToolResults()` / `shrinkOversizedToolResultsByTokens()` / `shrinkOversizedToolCallArgsByTokens()` 在上层调用移除后可转为内部备用，或一并删除。

---

## 6. 需要修改的文件

| 文件 | 改动内容 |
|---|---|
| `src/context-manager.ts` | 重写 `fold()`：移除 snip/prune/pinned/partition/skill/constraints，改为降噪 + toolcache + 聚簇 + 摘要。 |
| `src/loop.ts` | 移除 `shrinkMessageForRetention` / `shrinkToolResultForCacheStability` 调用。 |
| `src/loop/healing.ts` | 移除 healing 中的 shrink 调用，只保留配对修复。 |
| `src/memory/fold-view.ts` | 确认 `FoldView` 结构，`summary` 改为存 epoch summary。 |
| `src/memory/session.ts` 或相关 | 给 fold 产物消息加 `fold_id` / `fold_artifact` 标记，便于下次 fold 识别。 |
| `tests/*` | 更新或删除依赖 snip/prune/shrink 的旧测试。 |

---

## 7. 实现检查清单

- [x] 移除所有在 append / load / fold 阶段对 tool result 和 tool_call args 的截断。
- [x] fold 时完整归档 tool result 到 `.toolcache.jsonl`。
- [x] fold 后 prompt 只包含：历史 summaries（最多 5 个）+ 当前三项 + live turns。
- [x] summarizer 输入 = 上一届三项，max_tokens = 1024。
- [x] clusters 只从本次 fold 的 raw turns 生成。
- [x] framework = 本次 raw turns 最后 30 轮骨架；hotzone = 本次 raw turns 最后 5 轮原文。
- [x] 第 6 个 summary 产生时清空前 5 个。
- [x] fold_view 保存当前 fold 的 summary 和 clusters。
- [x] 所有相关测试通过。

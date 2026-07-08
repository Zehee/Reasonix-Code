# Fold 重构执行计划

## 总体目标

移除上游渐进截断逻辑，实现单次跳变折叠：
- 写入时 tool result / tool_call args 不截断。
- fold 时才把 tool result 完整归档到 `.toolcache.jsonl`，prompt 中替换为占位符。
- fold 后 prompt 结构：`历史 summaries（最多 5 个，第 6 个重置）` + `当前三项（clusters + framework + hotzone）` + `live turns`。
- 每个 fold 的 clusters 只从**本次 fold 的 raw turns** 生成。
- summarizer 只对**上一届三项**生成 epoch summary，≤1024 tokens。
- fold_view 保存当前 fold 的 `summary` 和 `clusters`。

---

## 已扫描的实现细节

- `src/context-manager.ts`
  - `fold()` 是核心，包含 snip/prune/pinned/partition/summarize/skill/constraints 等上游逻辑。
  - `decideAfterUsage()` 触发阈值保持可用（75%/78%/90%）。
- `src/loop.ts`
  - `appendAndPersist()` 调用 `shrinkMessageForRetention` + `shrinkToolResultForCacheStability`。
  - `replaceTailAssistantMessage()` 调用 `shrinkMessageForRetention`。
- `src/loop/healing.ts`
  - `healLoadedMessages` / `healLoadedMessagesByTokens` 包含 shrink 调用。
- `src/loop/shrink.ts`
  - `shrinkOversizedToolResults*` / `shrinkOversizedToolCallArgsByTokens` 被上层调用。
- `src/refine/denoise.ts`
  - `denoiseTurn()` 可复用。
- `src/refine/cluster.ts`
  - `clusterDenoisedTurns()` 可复用。
- `src/memory/fold-view.ts`
  - `FoldView.summary` 复用为 epoch summary。
- `src/memory/session.ts`
  - `rewriteSession` / `sessionPath` / `timestampSuffix` 等可复用。

---

## 阶段一：清理上游截断代码

### 1.1 `src/loop.ts`

- 删除 `shrinkMessageForRetention()` 和 `shrinkToolResultForCacheStability()` 函数。
- 在 `appendAndPersist()` 中直接 `this.log.append(this.stampMessage(message))`。
- 在 `replaceTailAssistantMessage()` 中直接替换 message，不再 shrink。
- 移除从 `src/loop/shrink.js` 的导入（只保留仍需要的 `healLoadedMessages*` 等）。

### 1.2 `src/loop/healing.ts`

- `healLoadedMessages()`：移除 `shrinkOversizedToolResults`，只保留 `fixToolCallPairing`。
- `healLoadedMessagesByTokens()`：移除 `shrinkOversizedToolResultsByTokens` 和 `shrinkOversizedToolCallArgsByTokens`，只保留 `fixToolCallPairing`。
- 移除从 `src/loop/shrink.js` 的导入（如果阶段一后无其他导入）。

### 1.3 `src/context-manager.ts`

- 在 `fold()` 中移除 `snipStaleToolResults(all)` 和 `pruneStaleToolResults(all)` 调用。
- 移除 `pinnedPrefixLen()` 函数及使用。
- 移除 `partitionFoldRegion()` 函数及使用。
- 移除 `collectPinnedSkills()` 及 `SKILL_PIN_MEMO_HEADER` 的使用。
- 移除 `extractPinnedConstraints()` 的使用。
- `summarizeForFold()` 中不再调用 `healLoadedMessages()`，直接发送原始 messages。
- 保留 `mechanicalFoldDigest()`、`isSummaryMessage()` 等可复用辅助函数，视情况清理。

### 1.4 `src/loop/shrink.ts`

- 如果阶段一后 `shrinkOversizedToolResults*` / `shrinkOversizedToolCallArgsByTokens` 无调用方，删除这些导出函数。
- 保留 `snipStaleToolResultsProactive`、`snipToolResultByTool`、`looksLikeCompleteJson` 等内部备用函数，或一并清理。

---

## 阶段二：重构 `ContextManager.fold()`

### 2.1 识别 fold 输入

- 从当前 live log 中解析出：
  - 历史 summaries 列表（带 `fold_id` 标记）。
  - 上一届三项：`clusters_{N-1}` / `framework_{N-1}` / `hotzone_{N-1}`（带 `current-fold` 标记）。
  - 本次需要折叠的 raw turns（标记之后的 live turns）。
- 第一次 fold：没有上一届三项和 summaries，只折叠 raw turns → 生成 `三项_1`。

### 2.2 降噪与归档

- 对本次 raw turns 调用 `messagesToRawTurns()` + `denoiseTurn()`。
- 将其中 `role: tool` 的完整内容按 `tool_call_id` 写入 `.toolcache.jsonl`。
- 将 live log 中对应 tool message 替换为占位符（保留 `tool_call_id`）。

### 2.3 生成当前三项

- `clusters_N` = `clusterDenoisedTurns(denoisedTurns)`。
- `framework_N` = 本次 denoised turns 最后 30 轮 → `buildFrameworkMessages()`。
- `hotzone_N` = 本次 raw turns 最后 5 轮原文。

### 2.4 生成 epoch summary

- 输入 = 上一届三项（第一次 fold 无输入，不生成 summary）。
- 调用 summarizer，`max_tokens = 1024`。
- 输出格式：`<!-- fold: <fold_id> -->\n<summary>`。

### 2.5 重写 live JSONL

- 保留历史 summaries 列表（最多 5 个，第 6 个时只保留最新 1 个）。
- 添加新的 summary 消息（如果有）。
- 添加 `<!-- current-fold: <fold_id> -->` 标记。
- 添加 `clusters_N`（assistant 消息，结构化文本）。
- 添加 `framework_N` 消息。
- 添加 `hotzone_N` 消息。
- 调用 `this.deps.log.compactInPlace(replacement)` 和 `rewriteSession()`。

### 2.6 保存 fold_view

- `summary` = epoch summary（或空字符串）。
- `clusters` = `clusters_N`。
- `source_turn_range` = 本次 fold 覆盖的 raw turn id 范围。
- 调用 `saveFoldView()`。

### 2.7 归档原 live JSONL

- 复用现有 `archiveOriginalSession()` 将原 live JSONL 复制为 `{sessionId}__archive_{ts}.jsonl`。

---

## 阶段三：标记与识别

- 在 fold 产物消息中附加 metadata：
  - `fold_id: string`
  - `fold_artifact: "summary" | "clusters" | "framework" | "hotzone"`
- 使用可见标记 + metadata 结合：
  - summary：`<!-- fold: <fold_id> -->\n...`
  - current-fold 区域：`<!-- current-fold: <fold_id> -->`
- 下次 fold 时通过扫描这些标记识别历史 summaries 和当前三项。

---

## 阶段四：测试与验证

- 更新 `tests/context-manager-fold-*.test.ts` 中依赖 snip/prune/pinned 的断言。
- 验证 fold 后 prompt 结构符合预期。
- 验证 toolcache 能完整召回 tool result。
- 跑 `npm run lint`、`npm run typecheck`、`npx vitest run`。

---

## 风险点

- 移除 append 时 shrink 后，超大 tool result 可能直接撑爆上下文；需要确保 fold 阈值能正常触发。
- summarizer 输入变为“上一届三项”，第一次 fold 不生成 summary，需调整相关测试。
- 标记解析要鲁棒，避免和普通 assistant/user 消息混淆。

# 上下文压缩指令

fold 摘要、强制摘要、framework 工件与 fewShots——这些是**运行时生成**的 prompt（每次压缩调用内联构造），非静态模板。

## 1. Fold 摘要（`src/context-manager.ts:655-729`）

### 指令文本（`:670-674`，约 370 字符）

"Summarize the previous fold above into a concise epoch recap (≤1024 tokens)，保留：原始目标、所有 do-not 指令、决策、文件、工具结果、open todos。纯散文、无工具调用、无标题、无 SEARCH/REPLACE。"

### 消息组装（`:675-680`）

```
system   = 实时 codeSystemPrompt（当前会话系统提示）
fewShots = getFewShots()（当前为空，见下）
用户消息 = 上一 fold 三工件：
          clustersMsg（决策簇） + frameworkMsgs（骨架） + hotzoneMsgs（热区）
+ 摘要指令
```

### 执行参数

- 模型：硬编码 `deepseek-v4-flash`（`:661`，已知优化点：模型 id 散落）
- thinking disabled、15s 超时（`:700-701`）
- 产物加 `HISTORY_FOLD_MARKER`（= `COMPACTION_SUMMARY_MARKER`，`:53`）

## 2. Framework 消息（`:510-547`）

`buildFrameworkMessages`：最近 `FRAMEWORK_TURNS=30` 轮去噪后转成：
- `[framework] userIntent`（user 角色）
- `[framework] Conclusion / Tools / Files / Errors` 骨架（assistant 角色）

`buildClustersMessage`（`:549-570`）：`<!-- current-fold: <id> -->` + "Decision clusters:" 列表。

## 3. 强制摘要（`src/loop/force-summary.ts:38-42`，约 330 字符）

user 角色指令："turn 被强制摘要（context guard 或 stuck），用纯散文总结工具结果学到什么，禁止工具调用/DSML/SEARCH/REPLACE"。

随后 `stripHallucinatedToolMarkup`（`:54`）兜底清理。

## 4. FewShots

- `getFewShots` 由 loop 提供（`src/loop.ts:330`，取 `prefix.fewShots`），仅 fold 摘要复用（`context-manager.ts:663,677`）
- 生产调用点（`acp.ts:181`、`run.ts:145`、`App.tsx:1044`、`subagent.ts:205`）构造 `ImmutablePrefix` 时均未传 fewShots → **当前默认为空**，机制存在但无内置 few-shot 内容（已知优化点：可启用）

## 5. 工具结果归档标记（非模型 prompt）

- `src/memory/archiver.ts:112-116`：超阈值工具结果替换为 `[archived: …]` 引用标记
- `:34-39`：~100K 边界插入 `[cache-stable boundary …]` 标记

## 已知问题汇总

| 问题 | 位置 |
|---|---|
| fold 摘要模型 id 硬编码 `deepseek-v4-flash` | `context-manager.ts:661` |
| 摘要指令与 force-summary 指令两套措辞独立编写 | `context-manager.ts:670-674` vs `force-summary.ts:38-42` |
| fewShots 管道存在但无内容 | `src/loop.ts:330`、各 ImmutablePrefix 调用点 |
| fold 阈值常量（0.5/0.75/0.78/0.9 等）硬编码 | `context-manager.ts:23-60` |

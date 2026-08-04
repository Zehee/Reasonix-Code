# 运行时小任务 Prompt

这些是运行时生成的**小型指令**（每次调用内联构造），用于特定任务，非系统提示词的一部分。

## 1. /init（生成 REASONIX.md）

`src/cli/ui/slash/handlers/init.ts:6-51+`：`INIT_PROMPT`（约 1,900 字符）作为用户任务模板发给模型生成 `REASONIX.md`。

约束：
- ≤80 行 / 3KB 硬约束
- 仅写可验证内容
- 5 步流程
- 6 个可选章节

性质：写入用户记忆文件的**生成指令**。

## 2. /title（会话标题生成）

- `src/cli/ui/slash/handlers/sessions.ts:7-20` → `src/session-title.ts:26-33`
- System prompt（约 230 字符）："只输出标题，无引号/无 markdown/≤6 词或 18 汉字"
- User 组装：截断 1,600 字符

## 3. /undo（回滚上下文）

- `src/cli/ui/slash/handlers/edits.ts:21-24` + `src/cli/ui/slash/undo-context.ts:18-26`
- 注入 `role: "system"` 消息（约 250 字符）：告知模型批次回滚、先前相关消息已过期

## 4. Plan mode 提示

- 系统提示章节：`src/code/prompt.ts:40-42`（plan mode 更强约束）
- 运行时 gate 拒绝消息：`src/tools.ts:345-350`（约 290 字符，作为 tool 结果返回给模型）
- approve/refine/cancel 后的合成用户消息：`src/cli/ui/App.tsx:3894-3904`（approve→"implement now"、refine→"revise"、cancel→"drop the plan"）

## 5. 非 prompt 的相邻机制（避免混淆）

| 机制 | 位置 | 说明 |
|---|---|---|
| repair 管线 | `src/repair/` | 启发式 JSON 修复（补括号/引号）、风暴守卫——**无模型调用** |
| refine 管线 | `src/refine/` | 规则/启发式去噪与实体提取——**无模型调用** |
| healing | `src/loop/healing.ts` | 消息配对修复（非 prompt） |
| 工具错误消息 | `src/tools.ts:308-313, 333-337` | 无效 JSON / 缺必填参数——作为 tool 结果发给模型 |

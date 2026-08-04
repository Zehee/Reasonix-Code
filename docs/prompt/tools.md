# 工具描述与收缩

## 1. 内置工具描述

手写字符串常量，定义在各工具文件：

```ts
// 示例：src/tools/plan-core.ts:6-13
SUBMIT_PLAN_DESCRIPTION    // ~500 字符
MARK_STEP_COMPLETE         // ~230 字符
REVISE_PLAN                // ~280 字符
```

参数 description 同样手写（如 `plan-core.ts:19-41`）。`src/tools/*` 各文件均为此模式。

## 2. 发送前收缩（`src/tools/schema-canon.ts:95-111`）

**关键机制**：工具 description 发送给模型前会被 `shrinkDescription` 收缩：

- 首句自包含（10-120 字符）→ 保留首句
- 否则截断至 120 字符，在句号边界断开

**含义**：手写的长 description（如 shell 规则 700 字符）在请求中实际只发送 ~80-120 字符——**长规则文本是"死字节"**（不参与请求，但占用维护成本）。

> 已知优化点：要么让关键长 description 豁免收缩（白名单），要么删除长文本、把规则收敛进系统提示词（当前 shell 规则实际由 `src/code/prompt.ts:110-114` 兜底）。

## 3. Schema 规范化（缓存稳定）

`canonicalizeSchema`（`src/tools/schema-canon.ts:27-77`）：
- 键排序
- 去 `$schema`
- 去空 description

保证前缀缓存字节稳定。`normalizeToolDescriptor`（`:116-126`）组合收缩 + 规范化。

## 4. MCP 工具描述

- `src/mcp/registry.ts:99-102`：`description: stableTool.description ?? ""` **原样透传，不收缩**
- schema 做 `canonicalizeSchemaForCache`（`:292-326`，键排序 + required 数组排序）——服务于缓存前缀而非省 token
- 默认截断：MCP 工具结果 8k tokens / 32k chars（`src/mcp/registry.ts:62-65`）

## 5. 工具结果截断

`src/tools.ts:413-435`：dispatch 时按 `maxResultTokens` / `maxResultChars` 截断工具结果。

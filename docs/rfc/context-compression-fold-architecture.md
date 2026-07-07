# Context Compression Fold Architecture

**Status:** Draft  
**Date:** 2026-07-07  
**Scope:** Reasonix Core / Context Manager / Turn Archiver  
**Related:** DeepSeek 1M context, prompt caching, tool-call repair, turn restoration

---

## 1. 背景与问题

Reasonix 面向 DeepSeek 1M 上下文设计。当对话长度增长到数百 K 时，主 prompt 面临三个矛盾：

1. **智力 vs 费用**：完整保留所有工具返回可维持最高推理质量，但 token 费用随上下文线性增长。
2. **缓存 vs 精度**：为了利用 DeepSeek 的缓存折扣，需要前缀稳定；但模型又需要引用近期工具结果，这部分天然是变化的。
3. **压缩 vs 召回**：过度压缩会丢失细节，导致模型 hallucinate；保留全文又让上下文膨胀。

因此需要一个**费用与智力平衡**的上下文管理策略。

---

## 2. 设计目标

| 目标 | 说明 |
|------|------|
| 缓存友好 | 前缀一旦形成，应尽量少改动，最大化缓存命中 |
| 保留辐射区 | 最近约 5 轮的工具结果必须完整保留，因为模型当前推理依赖它们 |
| 可精确召回 | 被压缩掉的历史细节必须能通过确定性机制还原，而不是依赖语义搜索 |
| 单跳跳变 | 压缩不应是持续渐进的过程，而应是一次性跳变，然后重新冷启动 |
| 低成本摘要 | 需要 LLM 介入的折叠操作，应尽量利用已有缓存 |
| 无信息单点故障 | fold 摘要不是唯一信息源，原始 turn 始终可还原 |

---

## 3. 核心思想：单跳压缩与四层上下文

### 3.1 单跳跳变

上下文增长过程不再采用多阶段降噪循环，而是：

- **阶段一：纯追加**。上下文增长，不压缩。
- **阶段二：Fold**。当上下文达到阈值时，一次性把历史压缩成摘要 + 框架 + 决策簇，然后以新的结构重新冷启动。

每次 fold 后，prompt 前缀进入新的稳定期，缓存命中率重新上升。

### 3.2 四层上下文结构

fold 后的主 prompt 按时间顺序由四层组成：

```
[Fold 递归摘要] → [决策簇] → [演化框架（30 轮）] → [热区原文（5 轮）] → [当前 Turn]
```

| 层级 | 范围 | 内容 | 稳定性 | 缓存角色 |
|------|------|------|--------|----------|
| Fold 递归摘要 | 更早 fold 的历史 | 高度提炼的战略摘要 | 最高 | 长期缓存命中 |
| 决策簇 | 跨 fold 的主题聚合 | 决策事实、文件引用、相关 turn IDs | 高 | 长期缓存命中 |
| 演化框架 | fold 前 30 轮 | 用户意图、工具调用、结论 | 中 | 稳定期内命中 |
| 热区原文 | 最近 5 轮 | 完整 user/assistant/tool 内容 | 低 | 每轮变化，接受 miss |

---

## 4. 四层结构详解

### 4.1 热区原文（Hot Zone，5 轮）

模型当前推理的辐射区。保留完整内容。

```typescript
interface HotZoneTurn {
  turn_id: string;              // 全局唯一，如 "t_184"
  timestamp: string;
  user: string;                 // 原始用户输入
  assistant_thinking?: string;  // 模型思考过程（如有）
  assistant_output: string;     // 模型最终输出
  tool_calls: ToolCall[];       // 完整工具调用
  tool_results: ToolResult[];   // 完整工具返回（未压缩）
}
```

**为什么不压缩**：
- 模型在第 N 轮频繁引用 N-1、N-2 轮的工具结果
- 跨 2-5 轮的多步工具调用链正在执行
- 压缩会打断当前任务流

### 4.2 演化框架（Evolution Framework，30 轮）

热区之前 30 轮。保留演化骨架，去掉原始素材。

```typescript
interface FrameworkTurn {
  turn_id: string;
  user_intent: string;          // 用户意图压缩，不是原文复制
  tools_called: {
    name: string;
    args: Record<string, any>;  // 工具名和参数，保留读了哪些文件
  }[];
  assistant_conclusion: string; // 本轮最终结论
  key_files: string[];          // 涉及文件路径
  status: "ongoing" | "resolved" | "failed";
}
```

**保留什么**：
- 用户意图（一句话概括）
- 工具调用清单（读了什么、改了什么）
- 结论（学到了什么、决定做什么）

**去掉什么**：
- 工具返回的原始文本
- 大段代码片段
- 中间试错过程

### 4.3 决策簇（Decision Clusters）

按主题/任务聚合相关 turns，非时序索引。

```typescript
interface DecisionCluster {
  cluster_id: string;           // 如 "c_7"
  topic: string;                // 主题，如 "auth 模块登录失败排查"
  decision: string;             // 最终决策
  facts: string[];              // 关键事实
  file_refs: string[];          // 文件引用，可带行号，如 "src/db.ts:88"
  turn_ids: string[];           // 相关 turn IDs，用于精确还原
  status: "resolved" | "ongoing" | "superseded";
  created_at_fold_id?: string;  // 在哪个 fold 中生成
}
```

**作用**：
- 让模型不用读 30 轮就能知道“我之前做了什么决定”
- 提供精确的还原入口（turn_ids）
- 跨 fold 保留关键决策，避免递归摘要丢失重要结论

### 4.4 Fold 递归摘要（Fold Summary）

对更老历史的递归压缩。

```typescript
interface FoldSummary {
  fold_id: string;              // 如 "f_3"
  summary: string;              // 自然语言总体摘要
  major_decisions: string[];    // cluster_ids
  architectural_changes: string[];
  restorable_turn_ranges: [string, string][];  // [["t_1", "t_37"], ...]
  previous_fold_id?: string;    // 链式引用
}
```

**设计原则**：
- 只保留仍然相关的战略级信息
- 具体细节通过 cluster/turn_id 还原
- 多个 fold 形成链式摘要

---

## 5. Fold 机制

### 5.1 触发条件

fold 是单跳压缩的唯一入口。

```typescript
function shouldFold(context: Context): boolean {
  const totalTokens = context.estimateTokens();
  const frameworkTokens = context.frameworkEstimateTokens();
  const hasPendingToolChain = context.hasPendingToolChain();

  return (
    totalTokens > FOLD_TOKEN_THRESHOLD &&          // 例如 700K
    frameworkTokens / totalTokens > 0.7 &&         // 框架占比过高
    !hasPendingToolChain                           // 不在未完成的工具链中间
  );
}
```

**参数建议**：

| 参数 | 建议值 | 说明 |
|------|--------|------|
| `FOLD_TOKEN_THRESHOLD` | 700K | 预留 300K 缓冲给当前 turn |
| 框架占比阈值 | 70% | 说明可压缩内容足够多 |
| 热区轮数 | 5 | 辐射区 |
| 框架轮数 | 30 | 保留较长故事链 |
| 摘要上限 | 50K | fold 后新增摘要不超过 50K |

### 5.2 Fold 流程

```typescript
async function fold(context: Context): Promise<Context> {
  // 1. 保留热区
  const hotZone = context.lastNTurns(HOT_ZONE_TURNS);

  // 2. 提取演化框架
  const frameworkSource = context.turns.slice(
    -(HOT_ZONE_TURNS + FRAMEWORK_TURNS),
    -HOT_ZONE_TURNS
  );
  const framework = frameworkSource.map(buildFrameworkTurn);

  // 3. 生成/更新决策簇
  const existingClusters = context.clusters;
  const clusters = await llmGenerateClusters(framework, existingClusters);

  // 4. 递归摘要旧 fold
  const previousFoldSummary = await distillPreviousFold(
    context.foldSummary,
    clusters
  );

  // 5. 组装新上下文
  return {
    hotZone,
    framework,
    clusters,
    foldSummary: previousFoldSummary,
    archivedTurns: context.archivedTurns.concat(context.foldedTurns)
  };
}
```

### 5.3 与缓存配合的摘要

fold 触发时，被压缩的框架区已经存在于 prompt 中一段时间，大概率已被缓存。因此调用 LLM 生成决策簇和摘要时：

- 输入中的框架区是缓存命中
- 只有当前请求新增的提示部分是 miss
- 比直接重新加载全文做摘要便宜

```
摘要请求输入 =
  [fold 旧摘要]     <- 命中
  [现有决策簇]      <- 命中
  [30 轮演化框架]   <- 命中（已稳定存在）
  [摘要生成指令]    <- miss
```

---

## 6. Turn ID 精确还原

### 6.1 设计原则

所有 turn 在创建时分配全局唯一 ID。被压缩后，ID 保留在演化框架和决策簇中。模型可以通过工具精确还原。

### 6.2 还原工具

```typescript
interface RestoreTurnArgs {
  turn_id: string;              // 精确指定
}

interface RestoreTurnRangeArgs {
  start_turn_id: string;
  end_turn_id: string;
}
```

工具返回完整原始 turn 内容，以临时方式注入当前 turn，不污染长期前缀。

### 6.3 还原流程

```
模型在决策簇中看到 turn_ids: ["t_45", "t_46", "t_48"]
        ↓
模型调用 restore_turn_range("t_45", "t_48")
        ↓
系统从 archived jsonl / 外部存储读取原始 turns
        ↓
作为临时上下文附加到当前 turn
        ↓
当前请求完成后丢弃，下次需要再重新还原
```

**优点**：
- 确定性，无检索幻觉
- 不破坏缓存前缀
- 还原范围可控

---

## 7. 缓存与成本分析

### 7.1 单跳 vs 多阶段

| | 多阶段渐进降噪 | 单跳 fold |
|---|---|---|
| 前缀改动频率 | 高 | 低 |
| 缓存命中率 | 反复波动 | fold 后重新稳定 |
| 单次 miss 规模 | 小但频繁 | 大但罕见 |
| 长期成本 | 更高 | 更低 |
| 实现复杂度 | 高 | 低 |
| 智力稳定性 | 差 | 好 |

### 7.2 费用构成

一次 fold 后的普通请求：

```
总费用 ≈
  foldSummary  (hit, 100K × 10%) +
  clusters     (hit, 50K × 10%) +
  framework    (hit, 200K × 10%) +
  hotZone      (miss, 100K × 100%) +
  currentTurn  (miss, 20K × 100%)
```

等效全价 token ≈ 100K + 20K = 120K，而不是 470K。

### 7.3 缓存真的便宜吗？

缓存命中 token 按原价 10% 计费（以 DeepSeek 定价为例）。虽然便宜，但当 hit 基数极大时：

- 700K hit × 10% = 70K 等效全价 token
- 50K miss × 100% = 50K 等效全价 token
- hit 部分仍占总费用的 58%

**结论**：缓存命中不是免费，只是打折。优化的真正重点是**减少 miss tokens**，而不是无限压缩 hit tokens。

---

## 8. 实现建议

### 8.1 移除独立降噪工具

旧设计中的独立 denoise 工具或循环降噪逻辑应移除。压缩统一由 `fold()` 处理。

### 8.2 数据持久化

原始 turns 不应因 fold 被删除，而是归档到外部存储：

```
active_context.jsonl   <- 当前 prompt 使用的结构
archived_turns/        <- 按 fold_id 归档的原始 turns
```

### 8.3 框架轮数自适应

30 轮是默认值，可按任务复杂度调整：

```typescript
function adaptiveFrameworkTurns(context: Context): number {
  const complexity = context.recentComplexityScore(); // 工具密度、跨文件引用等
  return Math.min(40, Math.max(10, complexity * 5));
}
```

### 8.4 摘要质量校验

fold 后应校验摘要是否保留了关键信息：

- 决策簇中是否包含最近的重要文件引用
- 是否存在状态为 `ongoing` 但未完成的 clusters
- 还原工具是否能正确找到对应的 turn_ids

---

## 9. 边界情况

### 9.1 当前 turn 超大

如果当前 turn 的工具返回超过 100K，可能瞬间突破 1M 限制。应在工具调用前做大小检查，必要时分片读取。

### 9.2 未完成工具链时触发 fold

`hasPendingToolChain` 为 true 时，应推迟 fold。即使 token 阈值已触发，也应等当前工具链完成，避免打断模型推理。

### 9.3 多个 fold 链过长

经过多轮 fold 后，`FoldSummary` 可能本身变得很长。此时可以对 `FoldSummary` 做二次 fold，形成树状摘要：

```
f_3 summary -> references f_2 summary
f_2 summary -> references f_1 summary
```

### 9.4 模型主动要求还原旧 turn

模型可能通过 `restore_turn` 工具拉取旧内容。这些临时内容应：
- 只注入当前请求
- 不参与下一次请求的缓存前缀
- 在日志中记录，便于分析还原频率

---

## 10. 与现有系统的关系

### 10.1 ContextManager

ContextManager 负责维护四层结构，决定何时 fold，以及构建最终 prompt。

### 10.2 TurnArchiver

TurnArchiver 负责：
- 为每个 turn 分配全局 ID
- 持久化原始 turn 到归档存储
- 支持 `restore_turn(turn_id)` 查询

fold 后，TurnArchiver 不应删除旧 turn，而是标记为 `archived`。

### 10.3 Tool-Call Repair

tool-call repair 涉及修改历史消息。repair 完成后，如果修改的位置在热区，直接生效；如果在框架区或更老，可能需要触发一次 fold 或标记相关 cluster 为 stale。

---

## 11. 决策记录

### 11.1 为什么不用渐进降噪？

渐进降噪会反复改变前缀，导致缓存反复 miss。对于 1M 上下文窗口，完全可以在阈值触发前保持原文，触发后一次性压缩。

### 11.2 为什么保留 30 轮框架？

5 轮热区只覆盖当前任务片段，30 轮框架能覆盖一个完整的子任务周期（如一次完整的调试或重构），保留足够的故事链。

### 11.3 为什么需要决策簇？

框架是按时间组织的，决策簇是按主题组织的。模型需要快速回答“我之前做了什么决定”，而不是逐轮阅读。

### 11.4 为什么保留 turn_id 而不是直接删除？

精确还原能力让压缩没有信息单点故障。模型可以随时拉回任何被压缩掉的细节，且不影响缓存前缀。

---

## 12. 下一步工作

1. 定义四层数据结构并实现序列化/反序列化
2. 实现 `fold()` 方法，移除旧 denoise 逻辑
3. 实现 `restore_turn(turn_id)` 工具
4. 在 TurnArchiver 中支持按 ID 归档查询
5. 设置 fold 触发阈值和自适应参数
6. 用长对话基准测试 fold 前后的成本与智力表现

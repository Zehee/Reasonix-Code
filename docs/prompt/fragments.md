# 共享 Prompt 片段

单一来源（`src/prompt-fragments.ts`），多处以 `${}` 拼接，避免跨 prompt 措辞漂移。

> 设计约束：`TUI_FORMATTING_RULES` 声明为"嵌入式字面量，不插值"（`src/prompt-fragments.ts:3`）——保证前缀缓存哈希跨会话稳定。

## 片段清单

| 片段 | 类型 | 位置 | 估算长度 | 内容主题 | 消费者 |
|---|---|---|---|---|---|
| `TUI_FORMATTING_RULES` | 常量 | `src/prompt-fragments.ts:4-9` | ~1,100 字符 | TUI 渲染规则：GFM 表格、禁 Unicode 框线、代码围栏、流程图用箭头列表 | code 模板、技能 body |
| `escalationContract(modelId)` | 函数 | `:12-25` | pro ~270 / flash ~1,100 | 升级契约：`<<<NEEDS_PRO>>>` 标记协议、两种形式、使用纪律、自动升级触发 | code 模板、run、子代理 |
| `ESCALATION_CONTRACT` | 常量 | `:28` | ~1,100 | `escalationContract("deepseek-v4-flash")` 历史快照，向后兼容 `CODE_SYSTEM_PROMPT` | 公共 API |
| `NEGATIVE_CLAIM_RULE` | 常量 | `:30-36` | ~950 字符 | 负面声明先搜工具、有证据地引用 absence、无工具时明示猜测 | 内置技能 body（如 explore/review） |

## 详情

### TUI_FORMATTING_RULES

TUI 渲染格式规则：
- 表格用 GFM 管道语法，**禁用 Unicode 框线字符**（│ ─ ┼ ┌ ┐ └ ┘ ├ ┤）
- 单元格保持短语级；需要段落时在表格下方用列表
- 代码/路径/命令用围栏块
- 禁止装饰性 ASCII 框
- 流程图用 `→`/`↓` 箭头列表，不画 ASCII 框线

### escalationContract(modelId)

- **deepseek-v4-pro**：no-op 说明（无更高层可升级）
- **其他模型**：`<<<NEEDS_PRO>>>` / `<<<NEEDS_PRO: 原因>>>` 标记协议；明确"响应第一行必须是标记"、使用纪律（正常任务不升级）、自动升级触发条件（3+ repair 错误）

### NEGATIVE_CLAIM_RULE

负面声明（"X 缺失"、"Y 未实现"）是 #1 幻觉形态：
- 有搜索工具 → 先搜；有结果就纠正并引用；无结果则带查询引用 absence
- 无搜索工具 → 明示 "I haven't verified — this is a guess"
- 禁止凭空断言

## 注意：负面规则存在重复内嵌

当前 code 模板（`src/code/prompt.ts:21`）与 run 的 `defaultSystemPrompt`（`src/cli/index.ts:71-77`）各自**内嵌**了负面声明段落（措辞与 `NEGATIVE_CLAIM_RULE` 同义但不同文）。已知优化点：统一改为引用 `NEGATIVE_CLAIM_RULE` 片段，消除漂移。

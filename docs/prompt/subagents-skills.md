# 子代理与技能 Prompt

## 1. 子代理系统提示词（`src/tools/subagent.ts`）

### 组装

- `SUBAGENT_BASE_SYSTEM`（`src/tools/subagent.ts:99-109`，约 700 字符）：子代理基础身份/纪律（隔离子循环、只返回结论）
- 按 spawn 追加 `escalationContract(modelId)`（`:111-113`）
- 选择顺序（`:537-540`）：显式 `system` 参数 → `typeSpec?.system` → 默认
- 预算提示 `subagentBudgetHint`（`:135` 起）：spawn 计数/令牌阈值驱动的软硬提示

### 内置 persona（`src/tools/subagent-types.ts`）

| persona | 位置 | 长度 | 内容 |
|---|---|---|---|
| `EXPLORE_SYSTEM` | `:11-26` | ~900 字符 | 广网只读调查 |
| `VERIFY_SYSTEM` | `:28-42` | ~800 字符 | YES/NO/INCONCLUSIVE 验证格式 |

## 2. 内置技能（`src/skills.ts:657-712` 注册）

body 为静态模板，拼接 `${NEGATIVE_CLAIM_RULE}` 与 `${TUI_FORMATTING_RULES}`。

| 技能 | 类型 | 位置 | 估算 | 内容 |
|---|---|---|---|---|
| `explore` | 🧬 subagent | `:467-486` | ~1,700 | 只读广网调查、grep≠search_files 提醒、最终答案格式 |
| `research` | 🧬 subagent | `:488-506` | ~1,300 | 代码+网络双源、约 10 次调用上限、区分"代码验证/文档读到" |
| `review` | 🧬 subagent | `:508-535` | ~2,300 | git diff 审查、5 类优先级、verdict 格式 |
| `security-review` | 🧬 subagent | `:537-582` | ~3,300 | 威胁模型 CRITICAL/HIGH/MEDIUM 清单 |
| `test` | inline | `:584-614` | ~2,900 | 测试命令探测、修复流程、2 次尝试上限 |
| `qq` | inline | `:616-655` | ~1,900 | QQ 频道配置/故障排查（含中英混合安全提醒） |

## 3. 技能索引注入

- `applySkillsIndex`（`src/skills.ts:440-465`）：`# Skills — playbooks you can invoke` 说明头（约 700 字符）+ 一行式索引
- 每行：name + `[🧬 subagent]` 标签 + 描述（`skillIndexLine`，`:428-434`，截断 130 字符）
- 总上限 4,000 字符（`:449-453`）
- 用户技能：磁盘 `SKILL.md` 惰性加载（body 运行时读取）

## 已知问题

- `qq` 技能 body 内嵌中文安全提醒（`src/skills.ts:630`）——中英混杂（优化点：统一英文或 i18n）
- `test` 技能描述与 `src/i18n/EN.ts:2085` 重复维护

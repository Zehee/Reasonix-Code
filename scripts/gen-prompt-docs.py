# -*- coding: utf-8 -*-
"""Generate docs/prompt/prompt.md (zh) + docs/prompt/prompt.en.md (en).

Extracts the verbatim text of every prompt node from source, in final
render order. Notes are bilingual; prompt text stays as-is (English).
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf8") as f:
        return f.read().split("\n")


def extract(path, start, end):
    """1-based line-range extraction."""
    lines = read(path)
    return "\n".join(lines[start - 1 : end])


def strip_ts_literal(text, prefix):
    """Strip a TS template-literal shell (prefix ... trailing `;)."""
    assert text.startswith(prefix), (prefix[:40], text[:60])
    body = text[len(prefix) :]
    assert body.rstrip().endswith("`;"), body[-30:]
    return body.rstrip()[:-2]


# ── 1. CODE_SYSTEM_TEMPLATE ──
raw = extract("src/code/prompt.ts", 13, 133)
N1 = strip_ts_literal(raw, "const CODE_SYSTEM_TEMPLATE = `")

# ── 2. escalationContract ──
N2 = extract("src/prompt-fragments.ts", 12, 25)

# ── 3. TUI_FORMATTING_RULES ──
raw = extract("src/prompt-fragments.ts", 4, 9)
N3 = strip_ts_literal(raw, "export const TUI_FORMATTING_RULES = `")

# ── 4. SEMANTIC_SEARCH_ROUTING ──
raw = extract("src/code/prompt.ts", 139, 148)
N4 = strip_ts_literal(raw, "const SEMANTIC_SEARCH_ROUTING = `")

# ── 5. HISTORY_TRACING_GUIDE ──
raw = extract("src/code/prompt.ts", 150, 175)
N5 = strip_ts_literal(raw, "const HISTORY_TRACING_GUIDE = `")

# ── 13. defaultSystemPrompt ──
raw = extract("src/cli/index.ts", 64, 86)
N13 = raw.split("return `", 1)[1]
N13 = N13.rstrip()[:-2]

# ── 14. SUBAGENT_BASE_SYSTEM ──
raw = extract("src/tools/subagent.ts", 99, 109)
N14 = strip_ts_literal(raw, "const SUBAGENT_BASE_SYSTEM = `")

# ── 15/16. EXPLORE / VERIFY personas（按内容定位，防行号漂移）──
ST = read("src/tools/subagent-types.ts")


def ts_body_of(lines, start_prefix):
    i = next(i for i, l in enumerate(lines) if l.startswith(start_prefix))
    start = i + 1
    for j in range(start, len(lines)):
        if lines[j].rstrip().endswith("`;"):
            return "\n".join(lines[start:j])
    raise AssertionError(start_prefix)


N15 = ts_body_of(ST, "const EXPLORE_SYSTEM = `")
N16 = ts_body_of(ST, "const VERIFY_SYSTEM = `")

# ── 17. built-in skill bodies ──
SK = read("src/skills.ts")


def body_of(name):
    i = next(i for i, l in enumerate(SK) if l.startswith("const %s = `" % name))
    start = i + 1
    for j in range(start, len(SK)):
        if SK[j].rstrip().endswith("`;"):
            return "\n".join(SK[start:j])
    raise AssertionError(name)


N17 = {
    "explore": body_of("BUILTIN_EXPLORE_BODY"),
    "research": body_of("BUILTIN_RESEARCH_BODY"),
    "review": body_of("BUILTIN_REVIEW_BODY"),
    "security-review": body_of("BUILTIN_SECURITY_REVIEW_BODY"),
    "test": body_of("BUILTIN_TEST_BODY"),
    "qq": body_of("BUILTIN_QQ_BODY"),
}

# ── 18. fold instruction ──
raw = extract("src/context-manager.ts", 670, 674)
N18 = "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', raw.split("const instruction =")[1]))

# ── dynamic template nodes: fixed copy (sources noted) ──
N6 = """${basePrompt}

# Project memory (${filename})

The user pinned these notes about this project — treat them as authoritative context for every turn:

```
${mem.content}
```"""

N7 = """${basePrompt}

# Global memory (~/.reasonix/REASONIX.md)

Cross-project notes the user pinned via the `#g` prompt prefix. Treat as authoritative — same level of trust as project memory.

```
${mem.content}
```"""

N8 = """${basePrompt}

# Global memory (~/.claude/CLAUDE.md)

Cross-project notes from your Claude Code configuration. Treat as authoritative — same level of trust as project memory.

```
${mem.content}
```"""

N9 = """${basePrompt}

[插入条件：存在 priority:high 条目时]
# HIGH PRIORITY constraints (must observe)

These memories were declared `priority: high` (via config.memory.customTypes or the memory file itself). Treat them as hard rules — violations override any other guidance below.

!!! [${scope}/${type}/${name}] ${description}

# User memory — global (~/.reasonix/memory/global/MEMORY.md)

Cross-project facts and preferences the user has told you in prior sessions. TREAT AS AUTHORITATIVE — don't re-verify via filesystem or web. One-liners index detail files; call `recall_memory` for full bodies only when the one-liner isn't enough.

```
${global.content}
```

# User memory — this project

Per-project facts the user established in prior sessions (not committed to the repo). TREAT AS AUTHORITATIVE. Same recall pattern as global memory.

```
${project.content}
```"""

N10 = """${basePrompt}

# Skills — playbooks you can invoke

One-liner index. Each entry is either a built-in or a user-authored playbook. Call `run_skill({ name: "<skill-name>", arguments: "<task>" })` — the `name` is JUST the skill identifier (e.g. `"explore"`), NOT the `[🧬 subagent]` tag that appears after it. Entries tagged `[🧬 subagent]` spawn an **isolated subagent** — its tool calls and reasoning never enter your context, only its final answer does. Use subagent skills for tasks that would otherwise flood your context (deep exploration, multi-step research, anything where you only need the conclusion). Plain skills are inlined: their body becomes a tool result you read and act on directly. The user can also invoke a skill via `/skill <name>`.

```
- <skill-name>[ 🧬 subagent] — <clipped description>
（索引行，超长截断）
```"""

N11 = """${withMemory}

# Project .gitignore

The user's repo ships this .gitignore — treat every pattern as "don't traverse or edit inside these paths unless explicitly asked":

```
${gitignore 内容，2000 字符截断}
```"""

N12 = """${result}

# User System Append

${systemAppend 与 systemAppendFile 合并，按传入顺序}"""

N19 = extract("src/tools/schema-canon.ts", 95, 111)

nodes = [
    ("1", "CODE_SYSTEM_TEMPLATE（身份与规则基座）", "src/code/prompt.ts:13-133",
     "无条件（code 模式第一块）。19 段固定文案：身份固定、引用证据、审计护栏、工具选型、编辑规则等。`__ESCALATION_CONTRACT__` 与 `${TUI_FORMATTING_RULES}` 为占位符，渲染时替换为节点 2 / 3。",
     "Unconditional (first block of code mode). 19 fixed sections: identity, citation, audit rails, tool picking, edit rules. `__ESCALATION_CONTRACT__` and `${TUI_FORMATTING_RULES}` are placeholders replaced by nodes 2 / 3.",
     N1),
    ("2", "escalationContract（升级契约）", "src/prompt-fragments.ts:12-25",
     "替换节点 1 的 `__ESCALATION_CONTRACT__`。pro 模型为 no-op 变体；flash 及其它模型输出 `<<<NEEDS_PRO>>>` 阶梯。",
     "Replaces `__ESCALATION_CONTRACT__` in node 1. Pro models get a no-op variant; flash and others get the `<<<NEEDS_PRO>>>` ladder.",
     N2),
    ("3", "TUI_FORMATTING_RULES（格式规则）", "src/prompt-fragments.ts:4-9",
     "替换节点 1 的 `${TUI_FORMATTING_RULES}`。TUI 渲染的表格/代码块/装饰规则，字面嵌入（不插值，保持前缀缓存稳定）。",
     "Replaces `${TUI_FORMATTING_RULES}` in node 1. TUI table/code-block/decor rules; embedded literally (no interpolation, stable cache prefix).",
     N3),
    ("4", "SEMANTIC_SEARCH_ROUTING（搜索路由）", "src/code/prompt.ts:139-148",
     "仅当 `hasSemanticSearch`（semantic_search 工具注册时）。描述性查询先 semantic_search，精确 token 先 grep。",
     "Only when `hasSemanticSearch` (semantic_search registered). Descriptive queries → semantic_search first; exact-token queries → grep.",
     N4),
    ("5", "HISTORY_TRACING_GUIDE（跨会话历史追踪）", "src/code/prompt.ts:150-175",
     "无条件。list_themes / trace_theme 工作流，主题 = 长期话题的时间线聚类。",
     "Unconditional. list_themes / trace_theme workflow; a theme is a chronological cluster of turns about one long-running topic.",
     N5),
    ("6", "记忆栈 · Project memory", "src/memory/project.ts:97-112",
     "REASONIX.md → CLAUDE.md → AGENTS.md → AGENT.md 优先级，8000 字符截断。`${filename}` / `${mem.content}` 为插入点。",
     "REASONIX.md → CLAUDE.md → AGENTS.md → AGENT.md priority, 8000-char cap. `${filename}` / `${mem.content}` are insertion points.",
     N6),
    ("7", "记忆栈 · Global memory (~/.reasonix/REASONIX.md)", "src/memory/user.ts:333-349",
     "跨项目固定笔记（`#g` 前缀写入），8000 字符截断。",
     "Cross-project pinned notes (written via `#g` prefix), 8000-char cap.",
     N7),
    ("8", "记忆栈 · Global memory (~/.claude/CLAUDE.md)", "src/memory/user.ts:374-389",
     "从 Claude Code 迁移的跨项目笔记，8000 字符截断。",
     "Cross-project notes migrated from Claude Code, 8000-char cap.",
     N8),
    ("9", "记忆栈 · User memory（用户记忆）", "src/memory/user.ts:400-456",
     "HIGH PRIORITY 约束块（若有 high 条目）+ 全局用户记忆（4000 字符）+ 项目用户记忆。均视为权威，不重复验证。",
     "HIGH PRIORITY constraints block (if any high entries) + global user memory (4000 chars) + project user memory. All treated as authoritative.",
     N9),
    ("10", "记忆栈 · Skills 索引", "src/skills.ts:440-465",
     "`[🧬 subagent]` 标签说明 + 一行索引清单（截断保护）。",
     "`[🧬 subagent]` tag explanation + one-line index (truncation-guarded).",
     N10),
    ("11", "主链路 · .gitignore 块", "src/code/prompt.ts:204-217",
     "仓库 .gitignore 内容（2000 字符截断），作为遍历/编辑禁区清单。",
     "Repo .gitignore content (2000-char cap) as a traversal/edit denylist.",
     N11),
    ("12", "主链路 · User System Append", "src/code/prompt.ts:218-221",
     "systemAppend 与 systemAppendFile 合并追加（append-only，不替换默认）。",
     "systemAppend + systemAppendFile joined (append-only, never replaces the default).",
     N12),
    ("13", "run 模式 · defaultSystemPrompt", "src/cli/index.ts:64-86",
     "`reasonix-code run <task>` 的系统提示词（独立链路）：身份 + 引用规则 + 不要凭空捏造变更 + escalationContract。",
     "System prompt for `reasonix-code run <task>` (separate chain): identity + citation + don't-invent-what-changes + escalationContract.",
     N13),
    ("14", "subagent · SUBAGENT_BASE_SYSTEM", "src/tools/subagent.ts:99-109",
     "通用子代理基座（内嵌 NEGATIVE_CLAIM_RULE + TUI_FORMATTING_RULES），spawn 时追加 escalationContract。",
     "Generic subagent base (embeds NEGATIVE_CLAIM_RULE + TUI_FORMATTING_RULES); escalationContract appended per spawn.",
     N14),
    ("15", "subagent · EXPLORE persona", "src/tools/subagent-types.ts:11-25",
     "内联 explore 快捷 persona：只读广撒网调查，返回单一蒸馏结论。",
     "Inline explore shortcut persona: read-only wide-net investigation, one distilled answer.",
     N15),
    ("16", "subagent · VERIFY persona", "src/tools/subagent-types.ts:27-40",
     "内联 verify 快捷 persona：窄范围核验，VERIFIED / NOT VERIFIED / INCONCLUSIVE。",
     "Inline verify shortcut persona: narrow check, VERIFIED / NOT VERIFIED / INCONCLUSIVE.",
     N16),
    ("17", "skills · 内置技能 body（6 个）", "src/skills.ts:467-630",
     "explore / research / review / security-review / test 为子代理或内联技能正文；QQ body 含中文安全提醒。作为 run_skill 的子代理 system（或内联注入）。",
     "explore / research / review / security-review / test bodies (subagent or inline); QQ body has a Chinese safety reminder. Used as subagent system via run_skill (or inlined).",
     None),
    ("18", "折叠摘要 · fold 指令", "src/context-manager.ts:670-674",
     "上下文折叠时的 epoch 摘要指令（≤1024 tokens），system 复用主 agent 的。",
     "Epoch-recap instruction for context folds (≤1024 tokens); system reuses the main agent's.",
     N18),
    ("19", "工具描述 · shrinkDescription（压缩规则）", "src/tools/schema-canon.ts:95-111",
     "非 system 文本，但与 system 同批进请求：工具描述压缩到 ≤120 字符（保留首句/句边界）。",
     "Not system text but ships with it: tool descriptions shrunk to ≤120 chars (first sentence / sentence boundary).",
     N19),
]

SUB_LABEL = {
    "explore": "1 · explore",
    "research": "2 · research",
    "review": "3 · review",
    "security-review": "4 · security-review",
    "test": "5 · test",
    "qq": "6 · qq（含中文安全提醒 / includes Chinese safety reminder）",
}


def render_node(num, title, src, zh, en, body, lang):
    fence = "````text"
    title_line = ("## 节点 %s · %s" % (num, title)) if lang == "zh" else ("## Node %s · %s" % (num, title))
    src_line = "- **来源 / Source**: `%s`" % src
    cond = ("- **说明**: %s" % zh) if lang == "zh" else ("- **Notes**: %s" % en)
    out = ["---", "", title_line, "", src_line, cond, ""]
    if body is not None:
        out += [fence, body, "````", ""]
    elif num == "17":
        for k in ["explore", "research", "review", "security-review", "test", "qq"]:
            out += [
                "#### 17.%s · BUILTIN_%s_BODY" % (SUB_LABEL[k].split(" ")[0], k.upper()),
                "",
                fence,
                N17[k],
                "````",
                "",
            ]
    return "\n".join(out)


def build(lang):
    head = (
        [
            "# Prompt 节点全览（按渲染顺序）",
            "",
            "> 本文档收录 reasonix-code 所有 prompt 节点的**原文**，按最终渲染顺序排列。",
            "> 每个节点以分割线分隔，注明来源（file:line）、触发条件与说明。",
            "> 英文版见 [prompt.en.md](./prompt.en.md)。",
            "",
        ]
        if lang == "zh"
        else [
            "# Prompt Nodes — complete inventory (in render order)",
            "",
            "> This document collects the verbatim text of every prompt node in reasonix-code, in final render order.",
            "> Each node is separated by a divider, with source (file:line), condition and notes.",
            "> 中文版见 [prompt.md](./prompt.md)。",
            "",
        ]
    )
    for num, title, src, zh, en, body in nodes:
        head.append(render_node(num, title, src, zh, en, body, lang))
    return "\n".join(head)


os.makedirs(os.path.join(ROOT, "docs", "prompt"), exist_ok=True)
with open(os.path.join(ROOT, "docs", "prompt", "prompt.md"), "w", encoding="utf8", newline="") as f:
    f.write(build("zh") + "\n")
with open(os.path.join(ROOT, "docs", "prompt", "prompt.en.md"), "w", encoding="utf8", newline="") as f:
    f.write(build("en") + "\n")
print("done: docs/prompt/prompt.md + docs/prompt/prompt.en.md")

# Node 3 · TUI_FORMATTING_RULES（格式规则）

## 来源

`src/prompt-fragments.ts:4-9`

## 说明

替换节点 1 的 `${TUI_FORMATTING_RULES}`。TUI 渲染的表格/代码块/装饰规则，字面嵌入（不插值，保持前缀缓存稳定）。

## 原文（中文翻译稿，供对照）

> /** 字面嵌入——不插值，保持前缀缓存 hash 在跨会话间稳定。 */
> export const TUI_FORMATTING_RULES = `Formatting (rendered in a TUI with a real markdown renderer):
> - Tabular data → GitHub-Flavored Markdown tables with ASCII pipes (\\`| col | col |\\` header + \\`| --- | --- |\\` separator). Never use Unicode box-drawing characters (│ ─ ┼ ┌ ┐ └ ┘ ├ ┤) — they look intentional but break terminal word-wrap and render as garbled columns at narrow widths.
> - Keep table cells short (one phrase each). If a cell needs a paragraph, use bullets below the table instead.
> - Code, file paths with line ranges, and shell commands → fenced code blocks (\\`\\`\\`).
> - Do NOT draw decorative frames around content with \\`┌──┐ │ └──┘\\` characters. The renderer adds its own borders; extra ASCII art adds noise and shatters at narrow widths.
> - For flow charts and diagrams: a plain bullet list with \\`→\\` or \\`↓\\` between steps. Don't try to draw boxes-and-arrows in ASCII; it never survives word-wrap.`;


## v2

_（待细化）_
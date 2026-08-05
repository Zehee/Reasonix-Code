# Node 19 · 工具描述 · shrinkDescription（压缩规则）

## 来源

`src/tools/schema-canon.ts:95-111`

## 说明

非 system 文本，但与 system 同批进请求：工具描述压缩到 ≤120 字符（保留首句/句边界）。

## 原文（中文翻译稿，供对照）

> export function shrinkDescription(description: string): string {
>   // If the description ends in '.' and the first sentence fits in
>   // [10, 120] chars, keep the whole first sentence. This preserves
>   // natural prose without truncating at an arbitrary character.
>   const trimmed = description.trim();
>   const m = trimmed.match(/^(\S.{5,200}?[\.!？。])\s/);
>   if (m) {
>     const first = m[1];
>     if (first.length <= 120 && first.length >= 10) return first;
>   }
>   // Truncate to 120 chars at a sentence boundary.
>   const truncated = trimmed.slice(0, 120);
>   const lastDot = truncated.lastIndexOf(".");
>   if (lastDot > 10) return truncated.slice(0, lastDot + 1);
>   return truncated;
> }


## v2

_（待细化）_
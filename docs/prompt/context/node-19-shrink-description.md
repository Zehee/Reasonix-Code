# Node 19 · 工具描述 · shrinkDescription（压缩规则）

## 来源

`src/tools/schema-canon.ts:95-111`

## 说明

非 system 文本，但与 system 同批进请求：工具描述压缩到 ≤120 字符（保留首句/句边界）。

## 原文（中文翻译稿，供对照）

> `shrinkDescription` 是工具描述压缩函数（`src/tools/schema-canon.ts:95-111`）。它不是 system 文本，但与 system 同批进请求——会显著影响工具层的 token 占用。
>
> 原文（翻译代码注释）——
>
> ```ts
> export function shrinkDescription(description: string): string {
>   // 如果描述以 "." 结尾且第一句长度在 [10, 120] 字符之间，
>   // 保留整句。这样保留自然散文，而不是在任意字符处截断。
>   const trimmed = description.trim();
>   const m = trimmed.match(/^(\S.{5,200}?[\.!？。])\s/);
>   if (m) {
>     const first = m[1];
>     if (first.length <= 120 && first.length >= 10) return first;
>   }
>   // 硬截断到 120 字符，在句号边界收尾。
>   const truncated = trimmed.slice(0, 120);
>   const lastDot = truncated.lastIndexOf(".");
>   if (lastDot > 10) return truncated.slice(0, lastDot + 1);
>   return truncated;
> }
> ```

## v2

_（待细化）_

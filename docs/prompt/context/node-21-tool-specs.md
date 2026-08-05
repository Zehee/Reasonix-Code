# Node 21 · 工具层 · Tool specs 注入（动态节点）

## 来源

`src/tools/*.ts → src/tools/schema-canon.ts`

## 说明

与 system 同批注入请求的动态节点：47 个内置工具名 + 压缩后描述 + 参数 schema。条件注册 semantic_search / MCP 工具。

## 原文

> # Tool specs — injected with every request (same batch as system)
>
> 47 built-in tools registered by src/tools/*.ts (list extracted statically from the register calls):
>
> add_mcp_server ask_choice copy_file create_directory create_skill delete_directory delete_file delete_range delete_symbol directory_tree edit_file find_in_code forget get_file_info get_symbols glob grep install_skill java_source job_output list_directory list_fold_views list_jobs list_search_views list_themes load_turns_context mark_step_complete move_file multi_edit read_file recall_memory remember revise_plan run_background run_command run_skill search_context search_files stop_job submit_plan tag_theme todo_write trace_theme wait_for_job web_fetch web_search write_file
>
> Notes:
> - Every tool's description is canonicalized + shrunk to <=120 chars by
>   normalizeToolDescriptor / shrinkDescription (node 19) before it ships.
> - parameters JSON schema rides along in the same spec; see src/tools/*.ts
>   for the full schemas.
> - Conditional registrations: semantic_search (enabled when ollama is
>   reachable — see src/code/setup.ts:97; when enabled, node 4 is appended
>   to the system prompt), MCP-provided tools (user-installed servers,
>   resolved at runtime).
> - The toolSpecs hash feeds the prefix-cache fingerprint
>   (src/memory/runtime.ts) — each addTool costs one cache-miss turn.
> - fewShots (ImmutablePrefix option) is empty by default; the framework
>   supports injecting example messages, but no caller currently passes any.

## v2

_（待细化）_
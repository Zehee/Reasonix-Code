# Node 21 · 工具层 · Tool specs 注入（动态节点）

## 来源

`src/tools/*.ts → src/tools/schema-canon.ts`

## 说明

与 system 同批注入请求的动态节点：47 个内置工具名 + 压缩后描述 + 参数 schema。条件注册 semantic_search / MCP 工具。

## 原文（中文翻译稿，供对照）

> 这不是 system 文本，而是与 system 同批进请求的**动态节点**：工具规范数组。`src/tools/*.ts` 注册的工具通过 `normalizeToolDescriptor` → `shrinkDescription`（节点 19）压缩后随每次请求发出。
>
> 清单原文（47 个内置工具名，静态提取自注册调用）——
>
> `add_mcp_server` `ask_choice` `copy_file` `create_directory` `create_skill` `delete_directory` `delete_file` `delete_range` `delete_symbol` `directory_tree` `edit_file` `find_in_code` `forget` `get_file_info` `get_symbols` `glob` `grep` `install_skill` `java_source` `job_output` `list_directory` `list_fold_views` `list_jobs` `list_search_views` `list_themes` `load_turns_context` `mark_step_complete` `move_file` `multi_edit` `read_file` `recall_memory` `remember` `revise_plan` `run_background` `run_command` `run_skill` `search_context` `search_files` `stop_job` `submit_plan` `tag_theme` `todo_write` `trace_theme` `wait_for_job` `web_fetch` `web_search` `write_file`
>
> 关键说明：
> - 每个工具的描述在发出前都已规范化并压缩到 ≤120 字符（节点 19）。
> - `parameters` JSON schema 随同一 spec 发送；完整 schema 见 `src/tools/*.ts`。
> - **条件注册**：`semantic_search`（ollama 可达时启用，启用时会在 system 后附加节点 4）、MCP 提供的工具（用户安装的服务器，运行时解析）。
> - `toolSpecs` 的哈希参与前缀缓存指纹（`src/memory/runtime.ts`）——每次 `addTool` 都会损失一次缓存命中回合。
> - `fewShots`（`ImmutablePrefix` 选项）默认空；框架支持注入示例消息，但目前没有调用方传入。

## v2

_（待细化）_

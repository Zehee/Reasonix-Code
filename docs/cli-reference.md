# Reasonix CLI 参考

每个 shell 子命令、TUI 斜杠命令、快捷键的完整参考。应用内 `/help` 和 `/keys` 面板是实时权威来源——本文档是可打印的配套文档。

---

## Shell 子命令

运行 `reasonix-code --help`（或任何子命令加 `--help`）查看完整标志列表。

| 子命令 | 用途 |
|---|---|
| `reasonix-code code [dir]` | 代码模式（文件编辑、计划模式、审查门） |
| `reasonix-code run <task>` | Headless 执行（CI 友好） |
| `reasonix-code setup` | 交互式配置向导 |
| `reasonix-code sessions [name]` | 列出/打开保存的会话 |
| `reasonix-code prune-sessions` | 删除超过 N 天的会话 |
| `reasonix-code replay <transcript>` | 回放 JSONL 日志 |
| `reasonix-code diff <a> <b>` | 对比两个日志 |
| `reasonix-code events <name>` | 查看 session 事件 |
| `reasonix-code stats [transcript]` | 一次性成本/缓存分析 |
| `reasonix-code doctor` | 健康检查 |
| `reasonix-code commit` | 生成 commit 信息 |
| `reasonix-code mcp` | MCP 服务器管理 |
| `reasonix-code index` | 构建语义索引 |
| `reasonix-code version` / `reasonix-code update` | 版本信息 |

### 运行时标志（code）

| 标志 | 用途 |
|---|---|
| `--no-session` | 不保存 session |
| `-r, --resume` | 跳过会话选择，始终恢复上次消息 |
| `-n, --new` | 强制新建 session |
| `--continue` | 恢复最近 session（顶层 flag） |
| `--budget <usd>` | 每 session USD 上限 |
| `--no-dashboard` | 不启动 Dashboard |
| `--no-mouse` | 禁用鼠标 |
| `--profile [path]` | CPU 性能分析 |

---

## 斜杠命令

在对话中输入 `/` 打开选择器。带 **(code)** 标记的为代码模式专用。

### 对话操作

| 命令 | 用途 |
|---|---|
| `/help` (`/?`) | 显示完整命令参考 |
| `/new` (`/reset`, `/clear`) | 开始新对话 |
| `/retry` | 重发上一消息 |
| `/compact` | 手动折叠旧 turns |
| `/stop` | 中止当前 turn |

### 设置

| 命令 | 用途 |
|---|---|
| `/model <id>` | 切换模型 ID |
| `/language <EN\|zh-CN>` (`/lang`) | 切换语言 |
| `/theme <name>` | 切换主题 |

### 信息

| 命令 | 用途 |
|---|---|
| `/status` | 当前模型、标志、上下文 |
| `/cost [text]` | 上一 turn 费用 / 估算 |
| `/context` | 上下文窗口分解 |
| `/stats` | 跨 session 成本面板 |
| `/doctor` | 健康检查 |
| `/keys` | 键盘/鼠标/复制参考 |

### 扩展

| 命令 | 用途 |
|---|---|
| `/mcp` | 打开 MCP 中心 |
| `/resource [uri]` | 浏览 MCP 资源 |
| `/prompt [name]` | 浏览 MCP 提示 |
| `/memory [list\|show\|forget\|clear]` | 管理记忆 |
| `/skill [list\|show\|new\|<name>]` | 列出/运行/创建技能 |

### Session

| 命令 | 用途 |
|---|---|
| `/sessions` | 列出保存的 sessions |

### 代码模式

| 命令 | 用途 |
|---|---|
| `/init [force]` | 扫描项目，生成 REASONIX.md |
| `/apply [N\|N,M\|N-M]` | 提交待处理编辑 |
| `/discard [N\|N,M\|N-M]` | 丢弃待处理编辑 |
| `/walk` | 逐步查看编辑 |
| `/undo` | 撤销上一批编辑 |
| `/history` | 列出所有编辑批次 |
| `/show [id]` | 查看存储的编辑 diff |
| `/commit "msg"` | git add -A && git commit |
| `/mode <review\|auto\|yolo>` | 编辑门模式 |
| `/plan [on\|off>` | 只读计划模式 |
| `/checkpoint [name\|list\|forget]` | 快照已修改文件 |
| `/restore <name\|id>` | 回滚到 checkpoint |
| `/cwd <path>` (`/sandbox`) | 切换工作区根目录 |

### 任务（代码模式）

| 命令 | 用途 |
|---|---|
| `/jobs` | 列出后台任务 |
| `/kill <id>` | 停止后台任务 |
| `/logs <id> [lines]` | 查看任务输出 |

### 高级

| 命令 | 用途 |
|---|---|
| `/budget [usd\|off]` | Session USD 上限 |
| `/search-engine <engine>` (`/se`) | 切换搜索引擎 |
| `/hooks [reload]` | 列出/重载 hooks |
| `/permissions [list\|add\|remove\|clear]` | 编辑 shell 白名单 |
| `/dashboard [stop]` | 启动/停止 Dashboard |
| `/loop <interval> <prompt>` | 自动重复提交 |
| `/plans` | 列出计划 |
| `/replay [N]` | 加载已归档计划 |
| `/update` | 版本信息 |
| `/exit` (`/quit`, `/q`) | 退出 TUI |

---

## 键盘

| 按键 | 用途 |
|---|---|
| `Enter` | 发送 |
| `Shift+Enter` | 换行 |
| `↑` / `↓` | 滚动历史 |
| `Ctrl+P` / `Ctrl+N` | 上一/下一 prompt 历史 |
| `Ctrl+A` / `Ctrl+E` | 跳到行首/行尾 |
| `Ctrl+W` | 删除前一个词 |
| `Ctrl+U` | 清空 prompt |
| `Tab` | 补全 @-mention / 接受斜杠命令 |
| `Shift+Tab` | 编辑门：切换 review ↔ AUTO |
| `Esc` | 取消选择 / 中止当前 turn |
| `Ctrl+C` | 中止当前 turn |
| `PgUp` / `PgDn` | 翻页 |
| `End` | 跳到最新消息 |

### 编辑门（代码模式）

| 按键 | 用途 |
|---|---|
| `y` / `n` | 接受/丢弃待处理编辑 |
| `Shift+Tab` | 切换 review ↔ AUTO（跨 session 持久化） |
| `u` | 撤销上一批自动应用的编辑 |

---

## 鼠标

| 动作 | 用途 |
|---|---|
| 滚轮 | 滚动历史 |
| 拖拽 | 选择文本 |
| 右键 | 终端原生菜单 |

Reasonix 仅设置 DECSET 1007（alternate-scroll）——滚轮事件转换为 ↑/↓ 按键，但原生点击/拖拽选择不受影响。使用 `--no-mouse` 完全禁用。

---

## 复制/粘贴

默认路径：**终端原生**。拖拽选择，使用终端正常的复制键。

| 动作 | 方式 |
|---|---|
| 选择 | 拖拽 |
| 复制 | `Ctrl+Shift+C` (Win/Linux) · `Cmd+C` (macOS) |
| 粘贴 | `Ctrl+V` 或 `Ctrl+Shift+V` (Win/Linux) · `Cmd+V` (macOS) |

### 复制模式

| 按键 | 用途 |
|---|---|
| `j` / `↓` | 光标下移 |
| `k` / `↑` | 光标上移 |
| `PgUp` / `PgDn` | 翻页 |
| `g` / `G` | 跳到顶部/底部 |
| `v` | 开始/取消选择 |
| `y` / `Enter` | 复制到剪贴板 |
| `q` / `Esc` | 退出不复制 |

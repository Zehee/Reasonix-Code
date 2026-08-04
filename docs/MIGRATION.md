# 从 v0.1.x 迁移

v0.2.0 是一次重大重构，以下是迁移要点。

## CLI 变化

| 命令 | v0.1.x | v0.2.0 |
|---|---|---|
| `reasonix-code code [dir]` | 不变 | 不变 |
| `reasonix-code chat` | 不变 | 不变 |
| `reasonix` | `reasonix-clear` | `reasonix-code` |

## 行为变化

### 会话存储

- **JSONL 崩溃恢复**：损坏的 JSONL 会自动回退到 `.bak` 快照。
- **Abort + discard**：`Ctrl+C`（首次）丢弃当前轮消息并清理 `.bak`。

### 桌面版

- **多工作区**：每个 workspace 一个顶层 tab，替代原生菜单"Switch Workspace"。
- **CLI 崩溃提示**：子进程异常退出时显示 toast 通知。
- **新建 Tab 聚焦**：`Ctrl+T` 新建 tab 后自动聚焦到输入框。

### 事件路由

- **Tab 感知**：事件路由到当前激活的 tab，不再硬编码 `tabId: "tab-1"`。

### 存储键

- 新增环境变量 `REASONIX_CONFIG_PATH`、`REASONIX_SESSIONS_DIR`（测试隔离用，生产环境无需设置）。

## 配置兼容

`~/.reasonix/config.json` 格式未变，无需迁移。

## 已知限制

- **Session append fast-path**（O(1) 单行写入）已回滚：破坏了 abort-discard 语义。需重新设计"用户可见的 turn 开始"和"磁盘写入时机"的分离。
- **App.tsx 大拆分延后**：App.tsx 仍有 ~790 行，可继续提取 `App()` 主体 + reducer。
- **SSE 批量优化延后**：已有 raf batch 机制，进一步优化需 profile 数据。
# 桌面版指南

## 概述

Reasonix-Code 桌面版是一个轻量启动壳（Tauri，~3 MB），底层复用命令行版 `reasonix-code code` 的完整功能。壳负责：spawn/管理每个工作区的 CLI 子进程、多工作区 tab 容器、CLI 安装引导、Dashboard iframe 代理。

## 架构

```
desktop/
├── index.html          # 启动页 / 容器入口
├── container.html      # 多 iframe 工作区容器（固定 webview 加载）
├── container.js        # 容器逻辑：tab 管理、iframe 生命周期、IPC
├── scripts/
│   ├── build-shell.mjs # 构建壳前端（dist/）
│   ├── dev-server.mjs  # 开发静态服务器
│   └── sync-version.mjs# 同步版本号到 tauri.conf.json
├── src-tauri/
│   ├── src/main.rs     # Rust 后端：进程管理 + IPC 命令 + 事件
│   └── icons/          # 应用图标
└── package.json        # 桌面版依赖
```

## 核心特性

### 多工作区（tab 容器）

- 每个工作区一个顶层 tab；`container.html` 里每个工作区一个 iframe
- iframe 加载对应 CLI dashboard URL（经壳代理，CSP 安全）
- **关闭 tab 只隐藏 iframe，不杀 CLI 进程**——切回即时热加载；整个窗口关闭时统一清理所有子进程
- CLI 意外被杀时，切回该 tab 会触发重建（重新 spawn）

### CLI 集成

- 安装器只打包 Tauri 壳；首次启动时壳检查/安装 CLI（`reasonix-code` npm 包），必要时经 winget 安装 Node.js
- 安装器把 npm-global bin 写入用户 PATH，终端直接可用 `reasonix-code code <dir>`
- 启动时壳检查 CLI 更新（原生对话框）

### 崩溃提示

CLI 子进程异常退出时前端显示 toast（`cli:crash`/`cli:exit` 事件），包含退出码与建议操作（重启 / 查日志 `~/.reasonix-code/desktop.log`）。

## 命令（Tauri IPC）

| 命令 | 用途 |
|---|---|
| `launch_backend` | 为工作区启动 CLI 子进程（可指定 CLI 路径） |
| `switch_workspace` | 切换到指定工作区（新开或复用） |
| `pick_workspace` | 打开文件夹选择对话框 |
| `list_workspaces` | 列出所有工作区 |
| `recent_workspaces` | 最近打开的工作区（最多 3 个） |
| `last_workspace` | 上次打开的工作区 |
| `workspace_close` | 关闭工作区（杀进程树） |
| `workspace_alive` | 检查工作区 CLI 是否存活 |
| `check_environment` | 检查 Node/npm/CLI 环境状态 |
| `install_cli` / `install_node` | 安装 CLI / Node.js |
| `has_api_key` / `save_api_key` | 读取/保存 API key |
| `open_in_editor` | 在外部编辑器打开文件 |
| `git_status` / `list_workspace_tree` / `write_text_file` | 工作区信息工具 |
| `desktop_build` / `set_window_title` / `log_console` | 壳辅助 |

## 事件（Rust → 前端）

| 事件 | 用途 |
|---|---|
| `cli:url` | Dashboard URL 已就绪（container 据此建 iframe） |
| `cli:exit` | CLI 子进程退出（含 crashed 标志） |
| `cli:error` | CLI 启动失败（如未配置 API key） |
| `cli:stderr` | CLI stderr 行 |
| `workspace-opened` | 新工作区已打开 |
| `workspace-closed` | 工作区已关闭 |
| `cli:crash` | CLI 异常退出（含原因） |
| `install:stdout` / `install:stderr` | CLI 安装过程输出 |

## 构建

```bash
npm run desktop:dev     # 开发模式（tauri dev）
npm run desktop:build   # 构建安装包（tauri build）
```

## 调试

- 日志文件：`~/.reasonix-code/desktop.log`（壳日志，按需创建）
- 开发调试：`REASONIX_DEVTOOLS=1` 启用开发者工具；`REASONIX_CLI=<path>` 指定 CLI 路径
- CDP 调试：壳以 `--remote-debugging-port` 启动时可连接 webview 调试

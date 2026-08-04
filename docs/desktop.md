# 桌面版指南

## 概述

Reasonix-Code 桌面版是一个轻量启动壳（~3 MB），底层复用命令行版 `reasonix-code code` 的完整功能。

## 架构

```
desktop/
├── app.js              # Electron/Tauri 启动器
├── index.html          # WebView 容器
├── src-tauri/
│   └── src/main.rs     # Rust 后端：进程管理 + 菜单 + 命令
├── icons/              # 应用图标
└── package.json        # 桌面版依赖
```

## 核心特性

### 多工作区

- 每个 workspace 一个顶层 tab
- 进程常驻，切换即时
- 关闭窗口时统一清理所有后台进程

### 原生菜单

- **macOS**：标准菜单栏（Quit + 窗口控件）
- **Windows**：简化为 Quit 菜单

### CLI 集成

- 安装器自动配置 PATH
- 命令行直接可用 `reasonix-code code <dir>`

### 崩溃提示

子进程异常退出时显示 toast 通知，包含：
- 退出码
- 尾部 stderr 输出
- 建议操作（重启 CLI / 检查日志）

## 命令

桌面版通过 Tauri IPC 调用以下 Rust 命令：

| 命令 | 用途 |
|---|---|
| `spawn_instance` | 启动新的 CLI 子进程 |
| `register_dashboard_url` | 注册 dashboard URL 并导航 |
| `workspace_close` | 关闭工作区并杀进程树 |
| `workspace_pick` | 打开文件夹选择对话框 |
| `pick_workspace` | 选择已有工作区 |
| `list_workspaces` | 列出所有工作区 |
| `last_workspace` | 获取上次工作区 |

## 事件

桌面版通过 SSE 推送以下事件到前端：

| 事件 | 用途 |
|---|---|
| `cli:exit` | CLI 子进程退出（含 crashed 标志）|
| `cli:url` | Dashboard URL 已就绪 |
| `cli:error` | CLI 启动失败 |
| `workspace-opened` | 新工作区已打开 |
| `workspace-closed` | 工作区已关闭 |
| `cli:crash` | CLI 异常退出（含 reason）|

## 构建

```bash
npm run desktop:dev     # 开发模式
npm run desktop:build   # 构建安装包
```

## 调试

- 日志文件：`desktop-output.log`、`desktop-stderr.log`、`desktop-stdout.log`
- Rust 日志：`RUST_LOG=reasonix_code_desktop=debug`
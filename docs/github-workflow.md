# GitHub 工作流程与发布机制

Reasonix-Code 的 GitHub 追踪、版本管理和发布机制文档。

---

## 1. 版本管理

### 版本号规则（Semantic Versioning）

| 类型 | 格式 | 用途 |
|------|------|------|
| **Major** | `X.0.0` | 破坏性变更：API 变更、移除功能、不兼容配置 |
| **Minor** | `0.X.0` | 新功能：新命令、新工具、新能力 |
| **Patch** | `0.0.X` | Bug 修复、性能改进、文档更新 |

当前版本：`0.2.4`（定义在 `package.json`）

### 版本号位置

版本号在 `package.json` 中定义：

```json
{
  "name": "reasonix-code",
  "version": "0.2.4"
}
```

桌面壳的版本号由 `desktop/scripts/sync-version.mjs` 从 `package.json` 同步到 `tauri.conf.json`（构建时执行）。

---

## 2. 发布流程

### 2.1 CLI 发布（npm）

**触发方式：** 推送 `v*` 标签

```bash
git tag v0.2.4
git push origin v0.2.4
```

**GitHub Actions 工作流：** `.github/workflows/release.yml`

**流程：** checkout → `npm ci`（根 + dashboard）→ `npm run build`（现场构建 dist）→ 版本去重检查 → `npm publish --access public`（使用 `NPM_TOKEN` secret）。

**产出：**
- npm 包 `reasonix-code@0.2.4`

> 注意：release.yml 只发布 npm 包，**不创建 GitHub Release**。

### 2.2 桌面应用（Tauri）

**触发方式：** 在 GitHub Actions 页面**手动触发** `build-windows` / `build-macos` / `build-linux`（`workflow_dispatch`，见 `.github/workflows/desktop.yml`）。push 不会自动触发。

**产物命名：** `reasonix-code-desktop-{windows,macos,linux}-build<run_number>.{exe,dmg,deb}`

**发布：** 产物上传到 GitHub Release `desktop-latest`（滚动更新：新构建覆盖同名资产，旧资产归档到 `desktop-archive` release）。

**构建要求：**
- Node.js >= 22
- Rust toolchain (rustup)
- Visual Studio Build Tools (Windows)

### 2.3 发布检查清单（CLI）

1. 更新 `package.json` 版本号
2. 更新 `CHANGELOG.md`
3. 提交变更
4. 创建并推送标签（触发 release.yml）
5. 验证 Actions 的 Release run 为 green

```bash
# 示例：发布 v0.2.4
npm version patch   # 或手动改 package.json
git push origin main
git tag v0.2.4
git push origin v0.2.4
```

---

## 3. 安装机制

### 3.1 npm 安装（CLI，推荐）

```bash
npm install -g reasonix-code
```

安装后可在任意终端运行 `reasonix-code code`（Windows 下安装器/包会追加 npm-global bin 到用户 PATH）。

### 3.2 桌面版安装

从 GitHub Releases 的 `desktop-latest` 下载对应平台安装包：
- Windows：`reasonix-code-desktop-windows-build<run_number>.exe`（NSIS 安装器）
- macOS：`reasonix-code-desktop-macos-build<run_number>.dmg`
- Linux：`reasonix-code-desktop-linux-build<run_number>.deb`

安装器只打包 Tauri 壳；首次启动时壳会检查/安装 CLI（`reasonix-code` npm 包），必要时通过 winget 安装 Node.js。

### 3.3 源码运行

```bash
git clone https://github.com/Zehee/Reasonix-Code.git
cd Reasonix-Code
npm install
npm run dev code      # 代码模式（TUI + dashboard）
npm run dev           # 等价（无子命令时默认 code 模式）
```

---

## 4. 项目结构

```
Reasonix-Code/
├── .github/workflows/
│   ├── release.yml              # CLI 发布（push v* tag 触发）
│   └── desktop.yml              # 桌面构建（手动触发）
├── dashboard/                   # React 前端（Web + Desktop 共用，Vite 构建）
├── desktop/
│   ├── src-tauri/               # Tauri/Rust 后端
│   │   ├── src/main.rs          # 壳：spawn CLI、工作区管理、IPC
│   │   ├── tauri.conf.json      # Tauri 配置
│   │   └── icons/               # 平台图标
│   ├── scripts/
│   │   ├── build-shell.mjs      # 构建桌面壳（dist/）
│   │   ├── dev-server.mjs       # 开发静态服务器（BeforeDevCommand）
│   │   └── sync-version.mjs     # 同步版本号到 tauri.conf.json
│   ├── index.html / container.html / container.js   # 壳前端（多 iframe 容器）
│   └── package.json             # 桌面依赖
├── scripts/                     # 诊断/探测脚本（probe-*）
├── package.json                 # 根项目配置
├── src/
│   └── ...                      # CLI 源码
└── CHANGELOG.md                 # 变更日志
```

---

## 5. 桌面应用架构

```
┌─────────────────────────────────────────────┐
│  Tauri 壳 (Rust)                             │
│  ├── main.rs: 管理 CLI 子进程 + 工作区会话    │
│  ├── IPC 命令: launch_backend / switch_      │
│  │   workspace / pick_workspace /            │
│  │   check_environment / install_cli ...     │
│  └── 事件: cli:url / cli:exit / cli:error /  │
│      workspace-closed / cli:stderr ...       │
├─────────────────────────────────────────────┤
│  Node.js CLI（npm 包 reasonix-code）          │
│  ├── 每个工作区一个 CLI 子进程（code 模式）    │
│  └── 每个进程自带 dashboard server（随机端口） │
├─────────────────────────────────────────────┤
│  壳前端（container.html，固定 webview）       │
│  └── 多 iframe：每个工作区一个 iframe 加载     │
│      对应 dashboard URL（tauri.localhost 代理）│
└─────────────────────────────────────────────┘
```

**通信方式：**
- 壳前端 → Rust：`invoke()` 命令（launch_backend、switch_workspace、pick_workspace、check_environment、install_cli、install_node、has_api_key、save_api_key、recent_workspaces、list_workspaces、last_workspace、workspace_close、open_in_editor、git_status 等）
- Rust → 壳前端：事件（`cli:url` 推送 dashboard 地址、`cli:exit` 进程退出、`cli:error` 启动失败、`workspace-closed` 关闭通知、`install:stdout`/`install:stderr` 安装日志）
- dashboard iframe ↔ CLI server：HTTP + 事件流（CLI server 自带，走壳的 CSP 代理）

---

## 6. 标签命名规范

| 标签 | 用途 |
|------|------|
| `v*` | CLI 发布（如 `v0.2.4`），触发 release.yml |
| `desktop-latest` | 桌面应用滚动发布（GitHub Release 名，非 git tag） |
| `desktop-archive` | 桌面应用旧构建归档 |

---

## 7. 环境变量

| 变量 | 用途 |
|------|------|
| `REASONIX_CLI` | 自定义 CLI 路径（桌面调试用） |
| `REASONIX_DEVTOOLS` | 启用桌面开发者工具 |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri 签名私钥（发布用，当前未配置） |
| `REASONIX_CONFIG_PATH` | 自定义配置文件路径（测试隔离） |
| `REASONIX_SESSIONS_DIR` | 自定义会话目录（测试隔离） |
| `NPM_TOKEN` | npm 发布认证（仓库 secret） |

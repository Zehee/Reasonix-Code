# GitHub Workflow & Release Mechanism

Reasonix-Code 的 GitHub 跟踪、版本管理和发布机制文档。

---

## 1. 版本管理

### 版本号规则（Semantic Versioning）

| 类型 | 格式 | 用途 |
|------|------|------|
| **Major** | `X.0.0` | 破坏性变更：API 变更、移除功能、不兼容配置 |
| **Minor** | `0.X.0` | 新功能：新命令、新工具、新能力 |
| **Patch** | `0.0.X` | Bug 修复、性能改进、文档更新 |

当前版本：`0.1.0`（定义在 `package.json`）

### 版本号位置

版本号在 `package.json` 中定义，运行时通过 `src/version.ts` 读取：

```json
{
  "name": "reasonix-code",
  "version": "0.1.0"
}
```

---

## 2. 发布流程

### 2.1 CLI 二进制（bun 编译）

**触发方式：** 推送 `v*` 标签

```bash
git tag v0.2.0
git push origin v0.2.0
```

**GitHub Actions 工作流：** `.github/workflows/release.yml`

```yaml
on:
  push:
    tags:
      - "v*"

jobs:
  build-windows:
    - bun build ./src/cli/index.ts --compile --outfile build/reasonix-code-v<version>.exe
    - Upload artifact

  publish:
    - Create GitHub Release
    - Attach binary: reasonix-code-v<version>.exe
```

**产出：**
- `build/reasonix-code-v0.2.0.exe` — 独立 CLI 二进制
- GitHub Release 页面自动创建

### 2.2 桌面应用（Tauri）

**构建命令：**

```bash
# 安装依赖
cd desktop && npm install

# 下载 Node.js 二进制
npm run bundle:node

# 构建 NSIS 安装包
npm run tauri build
```

**产出位置：**
```
desktop/src-tauri/target/release/bundle/nsis/
  └── Reasonix Code_<version>_x64-setup.exe
```

**构建要求：**
- Node.js >= 22
- Rust toolchain (rustup)
- Visual Studio Build Tools (Windows)
- Windows Defender 排除 `desktop/src-tauri/target/` 目录

### 2.3 发布检查清单

1. 更新 `package.json` 版本号
2. 更新 `CHANGELOG.md`
3. 提交变更
4. 创建并推送标签
5. GitHub Actions 自动构建并发布

```bash
# 示例：发布 v0.2.0
npm version patch  # 或 minor / major
git push origin main
git tag v0.2.0
git push origin v0.2.0
```

---

## 3. 安装机制

### 3.1 PowerShell 安装（推荐）

```powershell
irm https://raw.githubusercontent.com/Zehee/Reasonix-Code/main/install.ps1 | iex
```

**流程：**
1. 从 GitHub Releases 下载 `reasonix-code-v<version>.exe`
2. 重命名为 `reasonix.exe`
3. 安装到 `%USERPROFILE%\.reasonix-code\bin\`
4. 自动添加到用户 PATH

**安装后：** 重启终端，运行 `reasonix --help`

### 3.2 手动下载

```powershell
iwr https://github.com/Zehee/Reasonix-Code/releases/latest/download/reasonix-code-v0.1.0.exe -OutFile reasonix.exe
```

### 3.3 源码运行

```bash
git clone https://github.com/Zehee/Reasonix-Code.git
cd Reasonix-Code
npm install
npm run dev code      # 代码模式
npm run dev chat      # 对话模式
```

---

## 4. 项目结构

```
Reasonix-Code/
├── .github/workflows/
│   └── release.yml              # CLI 二进制发布工作流
├── build/
│   └── reasonix-code-v*.exe     # CLI 二进制（gitignored）
├── dashboard/                   # React 前端（Web + Desktop 共用）
├── desktop/
│   ├── src-tauri/               # Tauri/Rust 后端
│   │   ├── src/main.rs          # 应用入口
│   │   ├── src/rpc.rs           # Node.js 进程管理
│   │   ├── tauri.conf.json      # Tauri 配置
│   │   └── icons/               # 平台图标
│   ├── scripts/bundle-node.mjs  # Node.js 打包脚本
│   ├── vite.config.ts           # Vite 构建配置
│   └── package.json             # 桌面依赖
├── install.ps1                  # PowerShell 安装脚本
├── package.json                 # 根项目配置
├── src/
│   ├── cli/commands/desktop.ts  # 桌面守护进程（JSON-RPC）
│   └── ...
└── CHANGELOG.md                 # 变更日志
```

---

## 5. 桌面应用架构

```
┌─────────────────────────────────────────────┐
│  Tauri (Rust)                               │
│  ├── 窗口管理、系统托盘、IPC                   │
│  ├── rpc.rs: 启动并管理 Node.js 子进程        │
│  └── 通信: stdin/stdout JSON-RPC             │
├─────────────────────────────────────────────┤
│  Node.js 22 (内嵌二进制)                      │
│  ├── bundle-node.mjs 下载并打包              │
│  └── 运行 dist/cli/index.js desktop          │
├─────────────────────────────────────────────┤
│  React + Vite 前端 (dashboard/)              │
│  └── 通过 Tauri IPC 与 Rust 通信             │
└─────────────────────────────────────────────┘
```

**RPC 通信协议：**
- 前端 → Rust: `invoke("rpc_send", { line: JSON.stringify(cmd) })`
- Rust → 前端: `listen("rpc:event")` 接收 JSON 事件
- Rust → Node.js: stdin 写入 JSON 命令
- Node.js → Rust: stdout 输出 JSON 事件

---

## 6. 标签命名规范

| 标签 | 用途 |
|------|------|
| `v*` | CLI 二进制发布（如 `v0.1.0`） |
| `desktop-v*` | 桌面应用发布（如 `desktop-v1.0.0`） |

---

## 7. 环境变量

| 变量 | 用途 |
|------|------|
| `REASONIX_CLI` | 自定义 CLI 路径（桌面调试用） |
| `REASONIX_DEVTOOLS` | 启用桌面开发者工具 |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri 签名私钥（发布用） |

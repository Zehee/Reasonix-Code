# 贡献指南

感谢你对 Reasonix-Code 的兴趣！本文档说明如何参与贡献。

## 行为准则

- 尊重、包容、建设性。
- Issue 和 PR 均接受中文和英文。

## 如何开始

```bash
git clone https://github.com/Zehee/Reasonix-Code.git
cd Reasonix-Code
npm install
npm run dev code      # 代码模式
npm run dev chat      # 交互式对话
```

## 代码风格

- **格式化 + lint**：`npm run lint`（Biome）
- **类型检查**：`npm run typecheck`（tsc --noEmit + dashboard）
- **全量校验**：`npm run verify`（build + lint + typecheck + test）

### 注释规范

- 块注释最多连续 3 行，超过部分改用行间 `//` 注释。
- 公开 API 必须有 JSDoc 描述参数与返回值。

### 提交信息

采用 Conventional Commits 风格：

| 前缀 | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `perf` | 性能优化 |
| `refactor` | 重构 |
| `test` | 测试 |
| `docs` | 文档 |
| `chore` | 杂项 |

## 测试

```bash
npm test              # 全量 vitest
npm run test:watch    # 监听模式
```

新增功能或修复 bug 必须附带回归测试。

## Pull Request

1. Fork 仓库，创建特性分支（`feat/xxx` 或 `fix/xxx`）。
2. 确保 `npm run verify` 通过。
3. 填写 PR 模板（如有），关联相关 Issue。
4. 等待审查，按反馈修改。

## 文档

如有用户可见改动，同步更新 README.md 或 docs/ 下对应文档。

## 安全报告

发现安全漏洞请勿公开 Issue，参见 [SECURITY.md](./SECURITY.md)。
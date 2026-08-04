# 测试指南

## 运行测试

```bash
npm test              # 全量 vitest
npm run test:watch    # 监听模式
npm run test:coverage # 覆盖率
```

## 测试结构

```
tests/
├── *.test.ts         # 单元测试 / 集成测试
├── fixtures/         # 测试夹具
└── _*.ts             # 跳过文件
```

## 编写规范

### 命名

- `describe` 描述被测模块或行为
- `it` 使用"动词 + 预期"格式（`returns [] when the file doesn't exist`）

### 隔离

- 并行测试（fork pool）中使用 `process.env.REASONIX_CONFIG_PATH` 和 `process.env.REASONIX_SESSIONS_DIR` 隔离文件系统。
- **禁止**使用 `vi.stubEnv`：fork pool 中跨 worker 不可靠。

### 反向验证

新增的 bug 修复测试必须能捕捉回归：先 stash 修复确认测试 fail，恢复后 pass。

## 覆盖模块

| 模块 | 文件 |
|---|---|
| 会话 | `session.test.ts` |
| 工具推断 | `arg-inference.test.ts` |
| 事件脱敏 | `event-redaction.test.ts` |
| 主题管理 | `theme-manager.test.ts` |
| 精炼搜索 | `refine-sql-escape.test.ts` |
| SSE 重连 | `dashboard-server-bridge-refresh.test.ts` |
| Tab 路由 | `dashboard-multitab-routing.test.ts` |
| Tab 焦点 | `dashboard-tab-focus.test.ts` |

## 基准测试

```
benchmarks/tau-bench/       # τ-bench-lite 离线基准
benchmarks/tau-bench/report.md  # 最新基准数据
```
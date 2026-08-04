# 开发脚本参考

手动运行的诊断和基准测试脚本，用于开发调试。均不在 CI 或 npm scripts 中，需手动执行。

---

## scripts/

### 缓存探测

| 脚本 | 用途 |
|---|---|
| `scripts/_probe-arg-inference.mts` | 测试工具参数推断（shell KV 边界） |
| `scripts/_probe-symlink.mts` | 测试 symlink 沙箱越权场景 |
| `scripts/_probe-mcp-roundtrip.mts` | 测试 MCP spec 序列化/反序列化 |
| `scripts/_probe-redaction.mts` | 测试事件脱敏（字符串/数组） |

运行方式：

```bash
npx tsx scripts/_probe-arg-inference.mts
```

### 桌面端调试

| 脚本 | 用途 |
|---|---|
| `check-titlebar.ps1` | 检查 Windows 窗口样式（已删除，仅作历史参考） |

---

## 性能基准

### 运行测试套件

```bash
# 全量测试
npm test

# 监听模式
npm run test:watch

# 覆盖率
npm run test:coverage
```

### 验证

```bash
# 全量校验（build + lint + typecheck + test）
npm run verify
```

### 类型检查

```bash
# 根项目 + dashboard
npm run typecheck
```

---

## 环境变量

| 变量 | 用途 |
|---|---|
| `REASONIX_CONFIG_PATH` | 自定义配置文件路径（测试隔离） |
| `REASONIX_SESSIONS_DIR` | 自定义会话目录（测试隔离） |
| `REASONIX_LOG_LEVEL` | 日志级别（DEBUG / INFO / WARN / ERROR） |
| `REASONIX_CLI` | 自定义 CLI 路径（桌面调试） |
| `REASONIX_DEVTOOLS` | 启用桌面开发者工具 |

---

## 调试技巧

### 查看详细日志

```bash
REASONIX_LOG_LEVEL=DEBUG reasonix-code code
```

### 健康检查

```bash
reasonix-code doctor
reasonix-code doctor-cache
```

### 手动构建

```bash
# 构建 dashboard
npm run build:dashboard

# 构建 CLI
npm run build

# 构建桌面版
npm run desktop:build
```

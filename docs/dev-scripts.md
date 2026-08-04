# 开发脚本参考

手动运行的诊断和基准测试脚本，用于开发调试。均不在 CI 或 npm scripts 中，需手动执行。

---

## scripts/

### 缓存探测（probe 系列）

| 脚本 | 用途 |
|---|---|
| `scripts/probe-cache.mjs` | 探测修改历史消息是否会破坏 DeepSeek 后续 prompt 缓存 |
| `scripts/probe-cache-shape.mts` | 确定性缓存形状探测：不调用 API，校验本地不变量 |
| `scripts/probe-loop-cache.mts` | 端到端缓存探测：真实轮次驱动 CacheFirstLoop，报告每轮缓存命中率 |
| `scripts/probe-long-session.mts` | 长会话探测：20 轮真实对话 + 超大工具结果 |
| `scripts/probe-lifecycle-cache-neutral.mts` | 运行时生命周期设计的缓存中立性探测（需 DEEPSEEK_API_KEY） |

运行方式：

```bash
npx tsx scripts/probe-cache-shape.mts
```

### 其他探测 / 诊断

| 脚本 | 用途 |
|---|---|
| `scripts/probe-fanout.mts` | 复现 #675：`run_skill` 并行扇出计数（headless） |
| `scripts/probe-jobs-leak.mts` | JobRegistry 泄漏探测（短任务后采样 Map 大小与内存） |
| `scripts/probe-mem-leak.mts` | 长跑内存探测（假 fetch，无网络，采样各容器增长） |
| `scripts/probe-render-large-session.mts` | 大会话渲染两场景对比（PROBE_CARDS/PROBE_TICKS 环境变量） |
| `scripts/ctrlc-probe.mjs` | Ctrl+C 中断行为探测 |
| `scripts/desktop-e2e.mjs` | 桌面端端到端探测 |

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

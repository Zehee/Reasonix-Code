# Development Scripts Reference

手动运行的诊断和基准测试脚本，用于开发调试 Reasonix Node.js 版本。均不在 CI 或 npm scripts 中，需手动执行。

---

## scripts/

### 缓存探测

| 脚本 | 用途 | 运行方式 |
|------|------|----------|
| `probe-cache.mjs` | 验证修改历史消息是否破坏 DeepSeek prefix cache。模拟 `compactInPlace()` 重写旧 tool result 后的 cache 命中情况 | `node scripts/probe-cache.mjs` |
| `probe-cache-shape.mts` | 本地验证缓存命中的不变量（工具 spec 排序、组件前缀 hash、日志重写追踪），不调 API | `npx tsx scripts/probe-cache-shape.mts` |
| `probe-loop-cache.mts` | 端到端测试：驱动 CacheFirstLoop 跑多轮真实对话，报告每轮 cache hit % | `REASONIX_LOG_LEVEL=ERROR npx tsx scripts/probe-loop-cache.mts` |
| `probe-long-session.mts` | 20 轮大 tool result（~4k tokens/轮）的 cache 轨迹、成本、miss tokens 分析 | `REASONIX_LOG_LEVEL=ERROR npx tsx scripts/probe-long-session.mts` |
| `probe-lifecycle-cache-neutral.mts` | 验证 Engineering Lifecycle 设计的 cache 经济性：off/strict prompt 是否字节一致 | `npx tsx scripts/probe-lifecycle-cache-neutral.mts` |

### 性能基准

| 脚本 | 用途 | 运行方式 |
|------|------|----------|
| `probe-render-large-session.mts` | Ink 渲染性能：500+ 卡片挂载耗时 + 持续 parent re-render 下的 memo 效果 | `PROBE_CARDS=500 PROBE_TICKS=200 node --import tsx scripts/probe-render-large-session.mts` |
| `bench-fold-cache-live.mjs` | 折叠摘要路径 live cache-hit 基准：新旧 shape 对比 prompt_cache_hit_tokens | `DEEPSEEK_API_KEY=xxx node scripts/bench-fold-cache-live.mjs` |
| `bench-fold-cache-shape.mjs` | 本地模拟新旧折叠形状的 cache 命中率，无需 API Key | `node scripts/bench-fold-cache-shape.mjs <session.jsonl>` |

### 内存/泄漏探测

| 脚本 | 用途 | 运行方式 |
|------|------|----------|
| `probe-mem-leak.mts` | fake fetch 驱动 N 轮循环，采样进程内存和数据结构大小，定位泄漏源 | `node --expose-gc --import tsx scripts/probe-mem-leak.mts` |
| `probe-jobs-leak.mts` | 测试 JobRegistry Map 是否在任务完成后自动清理，否则无限增长 | `node --expose-gc --import tsx scripts/probe-jobs-leak.mts` |
| `probe-fanout.mts` | 复现 issue #675：统计并行 `run_skill` 的 fan-out 次数 | `npx tsx scripts/probe-fanout.mts` |

### 终端/键盘探测

| 脚本 | 用途 | 运行方式 |
|------|------|----------|
| `ctrlc-probe.mjs` | 测试 Ctrl+C 字节是否到达 Node 子进程的 stdin | `node scripts/ctrlc-probe.mjs` |
| `shift-enter-probe.mjs` | 启用 modifyOtherKeys + kitty 协议，打印 Shift+Enter 的原始字节 | `node scripts/shift-enter-probe.mjs` |

### E2E / 冒烟测试

| 脚本 | 用途 | 运行方式 |
|------|------|----------|
| `e2e-code-query.mts` | code query 工具端到端测试：注册工具 → dispatch → 格式化输出 | `npx tsx scripts/e2e-code-query.mts` |
| `e2e-dist-grammars.mts` | 验证 dist/grammars 下的 wasm 文件能正确加载和解析符号 | `npx tsx scripts/e2e-dist-grammars.mts` |
| `smoke-index-config.mjs` | 遍历仓库检查索引配置的文件桶计数是否合理 | `node scripts/smoke-index-config.mjs` |
| `smoke-memory.mts` | 记忆层完整流程冒烟：写入 → 索引重建 → 前缀组装 → 召回 → 删除 → off 短路 | `npx tsx scripts/smoke-memory.mts` |

### 度量/诊断

| 脚本 | 用途 | 运行方式 |
|------|------|----------|
| `measure-tool-sizes.mts` | 打印每个工具的描述 + schema 字节数，用于规划压缩目标 | `npx tsx scripts/measure-tool-sizes.mts` |
| `measure-tool-token-cost.mts` | 测量工具列表在 prompt 中的 token 消耗和 USD 成本 | `npx tsx scripts/measure-tool-token-cost.mts` |
| `analyze-cpuprofile.mjs` | 分析 .cpuprofile 文件，按函数汇总 self-time 和 total-time | `node scripts/analyze-cpuprofile.mjs <file.cpuprofile>` |

### 其他

| 脚本 | 用途 | 运行方式 |
|------|------|----------|
| `coverage-summary.mjs` | 在 GitHub Actions 中读取 coverage-summary.json，写入 Step Summary | CI 中自动运行 |
| `prepare-tokenizer.ts` | 精简 tokenizer 文件（7.5MB → 1.7MB），仅保留 encode 字段 | `node scripts/prepare-tokenizer.ts <tokenizer.json>` |

---

## scripts/perf/

CPU profiling 相关脚本。

| 脚本 | 用途 | 运行方式 |
|------|------|----------|
| `analyze-cpu-prof.mjs` | 分析 .cpuprofile，输出按函数分组的 self-time + total-time 表 | `node scripts/perf/analyze-cpu-prof.mjs <file.cpuprofile>` |
| `profile-tui-streaming.tsx` | 挂载 CardStream + fake stdout，模拟 50 轮事件流，用 --cpu-prof 采集渲染性能 | `node --cpu-prof --cpu-prof-dir=. --import tsx scripts/perf/profile-tui-streaming.tsx` |
| `profile-tui-sync.tsx` | 同步变体：单 tick 内全部 dispatch，暴露 React reconciler + reducer 的纯开销 | `node --cpu-prof --import tsx scripts/perf/profile-tui-sync.tsx` |

---

## tools/

独立的诊断工具脚本，不在 npm scripts 中。

| 脚本 | 用途 | 运行方式 |
|------|------|----------|
| `analyze-session-body.mjs` | 分析 session JSONL 文件的 body 结构和大小分布 | `node tools/analyze-session-body.mjs <session.jsonl>` |
| `bench-fold-cache-live.mjs` | 折叠摘要路径 live cache-hit 基准（新版） | `DEEPSEEK_API_KEY=xxx node tools/bench-fold-cache-live.mjs` |
| `bench-fold-cache-shape.mjs` | 本地模拟新旧折叠形状的 cache 命中率（新版） | `node tools/bench-fold-cache-shape.mjs <session.jsonl>` |
| `bench-reducer-hotpath.mjs` | 新旧 reducer 热路径微基准：mutateCard / plan.drop / appendCard | `node tools/bench-reducer-hotpath.mjs` |
| `e2e-context-compression.mts` | 端到端探测上下文压缩流程：auto-fold → emergency → mechanical fallback | `npx tsx tools/e2e-context-compression.mts` |
| `probe-deepseek-body-limit.mjs` | 发送递增大小的 JSON body 探测 DeepSeek gateway 的 body 大小限制 | `DEEPSEEK_API_KEY=xxx node tools/probe-deepseek-body-limit.mjs` |
| `scan-all-sessions.mjs` | 扫描指定目录下所有 session JSONL，检测孤 surrogates 等数据问题 | `node tools/scan-all-sessions.mjs [session-dir]` |

---

## 典型使用场景

**调试 cache 命中率下降：**
```bash
npx tsx scripts/probe-cache-shape.mts        # 先检查本地不变量
REASONIX_LOG_LEVEL=ERROR npx tsx scripts/probe-loop-cache.mts  # 再跑 live 验证
```

**排查内存泄漏：**
```bash
node --expose-gc --import tsx scripts/probe-mem-leak.mts
node --expose-gc --import tsx scripts/probe-jobs-leak.mts
```

**优化工具 prompt 占用：**
```bash
npx tsx scripts/measure-tool-sizes.mts        # 看字节数
npx tsx scripts/measure-tool-token-cost.mts   # 看 token 成本
```

**TUI 渲染性能分析：**
```bash
node --cpu-prof --cpu-prof-dir=. --import tsx scripts/perf/profile-tui-streaming.tsx
node scripts/perf/analyze-cpu-prof.mjs *.cpuprofile
```

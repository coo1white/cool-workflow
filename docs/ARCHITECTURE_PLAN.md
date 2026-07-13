# CW 架构改进规划(Architecture Improvement Plan)

> 状态:proposal(规划文档,本 PR 不含任何代码改动)。
> 日期:2026-07-07。基线版本:v0.2.1(main @ 1f5b193)。
> 产出方式:三路只读代码探索 + 两路方案设计,全部结论带 file:line 实证。
> 用法:与 DIRECTION.md 配套——DIRECTION 说"往哪走/不往哪走",本文说
> "下一步具体动什么、按什么顺序、怎么证明没破坏行为"。

---

## 0. 一句话结论

v2 重建(core 纯层 / shell IO 层 / 单 capability-table 驱动 CLI+MCP)已成功上线,
方向正确;剩下的问题不是"再来一次重构",而是**四类收尾**:
①把重建期丢掉的安全网补回来(单测层、纯度 gate);②清掉重建遗留的死代码与双轨;
③解掉 capability-table 这一个层次倒挂点;④少量结构卫生。
全部工作可拆成约 13 个独立 PR,每个 PR 单独全绿、单独可合并、单独可放弃。

---

## 1. 事实基线(2026-07-07 实测)

以下均为对当前 main 的实测,其中 5 条**修正了仓库文档或口头叙事的说法**(标 ⚠)。
路径基准:`plugins/cool-workflow/`。

### 1.1 分层现状

- src 共 129 个 .ts、约 43.6k 行:core 42 文件(纯决策)/ shell 79(全部 IO)/
  cli 4 / mcp 2。纯壳分离约定清晰:core 用 `persistNode`/`saveCheckpoint` 等回调
  把副作用外提(`src/core/pipeline/runner.ts:46-70`)。
- 状态落盘健康:目录布局单点(`src/core/state/run-paths.ts:16`)、原子读写单点
  (`src/shell/fs-atomic.ts:33`)、state.json 单一读写点(`src/shell/run-store.ts`)。

### 1.2 头号问题:capability-table 层次倒挂

`src/core/capability-table.ts`(4332 行)是 CLI+MCP 共享的能力中枢(196 MCP tool
+ 199 attachCliBinding + 42 addCliOnlyCapability = 237 能力),但它身在 core 却:

- 从 `../shell/` import 42 处(如 :480 `loadRunFromCwd`、:1035 pipeline-cli、
  :3144 workbench);
- 从 `../cli/io` import 3 处(:657、:811、:863);
- 直接 import `node:path`(:3007)、读 `process.env` / `process.cwd()`(:992、:1015)。

表的构成方式:196 行字面表(:206-403)之后,是 193 处
`REGISTRY_BY_CAPABILITY.get("x")!.mcp!.handler = ...` 命令式补丁、199 处
attachCliBinding、22 处 parity 元数据补丁。**REGISTRY 数组顺序即行为**:
它同时决定 `tools/list` 顺序、`gen-parity-doc --check` 的 byte 门、`cw help` 行序、
`findCapabilityByCliPath` 线性扫描的胜出者(:1054-1058 注释明说
`run.drive.step` vs `run.drive` 依赖此)。`status` 的 cli 绑定被赋值两次
(:633 先、:2927 覆盖),赋值先后也是行为。

### 1.3 ⚠ 真实的循环依赖只有 2 条(不是"11 个 shell 文件成环")

逐一核查后:11 个 shell/*-cli 文件里指向 capability-table 的"引用"**全部是注释**
(如 `src/shell/pipeline-cli.ts:8`、`src/shell/state-cli.ts:9`)。代码级环只有:

- 环 1(直接双向):`capability-table.ts:3144` import `shell/workbench`,
  而 `src/shell/workbench.ts:16` 反向 import `findCapability`;
- 环 2(三角):capability-table → `src/cli/io.ts:12` → `src/core/format/help.ts:27`
  → 回 capability-table(`cliCapabilities`)。

这使解耦工作量远小于直觉估计(见 §4)。

### 1.4 ⚠ core 纯度 lint 并不存在

scripts/、test/、`.github/workflows/ci.yml`、`scripts/release-check.js:60-80` 中
没有任何静态检查强制 core 禁用 fs/env/Date。纯度目前只靠文件头注释与自觉。
core 现有 4 处真实违规:

| 位置 | 违规 |
|---|---|
| `src/core/state/run-paths.ts:11` | 顶层 `import node:fs`(文件头自己承认 :4-6) |
| `src/core/capability-table.ts:992,1015` | `process.env` / `process.cwd()` |
| `src/core/pipeline/runner.ts:307` | `new Date().toISOString()` 回退 |
| `src/core/trust/telemetry-attestation.ts:177` | `require("node:fs")`(已注释豁免) |

### 1.5 ⚠ cli/dispatch.ts 的 legacy switch:3 臂已死、2 臂是活的

表驱动(:67-84)先于 legacy switch(:110-252)匹配,实测:

- **已死不可达**:`next`(:163)、`gc`(:184)、`migration`(:226)——表里已有对应行,
  永远先命中,可零风险删除;
- **活的**:`search`(:132)——表里没有 `["search"]` 行、无 MCP 对应、被
  `HELP_INDEX_ONLY_TOKENS` 排除在 help 腿之外(scripts/parity-check.js:87),
  是**真实的 parity 覆盖洞**;`ledger`(:176)承担裸 `ledger` 的 usage-error
  (文档明示的 preserved wart)。

### 1.6 ⚠ 测试:单测层在 cutover 时整层丢失,可直接恢复

- 现状两层:178 个黑盒 smoke(`test/*-smoke.js`,run-all.js 自动发现,coverage
  gate 80% 地板)+ 102 个 conformance case(`v2/conformance/`,CI 直接打
  dist/cli.js)。
- 重建期曾有 **94 个 `v2/test/*.test.js`、152 个 case 的 core 纯函数单测层**,
  抓到过黑盒抓不到的 5 个真实缺陷(4 个 core 纯度违规 + 1 个字节移植回归,
  `docs/rebuild/PLAN.md:536`);删于 `3d43f9a`(#338),**完整内容在 `84aac95`
  (#331)可恢复**。现在全仓 `*.test.*` = 0。
- conformance 102 低于原设想 ~140;历史薄弱前缀:dispatch/commit-gate 错误码、
  drive/loop、multi-agent、workbench(`docs/rebuild/PLAN.md:587-596`)。

### 1.7 parity 检查:payload 腿强,静态 CLI 腿自指

- 强的部分:MCP 侧真跑 server 取活 tools/list;`payloadIdentical` 能力做 CLI 子进程
  vs 进程内 MCP 的归一化逐字节对比(scripts/parity-check.js:857-903)。
- 弱的部分:`cliDispatchTokens()`(:74-83)从 registry 推导"活 token",与同一
  registry 的声明集比对——**恒空,自指**。真正保证靠 reachability 实跑 + payload
  + conformance。另 :13、:943 的报错文案仍指已删除的 `src/capability-registry.ts`。

### 1.8 生成物与文档滞后

- vendor 适配两套并存:(A)`manifest/plugin.manifest.json` → `scripts/gen-manifests.js`
  声明式生成 5 vendor 清单,有 `--check` drift 门;(B)仓库根给"在本仓工作的
  开发 agent"的 repo 级指令文件——手写、无生成器、无 gate。2026-07-13 起开发
  只用 Claude + Codex,(B) 收敛为 `AGENTS.md`/`CLAUDE.md`/`Codex.md` 三件
  (未使用的 `.cursor/`、`.windsurfrules`、`GEMINI.md`、`AI_MEMORY.md`、
  `.github/copilot-instructions.md`、`.gemini/commands/`、`.opencode/command/`
  已全部删除)。定性:(B) 与产品 manifest 不是一类;风险是与 AGENTS.md 漂移,
  不是产品漂移。产品侧的多 vendor 支持(scripts/agents/ wrappers、
  vendor-preflight、生成的 5 vendor 清单)不受此影响,照旧。
- `gen-manifests.js:134-189` 的 `buildLegacy()` 是死回退(manifest 已有 vendors 键,
  :112-115 的触发条件永假)。
- `docs/cli-mcp-parity.7.md` 正文仍指已删除的旧文件(:26 `src/capability-registry.ts`、
  :427-437 `src/cli/handlers/`),:569 起有一串空版本号桩;`AGENTS.md:33,38,188`
  仍引用 v1 的 `src/types/`、`index.ts`。
- `workflows/` 下 2 个遗留 `.workflow.js` 与 `apps/*/` 双轨并存,loader 双扫
  (`src/shell/workflow-app-loader.ts:108-119`),且 `workflows/` 在 npm files 里。

### 1.9 其他

- ⚠ `schemaVersion` 在 src 内出现 **442 处**、**30 个文件**各自定义 SCHEMA_VERSION
  常量(此前口径 309/10+ 偏低)。注意:各子系统版本语义**确实独立**,集中化会
  破坏 byte-compat,不是改进方向(见 §5)。
- `loadRun` 私有 helper 4 处重复,其中 `src/shell/state-cli.ts:99` 与
  `src/shell/state-explosion-cli.ts:159` 逐字节相同。
- 超大文件:`shell/reclamation-io.ts` 1597 行/69 exports、`shell/run-registry-io.ts`
  1278/47、`core/multi-agent/runtime.ts` 1266/69、`shell/drive.ts` 996。
- `docs/rebuild/CUTOVER.md:46-57` 的 Decision 2(facade collapse)要求人类显式签字,
  全仓找不到签字记录,而 cutover 已发布——缺的是**书面追认**,不是回滚事由。

---

## 2. 约束(所有工作包必须满足)

1. 不内嵌模型 API;CW 永不自己执行模型(DIRECTION.md 红线)。
2. replay 确定性不可破坏。
3. 零运行时依赖。
4. POLA byte-compat:不改既有 CLI 输出、文件布局、退出码、flag 的字节;
   196 tool 的 tools/list 顺序不变。
5. 禁 spec accretion;禁直接 push main(一律 PR)。
6. 每个 PR 全 gate 绿:conformance 102 + smoke 178 + coverage ≥80% + parity +
   `gen:parity --check` + dist drift。
7. 每项工作归入 North Star 轨(A=5 分钟 demo,B=失败恢复故事,C=多厂商 manifest
   被真实客户端加载)或明确标为"护栏"(工程卫生/安全网)。

---

## 3. 分阶段路线图

原则:**先修安全网(阶段 1),再动代码(阶段 2+)**。每个工作包(WP)= 一个可独立
合并的 PR。规模:S ≈ 半天内,M ≈ 1-2 天,L ≈ 可再拆。

### 阶段 1 —— 安全网重建与护栏补齐

| WP | 内容 | 规模 | 归属 |
|---|---|---|---|
| **1.1** ✅ | **恢复 core 单测层**(已完成,见 ITERATION_LOG.md "restore the core/ unit-test layer lost at cutover"):从 `84aac95` 取回 152 个 `v2/test/*.test.js`,落位 `plugins/cool-workflow/test/`(与旧 `v2/test/` 同深度,require 路径零改动),加 `test:unit` script + `test/run-unit.js` 独立 runner,接 CI 与 release-check。9 个测试因中间已落地的真实行为演进(loop-expansion 相位命名修复、commit-gate acceptance-rationale、graph.ts blackboard 折叠、#355 移除 update verb)更新了预期值,均对照 `84aac95` 原始构建验证过曾经绿过。其中 `captable-*.test.js` 是阶段 3 的硬前置。 | M | 护栏 |
| **1.2** | **新建 core 纯度 gate**:零依赖脚本 `scripts/core-purity-check.js`,静态扫 `src/core/**` 禁 `node:fs`/`node:child_process`/`process.env`/`process.cwd`/`Date.now`/`new Date(`/`Math.random`;带显式豁免清单(初始 4 条 = §1.4 存量),**豁免只减不增、过期即失败**。接 release-check + CI。 | S | 护栏 |
| **1.3** | **parity 去自指 + Decision 2 补签**:删 `cliDispatchTokens` 自指比对(注明由 reachability 实跑 + payload + conformance 承担;删前 grep `missingCliTokens` 消费方);修 parity-check.js:13/:943 stale 引用;在 CUTOVER.md Decision 2 下补书面追认(日期 + 依据)。 | S | 护栏 |
| **1.4** | **conformance 补洞 102 → ~140**:按 PLAN.md:587-596 点名的洞补 case——dispatch/commit-gate 错误码、drive/subWorkflow/loop、multi-agent/topology、workbench、ledger/trust-audit;**必须先补 `cw search` 与 list 系输出的钉字节 case**(WP2.1/2.4 的前置)。纯新增,不动 src。可拆 3-4 个 PR。 | L | 护栏 + Track B |

### 阶段 2 —— 死代码清除与接口收敛

| WP | 内容 | 规模 | 归属 |
|---|---|---|---|
| **2.1** | **dispatch legacy switch 瘦身**:第一步删 3 个不可达臂(`next`:163、`gc`:184、`migration`:226),零行为变化;第二步把 `search` promote 成 capability-table 的 cli-only 行(handler 字节等价、记录 reason),消掉 parity 盲区。前置:WP1.4 的 search case。 | M | 护栏 |
| **2.2** | **删 `buildLegacy()` 死回退**(gen-manifests.js:112-115、:134-189),manifest 缺 vendors 键改为 fail-closed 报错。 | S | 护栏 |
| **2.3** | **文档除锈**:cli-mcp-parity.7.md 正文改指 v2 真实文件、清空版本号桩(先确认桩是否 gen-parity-doc.js 生成,是则修生成器);AGENTS.md 陈旧措辞更新。 | S | 护栏 + Track C |
| **2.4** | **workflows/ 双轨收敛评估**:先只读比对两轨 app 定义是否等价;等价 → 删 legacy 文件 + loader 的 workflows 扫描腿;不等价 → 文档化差异并停。POLA 最敏感包,前置:WP1.4 的 list 系 case。 | M | Track A |
| **2.5** | **根级 agent 指令文件轻量防漂移**:~50 行 sync-check(版本号/命令名与 package.json、AGENTS.md 一致性),接 release-check。**不建生成器管线**(6 个小文件不配)。 | S | 护栏 |

### 阶段 3 —— capability-table 解耦(详细设计见 §4)

前置:WP1.1(captable 单测网)、WP1.2(纯度 gate,豁免清单在此阶段减记 2 条)、
WP1.3(parity 不自指后拆表才有独立验证);软前置:WP2.1(缩小 dispatch↔table 活动面)。
9 个 commit,可一个 PR 或按批次拆。

### 阶段 4 —— 结构卫生(收益最低,最后做;前置 WP1.1)

| WP | 内容 | 规模 |
|---|---|---|
| **4.1** | loadRun 去重——**仅**合并逐字节相同的一对(state-cli.ts:99 / state-explosion-cli.ts:159);另两处签名不同,不合(呼应 BACKLOG 的 byte-identity 纪律)。 | S |
| **4.2** | 超大文件拆分(reclamation-io、run-registry-io、multi-agent/runtime、drive):纯搬移 + 原文件留 re-export barrel。**按需触发**——仅当某文件成为实际开发/评审瓶颈时做,否则长期停放。 | L |
| **4.3** | schemaVersion **只读盘点**(30 个常量、各语义域、当前值),给 `scripts/validate-run-state-schema.js` 加"每语义域单一定义处"检查。**不合并数值、不建中心注册表**。 | S/M |
| **4.4** | `ensureRunDirs` 迁回 shell(唯一调用方在 run-store.ts:115,且 run-store.ts:21 已 re-export,外部 import 面不变),run-paths.ts 变回纯路径函数,纯度豁免清单减记 1 条。 | S |

### 依赖关系

```text
WP1.1(单测恢复)──┬─→ 阶段 3(capability-table 解耦)
WP1.2(纯度 gate)──┤        ↑
WP1.3(parity 去自指)┘       │
WP1.4(conformance 补洞)──→ WP2.1(dispatch 瘦身)──→ 阶段 3
                      └──→ WP2.4(workflows 双轨收敛)
WP1.1 ──→ WP4.2(大文件拆分,按需)
WP2.2 / WP2.3 / WP2.5 / WP4.1 / WP4.3 / WP4.4:无强前置,可随时插队
```

**WP1.1 是第一块多米诺**:成本最低(测试是现成的,躺在 git 历史里)、
价值最高(阶段 3 与 4.2 的硬前置)。

---

## 4. 阶段 3 详细设计:core 持纯表 + 组合根接线(方案 B)

### 4.1 方案对比结论

- 方案 A(整表搬去 shell):否决——`core/format/help.ts:27` 依赖 `cliCapabilities()`,
  表搬走后 core 反而新增向上 import;workbench 环只是换个层合法化,没有根除;
  且把"196 行 spec 机械转录的纯数据表"逐出 core,违背项目哲学。
- **方案 B(推荐)**:core 保留纯表 + 全部查询函数,handler 接线搬到组合根。
  diff 中等、parity 工具链只各改 1 行 require、环全断、core 纯度可 lint 且端态零白名单。
- 方案 C(CLI 元数据也拆成纯数据,wiring 只注册函数):端态最纯但要手工改写 199 个
  绑定,转录风险高。记为 B 落地后的可选后续,本期不做。

### 4.2 端态

- `src/core/capability-table.ts` 保留:全部类型、196 行 `MCP_TOOL_DATA`、REGISTRY
  构造(mcp handler 初始一律 `notYetImplemented`)、`findCapability*` /
  `cliCapabilities` / `mcpToolDefinitions` 查询函数、`buildParityReport` /
  `lintRegistry`(:3835-4332 本就是纯函数);导出现为私有的 `attachCliBinding` /
  `addCliOnlyCapability`。
- 新建组合根 `src/wiring/capability-wiring.ts`:承接 :404-3834 的全部接线
  (45 处向上 import、199+42 绑定、193 处 handler 赋值、22 处元数据补丁),
  **逐字搬入、保持原文件顺序**;`REGISTRY_BY_CAPABILITY.get("x")!` 机械替换为
  `findCapability("x")!`;末尾 `export * from "../core/capability-table"`。
- `src/cli/entry.ts` 与 `src/mcp/server.ts` 首行 `import "../wiring/capability-wiring"`;
  两个 dispatcher 零改动(运行期查表,届时已接线)。
- 层序公理化:`core ← shell ← {cli, mcp} ← wiring(仅入口可 import)`。
  环 1 变 `wiring → shell/workbench → core`,环 2 变 `cli/io → core/format/help →
  core/capability-table`,均单向。

### 4.3 落地 9 步(每步一 commit、全绿、dist 随步重建提交)

0. **层级 lint smoke**(`test/layering-boundary-smoke.js`,~120 行零依赖,
   run-all.js 自动发现):core ↛ shell/cli/mcp/wiring;shell ↛ cli/mcp/wiring;
   wiring 仅入口可引。内置白名单 `["src/core/capability-table.ts"]`,
   **白名单过期即失败**(列名单却已无违规 ⇒ 报错强制收缩)。同时捕获基线
   (help 全量输出、tools/list)存档供 diff。
1. **wiring 纯别名模块**(两行:副作用 import + re-export)+ repoint 外部消费者:
   `scripts/parity-check.js:40`、`scripts/gen-parity-doc.js:31`、test/ 内 7 处
   require(含 node-snapshot-diff-replay-smoke.js:122、web-desktop-workbench-smoke.js:45
   加预载);audit grep 兜底确认无遗漏。
2. -7. **自底向上分批搬运**(必须从文件末段往前搬,wiring 内 prepend 保序——
   否则 42 个 cli-only 行的 append 顺序、`status` 两次赋值先后会在中间提交被扰动,
   `gen:parity --check` 当场红):
   M12 workflow-apps(:3295-3834)→ M11 reporting/workbench(:2896-3294,断环 1)
   → M10 scheduling/registry/gc(:2214-2895)→ M9 multi-agent(:1467-2213)
   → M8+M11+M6+7(:1027-1466)→ M5+M4+M3+头部占位(:404-1026,断环 2,
   core 零向上 import)。
8. **收口**:清空层级白名单;清理 shell/*-cli 过时注释与 dispatch 文件头叙述;
   `sync:project-index`;`gen:parity` 应零 diff;CHANGELOG/ITERATION_LOG 记账
   (注明"纯内部重构,dist 全量重排")。

### 4.4 验证矩阵(每步跑)

| 门 | 证明什么 |
|---|---|
| conformance 102 case(打 dist/cli.js) | CLI 输出/退出码/flag 字节不变 |
| `npm run test:gate`(全量 smoke + 单测) | 进程内 API、workbench、jsonMode、help |
| `npm run parity:check` | 声明表 vs 活 MCP tools/list vs CLI 三方一致 |
| `npm run gen:parity -- --check` | REGISTRY 行序逐字节未动(顺序保真最灵敏探针) |
| dist drift 检查 | dist 随源码同步重建提交 |
| coverage ≥80% | 平移不减测试触达 |
| 层级 lint smoke | 防回潮,白名单只减不增 |

### 4.5 主要风险与对策

1. 中间步骤扰动 REGISTRY 顺序(最大风险)→ 自底向上 + prepend 保序 +
   `gen:parity --check` 批批必跑。
2. 进程内消费者在 wiring 前拿到未接线的行 → 第 1 步全量 repoint/预载 + grep 审计。
3. wiring 被误用成新抽象层 → 它只是既有接线换了个诚实的文件名,零新接口;
   lint 规则禁止 shell/cli 反向依赖 wiring。

---

## 5. 明确不做(与理由)

1. **util 近似重复合并**(countBy/compact/truncate…)——BACKLOG 已停放:行为不一致,
   盲合 = 静默改行为;只允许 WP4.1 那种逐字节相同的个案。
2. **commitMessageTemplate 实现或单独删除**——无消费者禁实现(spec accretion 红线);
   类型删除须搭真实 runtime 工作的车。
3. **给根级 6 个 agent 指令文件建生成器管线**——规模不配收益,WP2.5 轻量 check 足够。
4. **schemaVersion 中心化/统一版本号**——442 处引用、30 个语义独立常量,
   统一即破 replay 确定性与 byte-compat;只做 WP4.3 盘点。
5. **把 178 个黑盒 smoke 改写成单测**——两层互补,改写只有迁移风险没有信息增量;
   缺的是恢复已有单测层(WP1.1),不是重写 smoke。
6. **预防性拆分所有 >800 行文件**——大文件在 conformance+parity 体系下是评审成本
   问题而非正确性问题;WP4.2 已限定按需触发。
7. **回滚或重议 facade collapse**——缺的是签字记录不是技术依据;补书面追认
   (WP1.3)即可。

---

## 6. 交付节奏建议

- 第一批(可并行 3 个 PR):WP1.1、WP1.2、WP1.3 —— 全部安全网,互不冲突。
- 第二批:WP1.4(按前缀拆 3-4 个 PR)+ WP2.2/2.3/2.5 插队。
- 第三批:WP2.1 → 阶段 3(9 commit)。
- 第四批:WP2.4 + 阶段 4 按需。

每批之间用 `cw` 自身的 release-cut 流程照常发版,改进工作不阻塞正常发布节奏。

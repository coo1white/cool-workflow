# CW v0.1.80 — FreeBSD/Unix 编程思想审核

> 审核对象：`cool-workflow` @ v0.1.80（工作树 == tag 树）。
> 评判标尺：ESR《Unix 编程艺术》17 条 + FreeBSD 文化，**并且** CW 自己在 `DIRECTION.md` 写下的红线（delegate-not-execute、replay 确定性是硬约束、evidence-gated commit、单一数据源、fail-closed on drift、小内核拒绝 LangChain 抽象陷阱）。
> 最高价值的发现 = **代码违反了项目自己写下的原则**。

---

## 执行摘要 (Executive Summary)

按 Unix 标准，CW 有几处做得**异常出色**，值得明确肯定：

- **Representation / Generation**：`version.ts` 是唯一版本常量，`bump-version.js` 改写所有面、`version-sync-check.js` 从 `git show HEAD:`（不可变字节）断言 ~150 处一致；`gen-manifests.js` 从一份 `plugin.manifest.json` 生成每个 vendor 的 plugin，`--check` fail-closed；`dist-drift-check.js` 重建并 diff，确保提交的 `dist/` 真是 `src/` 的构建。这是"把知识折进数据、从源生成产物"的范本。
- **Transparency / Silence**：`src/` 内**零** `console.*`（库代码沉默，输出全在 cli/operator 边缘）；`writeJson` 用 temp→fsync→atomic rename，`durableAppendFileSync` 显式 O_APPEND+fsync 保审计事件不丢；`observability.ts` 的计数器在 `total<=0` 时返回 `n/a` 而非误导性的 0%，成本未上报时写 `unreported, not zero`。
- **Policy vs Mechanism（控制平面边界）**：`execution-backend.ts` 的 `DRIVER_SPECS` + `registerBackend()` 是数据驱动 registry，内核 `dispatch.ts:37-40` 只**记录**哪个 backend 跑了、从不 `if (id==="...")` 分支；agent backend 在无配置时以 `delegation-target-missing` **fail-closed 拒绝**，绝不伪造完成——"CW DELEGATES, IT DOES NOT BECOME THE EXECUTOR" 红线是落在代码里的，不只是注释。

但本次审核暴露出一批**戳穿 CW 核心承诺**的缺陷。**最该优先修的 3 件事**：

1. **eval 的 replay 确定性指标在比较两个空占位符并误报 pass**（`multi-agent-eval.ts:856`，high）——score 写在嵌套路径 `<id>/scores/<scoreId>.json`，但 eval 从一个无人写入的扁平点号路径读，永远 `missing:true`，`candidate_score_parity` 形同虚设。对一个把 replay 确定性列为**硬约束**的工具，这是审计面的 false-green。
2. **损坏的 telemetry ledger 报 `verified:true`**（`telemetry-ledger.ts:34-39,142`，high）——旗舰防篡改件在 JSON.parse 抛错时被静默吞成空链、报"无可证、绿"，且 append 路径会**静默重新创世**丢弃全部历史。在最该 fail-closed 的地方 fail-open。
3. **`telemetry verify` / `worker validate` 打印失败却 exit 0**（`cli.ts:1182,713`，high）——脚本里 `cw telemetry verify $RUN && deploy` 在链被伪造时照样放行。verify/validate 必须以退出码说真话。

整体而言：CW 的**优势是真优势、护城河是真护城河**；它的问题不是方向，而是几处实现没跟上自己定下的纪律——尤其是"声明了却没接通"的 dead-mechanism，以及几个会产生 false-green 的 fail-open 路径。

---

## 发现（按原则分组，最差在前）

### 一、Transparency / Robustness / Repair / Silence（fail-closed）—— 评级 C

这是 CW 的命脉所在（"可审计"），却也藏着本次最严重的几个缺陷。三条 append-only 日志里有两条 fail-open。

#### 🔴 [high] 损坏的 telemetry ledger 验证为绿（verified:true）而非 fail-closed
- **file**：`plugins/cool-workflow/src/telemetry-ledger.ts:34-39`（load）+ `:142,146-148`（verify）
- **principle**：Repair —— fail noisily and early；项目自陈的 fail-closed + tamper-evidence 承诺
- **为什么在 CW 里要命**：telemetry ledger 是 v0.1.79 防篡改 demo 的旗舰件，`capability-core.ts:692-708` 把 `verified` 当作**权威可审计结果**对外暴露（文档说"forged/edited record fails it"）。但 `loadTelemetryLedger` 在 `JSON.parse` 抛错时 `catch { return { records: [] } }`，与"文件真不存在"走同一分支；`verifyTelemetryLedger` 对空 `records` 返回 `present:false, verified:true`。于是哈希链本该抓的那一个攻击（损坏/截断文件）恰恰被掩盖。更糟：`appendTelemetryAttestation`（line 97）同样调 `loadTelemetryLedger`，损坏的链会**静默从创世重新开始**，丢弃此前所有记录、零报错。内部不一致是铁证：注释自称"Same discipline as reclamation.ts"，但 `verifyReclamation`（`reclamation.ts:877-878`）对空/不可加载的链返回 `verified:FALSE`。
- **建议**：在 `loadTelemetryLedger` 区分"缺失"（返回空链）与"存在但不可解析"（抛结构化 `TelemetryLedgerError` 或返回 poisoned marker）；`verifyTelemetryLedger` 对后者报 `present:true, verified:false` + `telemetry-ledger-corrupt` check；`appendTelemetryAttestation` 拒绝在损坏链上扩展，绝不重新创世。

#### 🔴 [high] trust-audit 事件日志只持久化、不防篡改 —— 没有哈希链、没有 verify
- **file**：`plugins/cool-workflow/src/trust-audit.ts:89-147`（record）+ 全文件（无 verify）
- **principle**：Transparency / Representation —— 审计链是核心可审计承诺，完整性必须可验证
- **为什么在 CW 里要命**：`recordTrustAuditEvent` 用 `durableAppendFileSync` 写入，**无** `prevHash/recordHash`；全文件 grep `prevHash|recordHash|verifyAudit` 为空。对照 `telemetry-ledger.ts` 和 `reclamation.ts` 都有完整哈希链 + verify。文件头自称 `events.jsonl` 是"the one artifact whose loss breaks audit-completeness"并 fsync 它——但 fsync 只防断电、不防编辑。CW 的护城河（`DIRECTION.md:14`：中立+可审计+可复放）正是这条 sandbox/policy/commit-gate 决策日志，外部审计员真正会检查的就是它，却可被事后任意改删而无人察觉。唯一部分受保护的是 delegation token/cost（`worker-isolation.ts:522-561` 单向交叉链入 telemetry ledger），但 sandbox/policy/commit-gate 行仍可篡改。
- **建议**：把 `telemetry-ledger.ts`/`reclamation.ts` 已验证过的哈希链纪律扩到 trust-audit：每条加 `prevEventHash + eventHash`，加 `verifyTrustAudit(run)` 重算链；复用 `computeRecordHash` 式 canonicalization，让一套机制覆盖三条 append-only 日志。

#### 🟠 [medium] listTrustAuditEvents 的逐行 JSON.parse 无保护 —— 一行坏数据砖掉整个审计读面
- **file**：`plugins/cool-workflow/src/trust-audit.ts:194` 和 `:440`
- **principle**：Robustness = transparency + simplicity 之子 —— 在坏记录处失败，而非整条日志
- **为什么在 CW 里要命**：`.filter(Boolean).map(line => JSON.parse(line)).sort(...)` 无 try/catch，一行被手改/截断/半写就让 `JSON.parse` 抛错并冒泡出 `listTrustAuditEvents`/`readEvents`，进而拖垮 `summarizeTrustAudit`、`workerTrustAudit`、`evidenceProvenance`、`searchAuditEvents`、`refreshTrustAudit`，以及 `createEventId`（靠 `readEvents().length` 铸号）——**读写双砖**，连"告诉 operator 出问题了"的 summary 都没了。这正是 finding 上一条的反面失败：reclamation 太宽容、audit 太脆弱，两者都没"隔离坏记录并报告"。正确范式就在两文件外：`reclamation.ts:255-260` 已用 try/catch 发 `kind:'malformed'` 标记。
- **建议**：逐行 parse 包 try/catch，跳过并计数畸形行，在 summary 暴露 `malformedEventCount`，保住有效前缀的可读性同时让损坏变响亮。

#### 🟡 [low] missingEvidence 只查"有没有证据"（count>0），不查"必需的那几项在不在"
- **file**：`plugins/cool-workflow/src/multi-agent-trust.ts:458-464`
- **principle**：Repair / fail-closed —— evidence gate 必须验具体证据，而非"有就行"
- **为什么在 CW 里要命**：`judge.panel-decision` 要求 `['judge messages','score evidence','coordinator decision']` 三项具名证据，但 gate 只看 `evidenceRefs.length`——**一条任意 ref 即满足三项不同要求**。`evaluatePolicy` 和 `authorizeMultiAgentAction`（blackboard 写、candidate 选择、judge 判定）都流经此处，于是策略表面在 enforce、实则被轻易满足。同仓更强的范式在 `state-node.ts:271-278`（逐项匹配 `id===required || source===required`）。
- **建议**：把每个必需 ref 与 `evidenceRefs` 按 id/locator/kind 标签匹配，返回具体未覆盖项；至少先要求 `evidenceRefs.length >= required.length`。注意：当前 required 是人读 kind 标签、调用方传 content locator，二者命名空间不交，直接 set 匹配会误拒 happy path，需先引入 kind 标记方案。

---

### 二、Clarity / Simplicity / Parsimony（避免抽象陷阱）—— 评级 C

`DIRECTION.md:32` 明令"不做大而全的抽象层（LangChain 的坑）"。这里既有一个 high 级 false-green，也有一批 speculative generality。

#### 🔴 [high] eval score-parity 从一个无人写入的路径读分数 —— replay 确定性指标静默打分占位符
- **file**：`plugins/cool-workflow/src/multi-agent-eval.ts:856`
- **principle**：Repair（无静默 fallback）+ 单一数据源（replay 确定性是硬约束）
- **为什么在 CW 里要命**：`collectCandidateScores` 构造 `${candidateId}.${scoreId}.score.json` 这个**扁平点号**路径，但分数实际写在嵌套的 `<candidatesDir>/<candidateId>/scores/<scoreId>.json`（`candidate-scoring.ts:588`），其它每个 reader（`commit.ts:591`、`multi-agent-operator-ux.ts:506`、`evidence-reasoning.ts:746`）都用嵌套路径。于是 `fs.existsSync` 永远 false、永远 push `{missing:true}`，喂给 `candidate_score_parity` 指标的两侧都是等空占位符、比较恒等、报 `pass`——**从未真正验证 candidate scoring 能确定性复放**。replay 是 `DIRECTION.md:21` 的硬约束，这是审计面的 false-confidence。replay smoke test 甚至造了真分数却仍断言 `pass`，把假绿制度化了。
- **建议**：删掉这条歧异路径，复用单一来源 reader（嵌套 `<candidateId>/scores/<scoreId>.json`）。让 candidate-scoring / evidence-reasoning / commit / operator-ux / eval 共用一个 scores-path helper，路径变更不可能再 desync。加测试：有真分数的 run 必须产出非 `missing` 的 `candidateScores` 项。

#### 🟡 [low] void 掉的 dead fingerprint 掩盖了 index fingerprint 覆盖面比看上去窄
- **file**：`plugins/cool-workflow/src/state-explosion.ts:1245`
- **principle**：Clarity over cleverness + Transparency（可见、诚实的状态）
- **为什么在 CW 里要命**：`indexFingerprint` 折进**全部**十个持久化图视图的指纹，然后被 `void indexFingerprint;` 丢弃；真正写入索引的 `index.sourceFingerprint` 只哈希单个 `compact` 图。读这套 fail-closed 新鲜度机制的人会以为索引指纹能侦测任一视图的 staleness，实则非 compact 视图变陈旧不会翻动它。`void x;` 是用来骗过 unused-var lint 的小聪明，掩盖了真实的一致性缺口（虽然新鲜度门是 advisory，故 low）。
- **建议**：定夺意图——要么把 `indexFingerprint` 赋给 `index.sourceFingerprint` 并删掉更窄的副本，要么删掉 `indexFingerprint` 并加注释说明为何 compact-only 足够。别留一个算出来又 void 掉、还跟实际写入值矛盾的指纹。

#### 🟡 [low] topology registry 完整建成却零 caller —— speculative generality
- **file**：`plugins/cool-workflow/src/topology.ts:163`
- **principle**：Parsimony / Simplicity —— 只在非建不可时才建大机制（`DIRECTION.md`：不做大而全抽象层）
- **为什么在 CW 里要命**：`registerTopology()` 全仓零 caller，`_topologyRegistry` 恒空；`getTopologyDefinition`/`listTopologyDefinitions` 每次调用都对一个永远空的 Map 跑 merge + JSON-round-trip clone。更糟：`summarizeTopologies`（line 413）根本不走 registry-aware 路径，直接读 `OFFICIAL_TOPOLOGIES`——抽象既未用又内部不一致；`types/topology.ts:4-7` 还谎称三个官方 topology 是"registered at module load via registerTopology()"。
- **建议**：在出现真正第二来源前，塌成 `OFFICIAL_TOPOLOGIES.find(...)`，删掉 registry/register/clone；若确要保留为公共 API，给它至少一个 in-tree consumer/测试，让 `summarizeTopologies` 走 `listTopologyDefinitions`，并修掉那条假注释。

#### 🟡 [low] pass/warn 阈值是硬编码魔数，而本该拥有它们的 policy 是半空数据记录
- **file**：`plugins/cool-workflow/src/candidate-scoring.ts:698`
- **principle**：Representation —— 把知识折进数据，让逻辑当个 dumb comparator
- **为什么在 CW 里要命**：`verdictFor` 的 `fail` 分支尊重数据驱动的 `policy.minNormalized`，但 `pass(>=0.7)`/`warn(>=0.4)` 边界烤进逻辑。`CandidateScoringPolicy` 已是 scoring policy 的数据家，却把知识劈成数据+代码两半；两个 workflow 无法用不同 pass 线。（魔数只决定 advisory 三态标签，真正的 accept/reject 仍 key 在 `verdict==="fail"` 与 minNormalized 上，故 low。）
- **建议**：给 `CandidateScoringPolicy` 加 `passThreshold/warnThreshold`，在 `mergePolicy()` 给默认值，`verdictFor` 从中读，函数不再带内嵌数字。

#### 🟡 [low] policy.criteria 被写入却从无 reader —— 没人用的旋钮
- **file**：`plugins/cool-workflow/src/candidate-scoring.ts:690`
- **principle**：Parsimony —— 别加没有机制消费的配置
- **为什么在 CW 里要命**：`mergePolicy()` 把 `criteria: policy.criteria || []` 灌进合并对象，全仓 grep `policy.criteria` 只有写点、无读点；实际打分用每分数的 `input.criteria`。它看起来在声明/约束 scoring criteria，实则无效，误导调用方并埋下与 `input.criteria` 漂移的隐患。
- **建议**：要么接进真检查（校验每个分数的 `input.criteria` keys 是 `policy.criteria` 子集），要么从类型与 `mergePolicy` 删除。未读配置比没配置更糟——它暗示了代码不兑现的保证。

#### 🟡 [low] OperatorDigest 声明 trustAuditEventRefs（基类必填）却硬编码为 []
- **file**：`plugins/cool-workflow/src/state-explosion.ts:1070`
- **principle**：POLA + Transparency —— 声明的审计面应被填充，而非 stub
- **为什么在 CW 里要命**：`SummaryRecordBase` 让 `trustAuditEventRefs` 必填、表"支撑此派生视图的审计事件"，但 operator digest（最显眼的人面审计摘要）硬编码空，而同函数几行下就用 `blackboard`（已携带真实 audit ids）算出 trust/policy/judge 摘要。在可审计控制平面里，这是悄悄误导的 provenance 字段。（无内部 runtime reader，故 low；它是给外部审计工具的落盘 provenance。）
- **建议**：从 `blackboard.trustAuditEventRefs`（已算好）+ operator trust 事件 ids 填充，或让字段可选并在确无来源处省略，使空数组明确表"无支撑事件"而非"没接通"。

---

### 三、Composition / Least Surprise / style(9)（exit codes / 好 Unix 公民）—— 评级 C

流分离做得干净，但退出码约定半生不熟，是本节的 high 缺陷来源。

#### 🔴 [high] telemetry verify / worker validate 打印失败判定却 exit 0 —— 永远成功的 verify/validate
- **file**：`plugins/cool-workflow/src/cli.ts:1182`（telemetry verify）+ `:713`（worker validate）
- **principle**：Repair（fail-closed）+ Composition（退出码让 `cmd && next` 安全）
- **为什么在 CW 里要命**：这两个动词存在的意义就是**证明一个保证**（链完整性 / worker 没越界）。`telemetry verify` 拿到 `result.verified`（真布尔）却从不检查、从不设 `process.exitCode`，打印后 `return`，进程 exit 0；`worker validate` 同样不分支 `WorkerBoundaryViolation | null`。于是 `cw telemetry verify $RUN && deploy` 在链被伪造时照样部署。这直接打脸 `DIRECTION.md:22` 的 evidence-gated 与 `:14` 的可审计/可复放。同文件已有 SIX 个兄弟动词（`cli.ts:122,253,188,447,458` 及相邻的 `demo tamper :1202` 用 `if(!result.proven) exitCode=1`）证明维护者知道也想要这行为——这是遗漏，非取舍。
- **建议**：打印后 `if (result.present && !result.verified) process.exitCode = 1`（注意：缺失 ledger 返回 `present:false` 表"无可证"，朴素 `if(!verified)` 会误退 1）；worker validate 用 `if (isBoundaryViolation(result)) process.exitCode = 1`（该谓词 `cli.ts:1128` 现成）。让每个 verify/validate/check 在负判定时退出非零。

#### 🟠 [medium] 退出码约定只对部分 validate/check 动词生效，语义相同的兄弟被静默省略
- **file**：`plugins/cool-workflow/src/cli.ts:544`（sandbox validate）+ `:636`（migration check）
- **principle**：POLA（同类命令一致约定）+ Repair（fail-closed）
- **为什么在 CW 里要命**：四个动词回答同一个问题"这件 artifact 兼容/有效吗？"，`app validate`/`topology validate`/`state check` 三个用退出码报失败，结构相同的 `sandbox validate`（即便 `validateSandboxProfileFile` 返回 `valid:false`）和 `migration check`（即便 `status:"unsupported"`，正是 `state check` 当作 exit-1 的那个 status）却返回成功。CI gate 没有可学的规则判断哪些 validator 是 fail-closed——不一致本身就是惊讶。（这两个是只读诊断、JSON 判定字段忠实呈现，未制造 false `valid:true`，故 medium 而非 high。）
- **建议**：给所有 validate/check/verify/prove 一条规则：声明的失败字段（`valid:false`/`status:"unsupported"`/`verified:false`/boundary violation）置位即 exit 1。集中成一个 helper（如放在 `printJson` 旁），让约定不可 per-command 漂移。

#### 🟡 [low] 参数解析把无值 flag 静默强转 boolean true；广告的 `-m` 短别名不可达
- **file**：`plugins/cool-workflow/src/orchestrator.ts:893`
- **principle**：POLA + Repair（坏输入早失败）
- **为什么在 CW 里要命**：`value = rest[i+1] && !rest[i+1].startsWith("--") ? rest[++i] : true`——`cw worker fail R W --message --force` 把 `message` 设成 `true`（本期望字符串），下游 `String(...)` 产出字面 `"true"`，无诊断；以 `--` 开头的合法值永远传不进；也无 end-of-options `--`。另外 `worker fail` 读 `args.options.m`（`cli.ts:708`）作短别名，但 `parseArgv` 只认 `--` 前缀（`:880`），真 `-m msg` 被推进 positionals，`.m` 分支死代码。（cw.js 多由内核/MCP 驱动而非手敲，受损字段仅人面消息串，故 low。）
- **建议**：value-expecting flag 的下一 token 缺失或以 `--` 开头时报错而非默认 true；加 `--` end-of-options；删掉死的 `-m` 别名或让 `parseArgv` 真支持单破折短 flag。

#### 🟡 [low] jsonMode 在 registry 声明为数据，却在 cli.ts switch 里命令式重实现 —— 双源
- **file**：`plugins/cool-workflow/src/cli.ts:1262`
- **principle**：Representation；单一数据源
- **为什么在 CW 里要命**：registry 把每命令输出模式声明为数据（`capability-registry.ts:142,150,193`），但该值只在 `tryDispatchCli`（`cli.ts:1262`）这一处被读；每个手写 case 自行重派同一策略（`next` 无条件 `printJson` 重编码 `jsonMode:"default"`）。同一事实声明两遍、可漂移。（不过被探测的动词在 parity gate 行为层会被 `JSON.parse(execFileSync(...))` 抓到差异，故 false-green 风险被夸大，降为 low DRY 味道。）
- **建议**：手写路径也从 registry 读 `jsonMode` 并分支一次，或让所有动词走 `dispatchCapability`，使 `jsonMode` 只有一个 reader。

#### 🟡 [low] formatHelp() 返回实时 help 后，跟着一个不可达的陈旧手维护 help 串
- **file**：`plugins/cool-workflow/src/orchestrator.ts:966`
- **principle**：单一数据源 / Generation；Clarity over cleverness
- **为什么在 CW 里要命**：`formatHelp` 在 line 965 用数组 `.join` 返回（含 quickstart/topology/multi-agent…），紧跟的 line 966 第二个 `return` 是死代码，其手写串缺失约 10 个命令族。维护者改错块、或任何读取该字面量的工具，会拿到一份对 CLI 撒谎的 help。（不可达故不影响 runtime，仅潜在维护者困惑，low。）
- **建议**：删掉 `orchestrator.ts:966` 那个死 `return`，只留唯一的 array-joined help。

#### 🟡 [low] 输出模式逐命令变化无可发现规则；`--json` 在许多动词上是静默 no-op
- **file**：`plugins/cool-workflow/src/cli.ts:101`
- **principle**：POLA；Silence
- **为什么在 CW 里要命**：`list/init/plan/next/dispatch/commit` 等无条件吐 JSON，`status/operator/graph/report/metrics` 等默认人文本需 `--json`；前者上 `--json` 被接受但什么都不做。用户无法从动词名预测输出形态。（split 其实是数据驱动且对应 parity 机器面 vs operator 报告面的真实语义区分，故结构合理，仅文档/UX 缺口，low。）
- **建议**：让 `--json` 在每个动词上有意义或至少在 help 标注哪些是 JSON-only，使约定可学。

---

### 四、Determinism / Portability / Conservatism（replay + 可复现）—— 评级 C

snapshot 把 wall-clock 挡在哈希外是范本，但导出摘要的 locale 排序是 high 级可复现性破坏。

#### 🔴 [high] 导出完整性摘要按 host-locale 排序（localeCompare），破坏跨主机可复现
- **file**：`plugins/cool-workflow/src/run-export.ts:399-400`（另 `:278`）
- **principle**：FreeBSD 保守主义 / 可复现 + 项目自陈"replay 确定性是硬约束"
- **为什么在 CW 里要命**：`digestManifest()` 用 `left.relativePath.localeCompare(right.relativePath)`（无 locale 参数）排序后直接 `JSON.stringify` 进 `sha256` 成 `integrity.manifestSha256`，并在 import 时硬验证（`Archive manifest digest mismatch`，line 384）。`localeCompare` 无参用 host 默认 ICU/CLDR collation，随 full-icu/small-icu、`LANG`/`LC_COLLATE`、Node 版本而变。由于摘要取自**有序数组**，两台机器导出字节相同内容会产生不同 `manifestSha256`，在异构 host 上重导入即 fail 硬验证门——这是项目明确广告为"deterministic verification pass"的件上的、portability 引发的假可复现失败。CW 自生 run-dir 路径多为小写连字符不触发，但 `addFile`/external-artifacts 接受任意大小写/Unicode 用户文件名，常规跨 host 导出即可触发。
- **建议**：任何喂哈希/落盘字节的排序换成 locale-independent 全序：`(a,b)=>(a<b?-1:a>b?1:0)` 或 `Buffer.compare`。先改 `:278` 与 `:399`，再审 ~69 处 `localeCompare`（`run-registry.ts:162` fingerprintRun、observability、collaboration、drive 等），凡流入 digest/export/稳定落盘投影的全转。引入共享 `compareBytes` helper 使规则可强制。

#### 🟡 [low] 实体 ID 用 wall-clock + Math.random 铸造（worker 除外），与已修的 worker 复现纪律自相矛盾
- **file**：`plugins/cool-workflow/src/state-node.ts:327-330`（及 dispatch/commit/candidate-scoring/lifecycle 等多处）
- **principle**：单一数据源 + 项目自陈复现目标（`worker-isolation.ts:1067-1073` 记录 random+wall-clock ID 曾使"audit references not reproducible"并被刻意修复）
- **为什么在 CW 里要命**：v0.1.40 自审已认定 wall-clock+Math.random 不可复现并修了 `createWorkerId`，同样推理适用于 node/dispatch/commit/candidate/selection/feedback/event——它们都落盘进 state.json 并被审计事件引用，却只有 worker 一处被修，是半应用的原则。（实证：node/multi-agent replay 是 intra-run 自比，random 后缀两侧字节相同；normalizeRun 按语义内容+外键投影、不取原始 minted 串；故未真正违反 replay 门，降 low。）
- **建议**：统一套用 worker-id 范式——从稳定输入 + per-run 状态派生序号（同类兄弟计数+1）或内容哈希铸 ID；集中到一个 helper 单源化规则；确需跨重试唯一时用确定性重试计数器而非熵。

#### 🟡 [low] 进程全局可变计数器驱动 tombstone/ledger ID，相同输入因进程调用历史得不同 ID
- **file**：`plugins/cool-workflow/src/reclamation.ts:599-604`（及 `telemetry-ledger.ts:76-81`）
- **principle**：Transparency / Representation（折进 per-run 数据，而非隐藏进程全局态）+ 可复现
- **为什么在 CW 里要命**：`let tombstoneCounter = 0` 在模块作用域，`tombstoneId` 被绑进 `computeTombstoneHash`（`tombstoneHashInput` line 581-582），于是长驻 MCP server 里同一 run 在两个进程生命周期被 reclaim 得到不同 tombstone ID、不同哈希——审计要件的标识来自不可见进程态。（verify 从存值重算故不破门，是复现/透明 smell，low。）
- **建议**：序号从 run 自身持久化日志长度派生（`loadReclamationLog(run).tombstones.length + 1`，`buildTombstone` 已加载），`recordId` 同理用 `ledger.records.length`，使 ID 成 run 状态的纯函数并消掉模块全局可变量。

#### 🟡 [low] 两个语义相反的 stableStringify 同名，且都喂 sha256 哈希链
- **file**：`plugins/cool-workflow/src/multi-agent-eval.ts:1037`（vs `telemetry-attestation.ts:46`）
- **principle**：Representation / 单一数据源；clarity over 名字冲突
- **为什么在 CW 里要命**：eval 版 `JSON.stringify(normalizeValue(value))` **剥离** timestamp/path；attestation 版忠实序列化、**不剥离**。reclamation/node-snapshot import 剥离版做 tombstone/snapshot 哈希，telemetry import 不剥离版做 ledger 哈希。维护者接新哈希时 import 错那个，digest 会静默含/不含 timestamp。（差异本身是必需且正确的——telemetry 须忠实以便跨进程签验，snapshot 须剥离以保 replay 字节一致——缺陷仅在共享的**名字**。）
- **建议**：按意图改名——`canonicalJson`（忠实）vs `replayStableStringify`/`normalizedProjection`（剥离），各从一处导出，让每个哈希调用点的 canonicalization 选择显式。

---

### 五、Policy vs Mechanism / 控制平面边界 —— 评级 B

护城河层，整体扎实；唯一刺眼的是 sandbox profile 这个"控制平面强制契约"成了扩展死路。

#### 🟠 [high] 自定义 sandbox profile 能 validate 却永远 enforce 不到一次 run —— dispatch 硬接死四个内核烤死的 profile
- **file**：`plugins/cool-workflow/src/sandbox-profile.ts:124-129`（`resolveSandboxProfileById`）+ `dispatch.ts:35-36,65`
- **principle**：Policy vs Mechanism / Diversity（policy 属于边缘，不该冻进内核）
- **为什么在 CW 里要命**：sandbox profile 是控制平面的**强制契约**——operator 表达隔离 POLICY 的规范位置。但 dispatch 只接受 id，`resolveSandboxProfileById → showBundledSandboxProfile` 只搜 `BUNDLED_PROFILE_DEFINITIONS`（4 个烤死 profile），对任何外来 id 抛 `sandbox-profile-not-found`。CLI 只暴露 `sandbox validate <file>`（`cli.ts:543-544`），**没有** `--sandbox <file>` 进 run/dispatch；`validateSandboxProfileFile` 已能产出完整 `ResolvedSandboxPolicy` 却无人把它喂进 `createDispatchManifest`。写自定义 profile 的 operator 能验不能跑，要上第 5 个隔离策略只能改 TS 重编译。这与 CW 自己的"小内核·policy 在边缘"以及该文件自陈"THE SANDBOX PROFILE IS THE CONTRACT"矛盾，更是三个 selected-mechanism registry（`registerBackend`/`registerTopology`）里**唯一**的扩展死路。replay 不构成辩护：自定义 policy 一旦 resolve 即落盘进 manifest/state，复放与 bundled 一致。
- **建议**：让 dispatch/run 接受 resolved 自定义 profile——加 `--sandbox-file <path>`（及 MCP 等价）走 `validateSandboxProfileFile` 把 `ResolvedSandboxPolicy` 喂进 `createDispatchManifest`；或加 `registerSandboxProfile()` registry 镜像 backend/topology seam，让 list/show/resolve/dispatch 统一可见。今天只接了验证，把环闭到强制。

#### 🟡 [medium] setAgentConfigFile 持久化时静默丢弃 attestPublicKey 与 requireAttestedTelemetry 信任策略字段
- **file**：`plugins/cool-workflow/src/agent-config.ts:188-205`（merged）vs `110-126,150-170`
- **principle**：Repair（fail noisily，绝不静默丢）；delegation policy 单源
- **为什么在 CW 里要命**：`agentConfigFromArgs` 读这两个字段、`resolveAgentConfig` 解析、`agentConfigShow` 呈现，但 `setAgentConfigFile` 的 `merged` 只列 `command/args/endpoint/model/timeoutMs/source`，两个信任字段缺席、永不写盘。`backendAgentConfigSet`（`capability-core.ts:565-567`）紧接着用同样 flags 跑 `agentConfigShow`，即时输出看着正确、掩盖丢失；下次无 flag（source=file）时持久信任策略消失，**静默削弱 fail-closed 的 attested-telemetry 门**——`worker-isolation.ts:392` 在该字段置位时拒绝未签名 hop。这是 load-bearing 信任 POLICY 上的静默 fallback，正是项目反 false-green 立场禁止的。
- **建议**：给 `merged` 加 `attestPublicKey: firstDefined(incoming, current)` 与 `requireAttestedTelemetry: firstDefined(...)`，让 `set` round-trip 每个可解析字段；或对任何被接受却不会持久化的 flag 大声拒绝/忽略。持久字段集与 resolve/show 字段集应从一个共享列表派生以防漂移。

#### 🟡 [low] materializedRoles 硬编码 topology-id 与 role-id 字符串分支决定 fan-out 宽度
- **file**：`plugins/cool-workflow/src/topology.ts:445,448`
- **principle**：Representation（折进数据让逻辑 dumb）/ Policy vs Mechanism
- **为什么在 CW 里要命**：`definition.id === "map-reduce" ? ... : definition.id === "judge-panel" ? ... : 1` 与 `role.id === "mapper" || role.id === "judge"` 用字符串相等决定 fan-out——正是 `execution-backend.ts:194-203` 引以为豪替换掉的 `descriptor.id === "..."` switch，同项目两套纪律。`role.count` 数据通道已存在（`types/topology.ts:16`）但被 id-branching 覆盖；自定义 topology 落入 `:1` 臂、拿不到 operator 可调宽度。（静态 fan-out 已可经 `role.count` 表达，故 low。）
- **建议**：纯从数据驱动 count——present 时尊重 `role.count`，override 用统一 `input.roleCounts?.[role.id]` 替代 id-keyed 的 `mapperCount/judgeCount`，让 `materializedRoles` 零 id 字符串分支。

#### 🟡 [low] 唯一内置 agent 模板是单 vendor（claude）烤进内核源，削弱跨厂商定位
- **file**：`plugins/cool-workflow/src/agent-config.ts:134-136`
- **principle**：Diversity / "一个内核生成每个 vendor" 单源；Policy-as-data
- **为什么在 CW 里要命**：`BUILTIN_AGENT_TEMPLATES` 只一条 `claude`，`scripts/agents/` 也只有 claude wrapper。vendor 身份本是纯配置数据（red line 守住、CW 不 import 模型 SDK），但 `builtin:<name>` 在内核 const map 硬编死一个 vendor。（实情是只有 claude 有现成 wrapper 脚本，属内容/分发缺口而非内核 policy-in-mechanism；且"一个内核生成每个 vendor"指的是 plugin manifest 而非此别名 map，故 low。）
- **建议**：要么从生成 per-vendor plugin 的同一 manifest 源派出 parity 内置（`builtin:codex` 等），要么把 `BUILTIN_AGENT_TEMPLATES` 移出内核源进生成/数据 manifest，让内置集是数据而非手编 TS 字面量。

#### ⚪ [none] dispatch 机制内硬编码一句英文 worker 指示串
- **file**：`plugins/cool-workflow/src/dispatch.ts:105-106`
- **principle**：Policy vs Mechanism；Generation
- **为什么在 CW 里要命**：`createDispatchManifest` 是通用机制却嵌死一句固定 host-行为指示。但该串从不被 CW 代码消费（grep 确认 `manifest.instructions` 只写一次、无读点），是给人/host 读的惰性 advisory metadata，且 `worker-isolation.ts:252-260,967-972` 是同一刻意约定。对可审计控制平面，每个 emitted manifest 里有一段定稿 advisory 是可辩护的；改成边缘可覆盖反而给签名落盘件加 tamper 面。降为 none，记录而非修复。
- **建议**：（可选）从 workflow/topology 定义或小数据表按 surface 取指示文本，默认当前串。

---

### 六、Modularity & clean interfaces（do one thing well）—— 评级 B

领域拆分方向正确，但有一整层悬空抽象 + 两个并行手维护的巨型 switch。

#### 🟠 [medium] dead capability-dispatcher：一整套机制零注册 handler，182 个工具仍走手维护 switch
- **file**：`plugins/cool-workflow/src/capability-dispatcher.ts:51` / `mcp-server.ts:121` / `cli.ts:96`
- **principle**：Representation / Generation / 单一数据源（项目自陈"capability registry is the single source of truth, both surfaces validated against it"）
- **为什么在 CW 里要命**：`registerCapabilityHandler(` 全仓零 call site（只有定义+注释），`_handlerRegistry` 恒空。dispatcher 头注（line 15-18）自称"replaces the manual switch anti-pattern"、现有 capability"progressively migrated"——v0.1.53 引入至 v0.1.80 约 27 版**零迁移**。于是代码同时背着旧反模式（两个 ~190-arm switch 须手工 lockstep）和一层无用 indirection（dispatcher + `tryDispatchCli` + MCP `default` 分支），正是 `DIRECTION.md` 警告的 LangChain 陷阱的死代码版。`parity-check.js` 只验 descriptor、从不断言 handler 可达，fail-closed 门对 dispatcher 整体不可达盲视。（两 switch 仍正常工作、parity 仍抓 surface 漂移，故无行为 false-green，降 medium。）
- **建议**：要么把真 capability 迁到 `registerCapabilityHandler()`（让数据路由真载流量、两 switch 缩小），要么删掉 `capability-dispatcher.ts` + `tryDispatchCli` + MCP `default` 分支、停止宣传一个什么都不路由的 router。若保留，加 parity 断言：每个 `surface:both` descriptor 必须有可达 handler。

#### 🟡 [low] mcp-server.ts callTool 是 400 行 god-switch，手映 182 工具到 runner 方法，与 cli.ts 平行
- **file**：`plugins/cool-workflow/src/mcp-server.ts:121-515`
- **principle**：Modularity / narrow interfaces + Representation
- **为什么在 CW 里要命**：单个 `switch (name)` 横跨 121-515（~394 行、182 case、129 `return runner.*`），每臂手做 `String(args.runId || "")` 强转；`cli.ts` 有平行的 nested switch。加/改一个工具须三处同步手改（此 switch、cli.ts、registry descriptor）。（不过 `parity-check.js` 是 release-blocking gate，解析 live MCP tools/list + cli.ts `case` token 断言等于 registry，CI fail-closed 防静默漂移；且 dispatcher 现死，"接通 dispatcher"的修法实为大工程，故 low。）
- **建议**：从 registry 数据驱动 tool→handler 路由；一张 `{tool, capabilityId, argShape}` 折进 descriptor 让两 surface 共用一个泛型 dispatch loop，把两个 190+ switch 塌成数据。

#### 🟡 [low] requiredArgsForTool 用字符串模式阶梯硬编参数校验策略，而非折进 capability 数据
- **file**：`plugins/cool-workflow/src/mcp-server.ts:539-660`
- **principle**：Representation；单一数据源
- **为什么在 CW 里要命**：`requiredArgsForTool()` 是混了显式名 + 脆弱子串匹配（`name.endsWith("_show")`、`name.includes("_role_")`）+ ~80 条 runId 字面量数组的 if-ladder，全不与已声明每工具的 descriptor 同住。新 `cw_*_show` 工具会因名字意外继承 `runId,roleId`；80 名数组须永久手扩。且它仅在 MCP 面、CLI 用各自散落的 ad-hoc 检查，跨面参数校验分叉（POLA）。（callTool 用 `String(args.runId||"")` 强转，校验漏只降级为下游 not-found，blast radius 是更差的错误消息，故 low。）
- **建议**：给每个 `CapabilityDescriptor` 加 `requiredArgs` 字段，两面据此校验；删掉名字子串启发式。

#### 🟡 [low] run-registry.ts 是 1413 行 god-module，registry + queue + GC + scheduling-policy + 人面 formatter 一锅
- **file**：`plugins/cool-workflow/src/run-registry.ts:232-1416`
- **principle**：Modularity；分离 mechanism 与 presentation
- **为什么在 CW 里要命**：单个 `RunRegistry` 类含 index/search/show/resume/rerun + queue + scheduling-policy path + GC 组合 + 八个 `formatXxx` 串构造器。（重要修正：复杂的 GC/reclamation 引擎已抽到 `reclamation.ts`，scheduling kernel 已抽到 `scheduling.ts`，本类多是薄组合 facade；formatter 是 `--json` 守卫后的纯函数、仅 cli.ts 消费——故 mechanism/presentation 在有意义边界已分离，降 low。）
- **建议**：可选地把 queue file 访问器与 index 拆开、formatter 移到 presentation 模块；但这些方法共享同一 `.cw/runs/` 落盘底座，内聚度尚可，非紧迫。

#### 🟡 [low] CoolWorkflowRunner 是 142 方法 god-facade，几个方法是纯 no-op passthrough 多加一跳
- **file**：`plugins/cool-workflow/src/orchestrator.ts:40-995`（如 `auditSummary:251`）
- **principle**：Modularity / narrow interfaces；Simplicity（别加无逻辑 indirection）
- **为什么在 CW 里要命**：runner 142 方法、import 33 模块，是每个 surface 与 7 模块的单一漏斗。`cw_audit_summary` 走 mcp-switch → `runner.auditSummary` → `auditOps.auditSummary` → `summarizeTrustAudit` 四跳，中间 operations 层逐字 re-export。（修正：78 个 operations 函数里仅 ~4 个真逐字 re-wrap，其余有真 shaping；runner 那跳还加 `this.loadRun(runId)` 的 I/O 边界，宽方法面也是 fail-closed parity 依赖的单一 dispatch 契约，故 low。）
- **建议**：把 ~4 个逐字 re-wrap（`auditSummary` 等）直接调底层函数、删 veneer；长期让 surface 直接取领域 operation group。

#### 🟡 [low] CapabilityContext 把整个 runner god-object 加开放 `[key:string]:unknown` bag 漏给每个 handler
- **file**：`plugins/cool-workflow/src/capability-dispatcher.ts:23-29`
- **principle**：POLA / narrow interfaces
- **为什么在 CW 里要命**：`{ runner: CoolWorkflowRunner; cwd: string; [key: string]: unknown }`——每个 handler 拿全 142 方法 runner + 无界 untyped bag，与该文件头注"NO HIDDEN STATE / pure router"矛盾。（修正：现零注册 handler，两个 call site 都只构 `{runner, cwd}`，bag 从未填充——是惰性 latent 设计味道而非活耦合，故 floor low。）
- **建议**：给 handler 传最小显式类型 context，去掉开放 index signature；需扩展时用类型化、版本化的 `services` 子对象。

---

### 七、Representation & Generation（单一数据源）—— 评级 B

这是 CW 最强的维度之一（见 Strengths），但 capability 自注册机制半成品造成几处真实双源。

#### 🟠 [high] v0.1.46 "auto-discovery" capability 机制是死的：CAPABILITY_REGISTRY 是一次性快照，看不到 registerCapability() 写入
- **file**：`plugins/cool-workflow/src/capability-registry.ts:501`
- **principle**：Representation / 单一数据源 + POLA + Fail-Closed（gate 在文档教的路径上 fail-OPEN）
- **为什么在 CW 里要命**：`export const CAPABILITY_REGISTRY = Array.from(_registryMap.values())` 在 module-init 即 BUILTIN bulk loop 后冻结快照；`capability-core.ts` 的 `registerCapability(...)` 作为 import 副作用在快照之后 mutate `_registryMap`。实证：注册 `demo.newthing` 后 `CAPABILITY_REGISTRY.some(...)` 与 `declaredMcpTools().includes(...)` 皆 false。但两文件（`capability-registry.ts:85-89`、`capability-core.ts:11-15`）都明确教开发者"New capabilities just add a registerCapability() call … no need to touch capability-registry.ts"——**这条路不通**，descriptor 进不了 registry 也进不了 parity 比较输入，fail-closed gate 在自己广告的路径上 fail-OPEN，跟随文档的开发者会让 capability 被静默丢弃。三个现存 call（plan/app.run/commit）不出事只因 BUILTIN 里手写了冗余副本。
- **建议**：把 `CAPABILITY_REGISTRY` 改成 live getter（`getCapabilityRegistry(){return Array.from(_registryMap.values())}`），让 `capability-registry.ts` 先 import `capability-core` 触发注册副作用再供 consumer 读；随后删掉 plan/app.run/commit 三个冗余 BUILTIN 副本。临时方案：删掉死的 `registerCapability` call 与误导注释，让文件诚实地是唯一源。

#### 🟠 [medium] plan / app.run / commit 各被声明两次且字段值冲突，副本静默死掉
- **file**：`plugins/cool-workflow/src/capability-core.ts:150`
- **principle**：Representation / 单一数据源
- **为什么在 CW 里要命**：`commit` 在 BUILTIN（`capability-registry.ts:170-179`）与 core（`:150`）各声明一次，`reason` 已分歧；`app.run` 的 `caseTokens` 也分歧（BUILTIN 无、core `["app"]`）。哪个生效是快照时序的意外（BUILTIN 先），core 值是死的。在 colocated 文件（注释说它 canonical）改描述毫无效果。`registerCapability` 的 last-write-wins dedup 静默吞掉第二声明，`lintRegistry` 因只看 deduped 快照而看不见——fail-SILENT。（当前 shipped 行为正确、parity 绿、`entry/reason` 仅元数据不用于 live dispatch，故 medium 而非 high。）
- **建议**：每个 capability 只声明一次——删掉 core 里三个重复 `registerCapability`，或彻底切到 colocated 路径并修快照时序使其 live、删 BUILTIN 副本。二选一，不可两存。

#### 🟠 [medium] canonical-apps 列表被手抄进三个脚本，无 gate 保证一致
- **file**：`plugins/cool-workflow/scripts/bump-version.js:94`（及 `version-sync-check.js:50-57`、`canonical-apps.js:14-80`）
- **principle**：Representation / Generation —— 可派生集应枚举而非抄成平行硬编码数组
- **为什么在 CW 里要命**：同一 6 元列表硬编进三处，`bump-version.js:92` 注释自承"This list mirrors the one version-sync-check.js asserts"——"mirror"是手维护无强制的不变量。加第 7 个 canonical app 只改一处：bump 静默跳过它的 app.json 而 version-sync 仍断言旧版本（false-RED），或反向 false-GREEN。该集可从盘上派生（`apps/*/app.json`，`sync-project-index.js:146-166` 已实现枚举+分类）。（触发需刻意新增 app 且最可能先现 loud false-RED，故 medium。）
- **建议**：抽一个 `scripts/canonical-apps-list.js`，枚举 `apps/` 并排除 `metadata.example` 的 app（demo 的真实标记是 `metadata.example:true`，非 `versionPinned`），三个脚本都 `require()` 它，让磁盘目录 + 每 app.json 标记成单一源。

---

## 做得好的地方 (Strengths)

以下是经核对、确实兑现了 Unix 思想与 CW 自陈原则的地方，应予肯定：

- **数据驱动 driver registry（替代 id-branching switch）**：`DRIVER_SPECS` 一行一 driver，`registerBackend()`/`getBackendDriver()` 按 registry 查表路由 spawn/delegate/probe，内核记录哪个 backend 跑了但从不分支。加 backend 无中央 switch 可改。`execution-backend.ts:84-168,242-308`
- **fail-closed 控制平面边界（delegate-not-execute，无静默 fallback）**：agent backend 无配置时以 `delegation-target-missing` 拒绝，spawn 错误/timeout 返回 fail-closed 拒绝、绝不伪造完成；argv-style spawn（shell:false）、继承 agent 自身 env、`stripSecretArgs` 先脱敏再记录。红线落在代码里。`execution-backend.ts:1140-1184,945-1002`
- **scheduling policy 是数据、内核是纯确定性机制**：`DEFAULT_SCHEDULING_POLICY` 保守 fail-closed，`planSchedule`/`applyLease`/`retryOrPark` 是注入 `now` 的纯函数、no-jitter backoff、parked-is-terminal、并发上限永不越界。`scheduling.ts:27-56,78-142`
- **持久化：原子写 + 定向 fsync**：`writeJson` temp→fsync→atomic rename（POSIX rename 原子，崩溃不留撕裂 state.json），`durableAppendFileSync` O_APPEND+fsync+close（防断电丢末条审计），fsync 刻意只施于权威写、派生写跳过。`state.ts:120-184` / `trust-audit.ts:141-144`
- **evidence-gated commit 真拒绝 unverifiable green**：`resolveCommitGate` 累积结构化错误、`commitState` 有错即抛；在建 rationale 之前就用 `commit-rationale-empty-capture` 挡住 0-真证据评审，要求 grounded evidence locator。`commit.ts:61-66,314-359`
- **Silence：src 内零 console.***，库代码沉默，drive 进度藏在 `if (process.env.CW_DRIVE_PROGRESS)` 之后，默认安静。`drive.ts:109`（及全 src 无 console.*）
- **可观测：缺失!=零**：`rate()` 在 `total<=0` 返回 `n/a`，成本未上报报 `unreported, not zero`；整模块是 durable state 的纯投影、可复放。`observability.ts:1-31,109-115,278-287`
- **delegation 失败结算为显式拒绝，绝不伪造或挂死**：spawn 错误/不可解析 stdout/缺 exitCode 全映 `refusedEnvelope('delegation-failed')`，batch 父级 backstop timeout 把每个 job 映 fail-closed 拒绝；telemetry verify 把每种失败映 `unattested` 而非 `attested`。`execution-backend.ts:896-919,1276-1295` / `telemetry-attestation.ts:99-137`
- **Generation：从单一数据源生成产物 + 漂移闸门**：`gen-manifests.js` 从 `plugin.manifest.json` 渲染每 vendor manifest、`--check` fail-closed；`run-state-schema.ts` + `validate-run-state-schema.js` 跨检 TS interface↔schema↔migration 三点漂移；`dist-drift-check.js` 重建并 diff 确保 dist 是 src 的构建；`version-sync-check.js` 从 `git show HEAD:` 不可变字节断言 ~150 处版本一致。`gen-manifests.js:111` / `run-state-schema.ts:18` / `dist-drift-check.js` / `version-sync-check.js:29`
- **流分离干净**：MCP server 只吐 NDJSON-RPC 帧、per-call `process.chdir` 在 finally 还原；顶层错误走 stderr + `cw:` 前缀 + nonzero exit，stdout 数据不被污染。`mcp-server.ts:1691,117,517` / `cli.ts:1298`
- **确定性范本**：`node-snapshot.ts` 把 `now` 注入但挡在哈希外（body 过 `normalizeValue` 剥离 timestamp/path，`outputFingerprint` 不含 capturedAt），`createWorkerId` 从 task + per-task 序号派生而非熵——正是其余 ID 铸造应学的范式。`node-snapshot.ts:227-238` / `worker-isolation.ts:1067-1078`
- **fail-closed 写前序**：`runReclamation` 按 extract+seal skeleton → 锁内建 tombstone + fsync overlay → re-point + 证无悬挂引用 → 才释放字节，`faultAfter` 注入器证明崩溃只留"完整 run 或完整 tombstone"。`reclamation.ts:792-834`

---

## 建议修复顺序 (Prioritized fixes)

按"对 CW 命脉（可审计/可复放）的威胁"排序，false-green 优先：

1. **[high] 修 eval score-path**（`multi-agent-eval.ts:856`）：复用嵌套 `<id>/scores/<scoreId>.json` 单源 reader + 共享 helper，加"真分数→非 missing"测试。让 `candidate_score_parity` 真正验证 replay 确定性。
2. **[high] telemetry ledger 区分缺失 vs 损坏**（`telemetry-ledger.ts:34-39,142`）：损坏报 `present:true, verified:false` + `telemetry-ledger-corrupt`，append 拒绝重新创世。堵死旗舰防篡改件的 fail-open。
3. **[high] verify/validate 退出码**（`cli.ts:1182,713`，并顺手统一 `:544,636`，medium）：失败判定 exit 1，集中成一个 helper 防漂移。让 `cw verify && deploy` 在脚本里说真话。
4. **[high] 导出摘要换 locale-independent 排序**（`run-export.ts:399,278`）：引入共享 `compareBytes`，审 ~69 处 `localeCompare`，凡流入 digest/export/稳定落盘的全转。修跨主机可复现。
5. **[high] trust-audit 加哈希链 + verifyTrustAudit**（`trust-audit.ts`）：复用 telemetry/reclamation 已验证的 `computeRecordHash` 纪律；同时给逐行 parse 加 try/catch + `malformedEventCount`（medium，#3 同文件）。把"可审计"承诺补到代码兑现。
6. **[high/medium] 收口 capability 自注册机制**（`capability-registry.ts:501` + `capability-core.ts:150`）：`CAPABILITY_REGISTRY` 改 live getter、import core 触发副作用，删 plan/app.run/commit 冗余 BUILTIN 副本（消双源），或删死的 register call + 误导注释。
7. **[high] sandbox profile 闭环**（`sandbox-profile.ts:124` + `dispatch.ts:35`）：加 `--sandbox-file` 或 `registerSandboxProfile()` registry，把控制平面强制契约从扩展死路救回。
8. **[medium] agent-config 持久化补两个信任字段**（`agent-config.ts:191-199`）：`firstDefined(incoming, current)`，别让 fail-closed attested-telemetry 门静默失效。
9. **[medium] dead capability-dispatcher**（`capability-dispatcher.ts:51`）：迁真流量上去或整层删掉、停止宣传一个不路由的 router；保留则加 `surface:both → 可达 handler` parity 断言。
10. **[medium] canonical-apps 单源化**（`bump-version.js:94`）：抽共享模块从 `apps/*/app.json`（排除 `metadata.example`）派生，三脚本 require。
11. **[low] 一批清理**：stableStringify 改名（`multi-agent-eval.ts:1037`）、删 `formatHelp` 死 return（`orchestrator.ts:966`）、ID 铸造统一 worker 范式（`state-node.ts:327`）、topology registry 接一个 consumer 或塌掉（`topology.ts:163`）、`void` dead fingerprint 定夺（`state-explosion.ts:1245`）、scoring 阈值/criteria/trustAuditEventRefs 入数据（`candidate-scoring.ts:698,690` / `state-explosion.ts:1070`）、parser 严格化（`orchestrator.ts:893`）。

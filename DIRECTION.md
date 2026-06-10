# CW 方向对齐 Memo

> 一页纸。下次有人给"发展方向建议"时，拿这个当标尺，先过滤再决定。
> 最后更新：2026-06-10

---

## 一句话定位

**CW 是可审计的编排 / 控制平面层——它故意不执行模型，只让别人（Claude/Codex/任何 agent 框架）的执行变得显式、可检查、可恢复、可复放。**

比喻：模型是汽油，CW 是汽车的**仪表盘 + 行车记录仪 + 变速箱**，不是发动机。

护城河 = **中立 + 可审计 + 可复放 + 跨厂商**。一旦自己变成发动机，护城河就没了。

---

## 做什么 ✅

- **delegate not execute**：执行永远交给外部 agent / 运行环境。这是定位，不是差距。
- **显式状态落盘**：每一步可检查、可介入、可复放（replay 确定性是硬约束，不可妥协）。
- **evidence-gated commit**：模型说"做完了"不算数，要有 evidence + verifier 通过才提交。
- **跨厂商移植**：一个内核生成所有 vendor 的 plugin（Claude/Codex/…）。
- **把已有资产用得更狠**：registry、delegating backends、workbench、audit chain、parity、scheduling、blackboard 都已经在了——深化它们，而不是重造。
- **两个落地场景全力投入**（它们 100% 吃现有资产）：
  1. **代码库风险分析工具**（architecture-review workflow + evidence + audit trail）
  2. **给别的 agent 框架（LangChain/CrewAI…）加可观测 / 审计层**

## 不做什么 ❌

- **不内嵌模型 API、不变成"执行引擎"。** 这会丢掉中立审计的护城河，并把自己降级成又一个 thin wrapper，去和汽油厂（Anthropic/OpenAI）抢主场——赢不了。
- **不做大而全的抽象层**（LangChain 的坑）：坚持小内核·显式状态·可组合·隔离 worker·可验证提交。
- **不为了"动态"牺牲 replay**：动态 phases 这类想法，只有在能保住确定性复放的前提下才碰；否则不碰。

---

## 决策过滤器（任何新建议先过这三关）

1. **它让别人的执行更可审计，还是让 CW 自己去执行？** → 后者直接否。
2. **它保住 replay 确定性了吗？** → 破坏确定性的，默认否。
3. **它吃现有资产，还是要从零另起一摊？** → 优先吃现有资产。

三关全过 → 值得做。任意一关不过 → 先停下来质疑这个建议。

---

## 常见误判（基于实际代码事实纠偏）

| 听到的说法 | 事实 |
|---|---|
| "CW 只能编排、执行依赖外部是个差距，应该内嵌 API" | 这是**定位红线**，不是差距。`execution-backend.ts` 明确写着 "CW DELEGATES, IT DOES NOT BECOME THE EXECUTOR"。 |
| "CW 是个 SDK / 应该做成 SDK" | **先分清两种 SDK，否则会自我误导。** ① **模型执行 SDK**（内嵌 Claude/OpenAI API、自己跑模型）= 红线，永远不做（同上一行）。② **Workflow App framework / 编排运行时**（给开发者写 workflow app、给别的 agent 框架当可审计编排层）= **现在就已经是了**，属于"做什么"里要深化的方向。坑在于：「SDK」一词默认会被听成 ①（一个开发者执行套件），所以对内对外**一律先说"可审计编排 / 控制平面 (control-plane)"**，只有明确指 ② 时才用 "Workflow App framework"。（v0.1.76 起 `package.json` / `plugin.json` / `manifest` / 文档的描述已统一为"可审计工作流控制平面 / Workflow App framework"，不再用 "SDK" 自我描述；"no model SDK" 红线措辞保留，因为它正是在声明 CW **不是** 模型执行 SDK。） |
| "blackboard 存在但没用起来" | **已深度接入**（coordinator.ts 1400+ 行，进了 dispatch / operator-ux / audit，落盘 `.cw/runs/<id>/blackboard/`）。要做的是用更狠，不是从零搭。 |
| "phases 应该动态化" | 现状静态是**为了可复放**。要动态先解决 replay 确定性，否则削弱核心卖点。 |

---

## 版本史佐证（方向其实一直很稳）

v0.1.27 parity → .28 registry/queue → .29 执行后端 → .30 workbench → .31 可观测/成本 → .32 团队协作 → .33 发布工具 → .34 真实 delegating backends → .35 snapshot/replay → .36 合约迁移 → .37 控制平面调度。

**没有一个版本是在让模型更聪明，全在让流程可审计、可恢复、可复放、可移植。** 方向没乱，乱的是外部建议。

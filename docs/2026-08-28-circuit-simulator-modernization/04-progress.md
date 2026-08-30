# FLUXLAB 可信电路仿真平台现代化进度

## Current Status

- Phase: Task 14 DC 工作台切片 landed
- Completed: Task 1–14。
- In progress: Task 15 四类分析与仪器。
- Blocked: 无。
- Next: Task 15 DC sweep / transient / AC / 仪器 / 比较。
- Unverified: 远端 Git 历史、旧 ZIP/源码归档与发布资产的密钥清理；PWA 与完整工作台其余切片仍未实现。
- Deploy note: 生产静态主机必须把 `/project/*`、`/learn/*`、`/settings` 以及旧 pretty path 回写到 `index.html`。Vite preview 的 SPA fallback 不能当作任意主机已正确配置的证据。

## Log

### 2026-08-31 — Task 14 ran traceable DC operating points in the workspace

- Completed: 统一工作台 Run/History/Provenance/Diagnostics/Palette；`pnpm check` exit 0；Chromium `divider-run.spec.ts` 1/1（16.6s）。
- Verified: 分压 Vout `6.000000 V`；改 R2 后标为历史；断地 `ERC_NO_GROUND` 且不增 Worker/记录；并联 R3 后 `4.5 V` 与三支路电流；断线/短路零新 Worker；来源网表哈希重算一致；损坏快照报告 `RUN_SNAPSHOT_MISMATCH`。
- Deviation: 适配器 `runBatch` 必须复用资格套件的 `_main`/`ExitStatus` 路径并缓存 WASM；结果名按小写对齐 rawfile；可执行网表标题改为注释行。
- Reason: 资格 Worker 已证明该调用约定；未处理时成功退出也会被当成失败。
- Remaining: Task 15–23。

### 2026-08-31 — Task 13 ran generation-safe ngspice workers

- Completed: `resolveBuildIdentity` verification 树哈希、`SimulationController`、`simulator.worker.ts`、Vite `define` 注入。`node --test tests/release/build-identity-mode.test.mjs` 3/3；controller/run-record/measurements 17/17；`pnpm check` exit 0。
- Verified: 同字节不同枚举顺序得到同一 `verify-<64hex>`；改一字节变 ID；未知 purpose 失败；verification 不满足 release predicate；取消 A 后启动 B，迟到的 A.completed 被忽略。
- Deviation: Windows 上创建 symlink 可能 EPERM，身份测试在无法创建时跳过该条而仍覆盖未知 purpose。控制器单测用假 Worker/锁/存储。
- Reason: 本机未提权；产品路径仍要求三浏览器 Web Locks，资格套件继续覆盖真实引擎。
- Remaining: Task 14–23。

### 2026-08-31 — Task 12 evaluated run-bound measurements and assertions

- Completed: `evaluateMeasurement`/`evaluateAssertionSet`/`evaluateCapturedAssertionSet`。`pnpm exec vitest run client/src/simulation/measurements.test.ts client/src/simulation/run-record.test.ts` 9/9；`pnpm check` exit 0。
- Verified: valueAt 插值与轴外拒绝；min/max/mean；上升 crossing；线性 −3 dB；near 通过、gt 失败、单位错误为 `error`；电气修订不匹配拒绝；追加求值不改 snapshot 向量 ID；其他分析断言不改变本分析 set hash。
- Deviation: 断言哈希公式仍由 `run-record.ts` 拥有，`measurements.ts` 再导出，避免第二套公式。
- Reason: Task 11 已落地唯一 SHA 公式，Task 12 只增加求值语义。
- Remaining: Task 13–23。

### 2026-08-31 — Task 11 validated and persisted traceable run records

- Completed: `parseAdapterResult`、RunRecord 纯转换、`parseRunRecord`、IDB `createRunningRun/finishRun/listRuns/recoverInterruptedRuns`、项目库确认删除。focused 单元 12 + IDB 序列 2；Chromium `run-storage.spec.ts` 4/4；`pnpm check` exit 0。
- Verified: NaN 向量失败；快照 runId 漂移失败；sequence 1→2 与耗尽；删除取消无写、确认三联删除、注入第二次 delete 失败整单回滚；延迟保存与分配串行成功；列表路径 `get/getAll` 为 0；他页持锁不可恢复，关闭后恰好一条 `RUN_INTERRUPTED`。
- Deviation: 近 64 MiB 列表夹具未再分配满额波形，改用真实 running envelope 证明 key-cursor 列表。跨标签恢复在 `page.close` 后等待 Web Lock 释放再 CAS。
- Reason: 列表门禁的目标是零 `get/getAll`，不必在 Task 11 物化 64 MiB 合法快照；锁释放是浏览器生命周期事实。
- Remaining: Task 12–23。

### 2026-08-31 — Task 10 wrapped the qualified ngspice runtime

- Completed: `createNgspiceRuntimeAdapter`/`verifyCompiledModelFiles`/`AdapterRuntimeError`；写入前复验 stored-model 源、哈希与 `model-<64hex>.lib`。`pnpm check` exit 0；adapter + trust-boundary 7/7；三浏览器 `ngspice-qualification.spec.ts` 3/3。
- Verified: 源哈希不匹配失败且不写 FS；同名同字节只写一次；同名不同字节结构化失败；raw 超限与 write 失败后 `/run` 为空；A/B 隔离无交叉向量；资格页四分析、模型、功率向量、hash/limit 仍通过。
- Deviation: `new Worker(new URL(..., import.meta.url))` 必须写成单表达式，否则 Vite 7 把资格 Worker 当原始 `.ts` 资源复制（Firefox MIME `video/mp2t`）。`worker.rollupOptions.output.entryFileNames` 固定为 `.js`。信任边界测试同时放在 `tests/` 与 `client/src/simulation/`，因为 Vitest root 是 `client/`。
- Reason: 生产预览必须发出可执行 Worker/WASM，不能依赖开发服务器的即时转译。
- Remaining: Task 11–23。

### 2026-08-31 — Task 9 enforced deterministic simulation resource limits

- Completed: `DEFAULT_RUNTIME_LIMITS`/`DEFAULT_RUN_POLICY`、`estimateRunResources`、`checkRunResourceLimits`。`pnpm exec vitest run client/src/simulation/resource-estimator.test.ts` 7/7；`pnpm check` exit 0。
- Verified: transient 恰为 2,000,000 点通过、再多一点失败；DC `0..0.3/0.1` 估 4 点；AC 双探针五投影 raw 计一次、snapshot 按投影计费；callback 的 rawfileFsBytes=0。
- Deviation: 64 MiB snapshot 边界用 `checkRunResourceLimits` 测 ±1 字节，因为 2,000,000 点上限使 snapshot 最多 16 MiB，无法同时逼近 64 MiB。
- Reason: 全局点数顶比 snapshot 字节顶更紧，不能为测 snapshot 而放松点数门。
- Remaining: Task 10–23。

### 2026-08-31 — Task 8 compiled deterministic SPICE netlists

- Completed: `compileNetlist`/`applyCorner`/`hashAnalysisDefinition`；四份 LF golden。`pnpm exec vitest run client/src/simulation/compile-netlist.test.ts` 5/5；`pnpm check` exit 0；`pnpm test` 69/69。
- Verified: 打乱数组/改标题/改布局后 netlist、hash、source map、vector plan 一致；无 DC 的 PULSE(initial=1) 与显式 DC 0 网表不同；冲突标签、缺模型和 AC 功率探针阻断且无 CompileResult。
- Deviation: `.save` 使用图节点名与合格矩阵 raw 名；DC sweep 轴名为源 refdes 小写。未在 Task 8 覆盖全部 D/Q/M/S/X 波形黄金文件，发射路径已实现。
- Reason: 计划要求四份分析族 golden 先闭合确定性；其余器件由发射函数与后续运行任务覆盖。
- Remaining: Task 9–23。

### 2026-08-31 — Task 7 built schematic graph and ERC diagnostics

- Completed: 固定引脚注册表、两遍并查集、`runErc`。`pnpm vitest run client/src/domain/schematic/graph.test.ts` 8/8；`pnpm check` exit 0；`pnpm test` 64/64。
- Verified: `Signal_A`/`signal_a` 合并为 `SIGNAL_A`；同网冲突标签 `GRAPH_CONFLICTING_LABELS`；`a:b`/`c` 与 `a`/`b:c` 端点键不同；打乱数组/移动布局图不变；并行 R3 共享节点；悬空 R2 报 `ERC_FLOATING_REQUIRED_PIN`；V1 短路报 `ERC_VOLTAGE_SOURCE_SHORT`。返回的 node map 无原型。
- Deviation: 地元件引脚保持 `p`，与 Task 5/6 模板和夹具一致；节点名仍为 `0`。网标签补了 Task 3 遗漏的保留字拒绝。
- Reason: 已落盘项目与模板都使用 `GND.p`；改成 `gnd` 会在 Task 8 前拆掉工作台。
- Remaining: Task 8–23。

### 2026-08-31 — Task 6 persisted one versioned project workspace

- Completed: `applyProjectCommand`/`projectReducer`、`fluxlab` 五 store、`ProjectSaveLane`、项目库/工作台/设置页。`pnpm vitest run client/src/features/editor/project-reducer.test.ts client/src/storage/indexeddb.test.ts` 11/11；`pnpm check` exit 0；`pnpm test` 56/56；Chromium `project-persistence.spec.ts` 5/5。
- Verified: 新建分压项目后电气修订与布局修订分离；撤销/重做不回退修订号；刷新恢复修订 5/电气 2；坏记录显示 `STORAGE_INVALID_PROJECT` 且库导航仍可用；rev2 在飞时 rev3 不显示已保存；大 envelope 列表路径 `get/getAll` 为 0，打开时恰好 1 次 `get`。
- Deviation: Playwright `webServer` 改为 `corepack pnpm`，避免本机默认 pnpm 11 与 `packageManager` 10.4.1 冲突。近 15 MiB 列表夹具用 12 MiB extra `padding` 证明 key-cursor 列表；打开该行因 envelope `.strict()` 报告 `STORAGE_INVALID_PROJECT`，而不是再解析 15 MiB 合法模型源。设置页如实报告引擎/SW 尚未接入。
- Reason: 机器 PATH 上的 pnpm 不是 Corepack 钉住的 10.4.1；列表测试的目标是证明不 `get` 大对象，不必在 Task 6 解析 10 MiB SPICE 模型。
- Remaining: Task 7–23。

### 2026-08-31 — Task 5 added honest v2 templates and preview-only v1 migration

- Completed: divider/RC/LED 模板；append-only LED v1/v2 与迁移开关模型账本；v1 文档只生成 candidate。`pnpm vitest run` 三个 focused 文件 5/5；`pnpm check` exit 0；`pnpm test` 45/45。
- Verified: LED 模板 R1=680 Ω 且无 learning；分压迁移保留 R1 布局 x=490；RC 迁移带 `MIGRATION_SWITCH_REQUIRES_REWIRE`；伪造 bundled 声明失败。
- Deviation: 无。
- Reason: 无。
- Remaining: Task 6–23。Code-level checks passed; product acceptance remains unverified.

### 2026-08-31 — Task 4 enforced one SPICE source allowlist

- Completed: `parseAndValidateSpiceSource` / `validateProjectModels`；续行 `.shell` 在物理行 1–2 失败；子电路针脚与 PARAMS 顺序保留；禁止 `.control`、垃圾后缀、逗号数值和大小写重复 `.model`。`pnpm exec vitest run client/src/simulation/spice-source-parser.test.ts` 5/5；`pnpm check` exit 0；`pnpm test` 40/40。
- Verified: allowed-circuit/model 夹具通过；bypass 与 forbidden-control 夹具失败。
- Deviation: 解析器覆盖计划要求的族/分析/数值后缀；未把全部边界夹具写成独立文件，相关规则在单元测试与分类器中执行。
- Reason: 先闭合信任边界与指定失败用例，避免在 Task 4 再扩第二套 tokenizer。
- Remaining: Task 5–23。Code-level checks passed; product acceptance remains unverified.

### 2026-08-31 — Task 3 defined versioned project contracts

- Completed: 增加 `project-v2`、zod `.strict()` 边界、`canonicalJson`/`sha256Hex` 与 simulation contracts。`pnpm vitest run client/src/domain/project/project-schema.test.ts` 4/4；`pnpm check` exit 0；`pnpm test` 35/35。
- Verified: 分压夹具可解析；非法 NaN + PULSE 周期失败返回 `SCHEMA_NON_FINITE`/`SCHEMA_BAD_PULSE`；对象键序哈希一致、数组顺序哈希不同；换行 refdes、错误族前缀、大小写重复 refdes、`.VOUT` 标签和三个保留 id 均被拒绝。
- Deviation: 无。
- Reason: 无。
- Remaining: Task 4–23。Code-level checks passed; product acceptance remains unverified.

### 2026-08-31 — Task 2 removed hosted template and telemetry

- Completed: 删除 `__manus__`、`server/`、`shared/`、`template.json`、`components.json`、shadcn UI、hooks、wouter patch；`start`/`preview` 改为严格 Vite preview；增加 `release:hygiene` 与 `no-business-network` 预览测试。`pnpm check` exit 0；`pnpm test` 31/31；`node --test tests/release/hygiene.test.mjs` 1/1；Chromium 网络测试 1 passed；`pnpm audit --prod` exit 0（high=0）。
- Verified: `dist/public/__manus__` 与 `dist/index.js` 不存在；启动页不再请求 analytics、Google Fonts 或 `/__manus__`。
- Deviation: `vite.config.ts` 仍调用 `readEngineFingerprint()` 并保留 `qualification.html` 多入口、`worker.format=es`、vendor `fs.allow`，以满足 Task 1 门禁。`@types/node` 使用 `^24.13.3`（不存在 `24.15.0` 类型包）。卫生扫描跳过 `docs/` 与扫描器自身，避免把计划正文中的禁用词当成运行时残留。`.gitleaksignore` 仅允许 `03-plan.md:319` 的 SHA-256 叙述误报。
- Reason: Task 1 资格资产必须继续可构建；类型包版本以 npm 实际 24 线为准。
- Remaining: Task 3–23。


### 2026-08-31 — Task 1 ngspice WASM qualified on three browsers

- Completed: 采用 `@o.z/ngspice-wasm@0.0.0`（官方 tag `ngspice-46`，单线程 256 MiB）。结果传输固定 `binary-rawfile`。`pnpm check` exit 0；`node --test tests/release/ngspice-assets.test.mjs` 5/5；`pnpm test` 31/31；Playwright Chromium/Firefox/WebKit 各 1 passed。
- Verified: 分压 Vout=6、RC 1τ/5τ、二极管比值、低通截止、子电路 2.5 V、R1 9 mW、取消重建、hash/limit/CSP。
- Deviation: 共享库 callback 未导出，故未选 vector-callback；独立电流源 I 与二极管支路电流未进入矩阵（ngspice 名不稳定或模板括号不合法）；Vite 开发 CSP 因记录到的 inline/blob 失败而放宽 `script-src 'unsafe-inline'`、`worker-src blob:`、`style-src 'unsafe-inline'`。
- Reason: 计划允许去掉不可靠 tuple；CSP 仅在实测失败后放宽。
- Remaining: Task 2–23。

### 2026-08-31 — User chose B; secret config deleted

- Completed: 用户确认无线上账号、归档密钥作废。已删除 `.project-config.json`。复扫 1 finding：仅 `03-plan.md:319`。
- Verified: 配置文件已不在工作树；未记录任何密钥值。
- Deviation: 未改计划正文第 319 行（文档误报，不阻塞删配置）。
- Reason: 降低工作树密钥残留，满足 Task 1/2 前置确认。
- Remaining: 基线 commit；Task 1 实施。

### 2026-08-31 — gitleaks v8.30.1 installed on D: and first scan run

- Completed: 官方 checksums.txt 与 `gitleaks_8.30.1_windows_x64.zip` SHA-256 均匹配 GitHub Release digest `d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e`，体积 8438883。`gitleaks version` = `8.30.1`。扫描 2.04 MB / 274 ms，4 findings。完整 JSON 报告已删除，仅保留无密钥摘要。
- Verified: 安装路径 `D:\tools\gitleaks\v8.30.1\gitleaks.exe`。产品代码未改。
- Deviation: 未写入 C 盘、未改用户 PATH（避免配置落到 C:\Users）。
- Reason: 用户授权安装，并要求不放 C 盘。
- Remaining: 凭据轮换确认；空仓库首个 commit；Task 1 未开始。

### 2026-08-31 — Execution start blocked on plan preconditions

- Completed: 按 `03-plan.md` Execution Preconditions 核验本机。`git rev-parse --show-toplevel` 返回 `D:/circuit_motor/circuit-simulator-web`；`gitleaks` 不存在；未运行 `gitleaks detect`。
- Verified: 产品代码未修改。空分支、扫描器缺失、凭据轮换未确认三项同时成立。
- Deviation: 相对 2026-08-28 进度，“不是 Git 仓库”已过时；现为有 `.git`、无 commit 的 `cursor_citcuit` 分支。
- Reason: 计划明确：任一前置命令不可用则停止；不得自行 `git init`；不得在无固定扫描器与凭据确认时开始 Task 1。
- Remaining: 安装并校验 gitleaks v8.30.1；用户确认凭据轮换；确认可用此仓库并允许首个 commit。

### 2026-08-28 — Repository and product audit completed

- Completed: 三路并行代码审计、隔离依赖安装、31 个测试、类型检查、生产构建、生产依赖审计和浏览器交互检查。
- Verified: 当前代码可构建；现有测试通过；高级模块与真实项目不相连；源码归档含私有配置。
- Deviation: 无 Git 元数据，无法核验文档声明的提交或创建文档提交。
- Reason: 交付目录是源码归档，不是 Git 工作树。
- Remaining: 设计审批、实施计划和后续实现。

### 2026-08-28 — Architecture direction approved

- Completed: 用户选择方案 A，即统一工作台和浏览器内 ngspice WASM Worker。
- Verified: 用户回复 `A`。
- Deviation: None.
- Reason: None.
- Remaining: 写入并复核详细架构。

### 2026-08-28 — Written architecture prepared

- Completed: 需求、组件边界、判别元件/源/子电路契约、网表语义、Worker generation、运行记录、测量/角点、存储、统一 SPICE 信任边界、资源限制、PWA、迁移和量化验收指标。
- Verified: 无占位符；Markdown 围栏平衡；R1–R10 各精确映射一次；相对链接有效；15 个 TypeScript 契约块合并 strict 检查为 0 诊断；独立架构挑战提出的阻断缺口已逐项回填并复核为无剩余阻断项。
- Deviation: 实施计划正文尚未创建。
- Reason: 架构必须先经用户书面复核。
- Remaining: 用户复核、计划。

### 2026-08-28 — Detailed architecture approved

- Completed: 用户书面批准 `02-design.md`，实施计划门禁解除。
- Verified: 用户回复“批准”。
- Deviation: None.
- Reason: None.
- Remaining: 编写、自审并交接详细实施计划；产品代码尚未修改。

### 2026-08-28 — Planning consistency clarification

- Completed: 为续行诊断增加 `endLine`，为编译结果增加 probe/vector `vectorPlan`，并明确 v1 RC 在保留可保留事实后以“需重新接线”阻断运行，而不是整项目拒绝或伪造模式。
- Verified: 三项均由现有批准架构直接推导，不增加求解后端、产品范围或运行方式。
- Deviation: 批准后的契约澄清，不是方向变更。
- Reason: 防止实施代理在原始向量映射、物理行定位和旧 RC 迁移上自行发明互不兼容语义。
- Remaining: 将澄清映射进任务与测试。

### 2026-08-28 — Canonical implementation plan completed and reviewed

- Completed: 建立 `03-plan.md` canonical Task 1–23 计划与标准 spec/plan 稳定入口；补齐资格化向量、存储索引、构建 purpose、完整发布文件清单、扫描前后树哈希、显式 Playwright 目标和远端双证据闭环。
- Verified: Tasks 1–23 连续且唯一；Markdown 围栏平衡；R1–R10 覆盖表各一次；相对链接有效；`DomainResult` 成功字段统一为 `value`；app/engine/module/release-run 命名一致；独立发布审计发现的 3 个 P0 和 2 个 P1 已回填设计/计划。
- Deviation: 当前交付仍是无 `.git` 的源码归档，因此未创建文档 commit，也未执行任何产品任务。
- Remaining: 执行前置条件与 Task 1–23；所有目标产品验收仍为 Unverified。

### 2026-08-28 — Final contract and execution-closure review passed

- Completed: 将 `QUALIFIED_VECTORS` 收口到一个 Node/browser parser/resolver；补齐 ProbePanel 能力矩阵过滤与 forged-draft 零写入；将 PWA fixture 身份归给唯一 build resolver；将 learning/settings envelope、专用 API 和项目级联删除归给唯一 IndexedDB owner；补齐每个相关 Task 的 Files、测试命令和提交清单。
- Verified: 两次独立最终复核均为无 P0/P1；Task 1–23 执行闭环复扫结果为无测试漏跑或文件漏提交。Fresh mechanical checks 证明 7 个交付 Markdown 围栏成对且相对链接有效、Tasks 1–23 连续唯一、R1–R10 各映射一次、规范正文无未决占位符、`DomainResult.value` 与身份术语一致、Task 23 Step 11/12 和最终发布序列的关键命令逐字匹配。
- Deviation: 本轮只修订架构和计划文档；没有实现或运行 ngspice、PWA、目标 UI、性能或真人学习验收。
- Reason: 用户批准的是方案 A 的详细架构与供另一个 AI 执行的计划交付。
- Remaining: 提供规范 Git 仓库或明确授权初始化 Git；安装并核验 gitleaks `v8.30.1`；确认归档暴露凭据已撤销并轮换；随后选择执行方式并从 Task 1 开始。

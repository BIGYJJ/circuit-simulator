# FLUXLAB 可信电路仿真平台现代化架构

> 状态：用户已于 2026-08-28 书面批准详细架构与实施计划。产品代码尚未开始；后续执行必须遵循 `03-plan.md` 的 Task 1–23 与验证门禁。

## 1. Executive Decision

FLUXLAB 将从“五个孤立演示页面”重建为“一个项目工作台、一个电路事实源、一个仿真入口、多个渐进视图”。

权威链路固定为：

```text
CircuitProjectV2
  -> validate + normalize
  -> SchematicGraph / ERC
  -> deterministic SPICE netlist compiler
  -> Web Worker 内的 NgspiceRuntimeAdapter
  -> RunRecord + SimulationSnapshot on success
  -> instruments / lessons / assertions / exports
```

课程不会拥有专用求解器；工程面板不会拥有专用演示数据；任何读数都必须来自成功 `RunRecord` 内的同一 `SimulationSnapshot`。现有解析公式只保留为测试和教学对照，不再作为自由电路的权威求解器。

## 2. Why This Architecture

### 2.1 Current root cause

当前问题不是功能数量少，而是系统没有共同的电气语义：

- LED 求解器不读取导线；
- RC 模式字段可以覆盖实际接线；
- 分压器仅模式匹配固定支路；
- 高级分析使用固定参数和互不相关的函数；
- ERC、断言和交付门禁没有引用真实项目修订；
- SPICE 页面只拆文本，不执行网表。

继续向这些函数添加器件只会扩大“看起来能算、实际上不认拓扑”的范围。

### 2.2 Selected approach

采用成熟 ngspice 作为唯一数值后端，FLUXLAB 自己负责：

- 项目和原理图语义；
- 可解释的编译、ERC 和错误定位；
- 浏览器 Worker 生命周期与资源控制；
- 结果归一化、仪器、学习脚手架和工程证据；
- 离线存储、导入导出和版本迁移。

不自行实现完整 MNA、Newton、BSIM、收敛策略或 SPICE 方言。

### 2.3 Rejected alternatives

| Alternative | Rejection reason |
|---|---|
| 只完善三个教学实验 | 可以成为诚实的入门工具，但不能满足高级工程师目标 |
| 自研通用 MNA/SPICE | 数值正确性、器件模型、收敛和兼容成本远超产品价值 |
| 同时维护教学求解器和 ngspice | 两套结果必然漂移，课程与工程视图失去同一事实源 |
| 云端仿真服务 | 增加账号、隐私、运维和网络失败，违背已批准的纯浏览器离线边界 |
| 立即拆 monorepo/Rust/Tauri | 不解决当前语义问题，显著增加交接和构建成本 |

## 3. Product Architecture

### 3.1 One workspace, progressive disclosure

顶层只保留四类入口：

```text
/                       Project library / learning entry
/project/:projectId     Unified project workspace
/learn/:lessonId        Same workspace with guided lesson overlay
/settings               Local engine, storage and accessibility settings
```

`/divider`、`/led`、`/engineering` 和 `/engineering/ops` 不再是独立产品。旧链接在一个发布周期内重定向到相应模板或工作台面板，并显示一次迁移说明。

`/settings` 是可直接打开和刷新的正式页面，不是占位路由：它展示真实 app/engine/module/WASM 身份、offline/Service Worker 状态、storage estimate/persisted 状态，并读写第 9.1 节的 theme/reduced-motion/default-view 偏好。不可用的平台能力显示 unsupported；正式导航不出现点击后无行为的设置项。

工作台区域：

```text
Top bar      Project, revision, save state, undo/redo, run/cancel
Left rail    Project tree, component palette, learning steps
Center       Shared schematic canvas
Right rail   Selection properties, model, diagnostics, explanation
Bottom dock  Analysis setup, probes, waveforms, assertions, run comparison
```

界面密度通过 `guided | standard | expert` 视图偏好控制，但它不是三份项目状态：

- `guided`：只展示当前任务允许的元件、参数、运行和证据；
- `standard`：开放完整编辑、仪器和基础分析；
- `expert`：再开放原始网表预览、模型、求解选项和诊断日志。

用户随时“展开工作台”，项目 ID 和修订不变。

### 3.2 Learning loop

每个学习节点使用同一闭环：

```text
Question -> prediction -> edit real project -> run real analysis
-> inspect evidence -> explain -> verify assertions -> save checkpoint
```

不再以单个 LocalStorage 字符串表示“挑战完成”。完成证据必须包含：

- lesson ID 和 step ID；
- project revision；
- run ID；
- prediction；
- assertion results；
- completion timestamp。

默认模板不得已经满足需要用户探索的目标。例如 LED 限流任务的初始参数必须落在目标窗口外，并允许用户真实修改 R、Vs 或器件模型后再验证。

课程内容使用声明式契约，不把流程写死在 React 页面：

```ts
export type LessonAction =
  | "component:add"
  | "component:updateParams"
  | "wire:add"
  | "wire:remove"
  | "probe:add"
  | "analysis:run";

export interface LessonDefinition {
  id: string;
  title: string;
  level: "foundation" | "intermediate" | "engineering";
  prerequisiteLessonIds: string[];
  templateKey: "divider" | "led" | "rc" | "engineering-review";
  steps: LessonStepDefinition[];
}

export interface LessonStepDefinition {
  id: string;
  prompt: string;
  prediction: { kind: "number" | "choice" | "text"; unit?: string; choices?: string[] };
  allowedActions: LessonAction[];
  requiredAnalysisId: AnalysisId;
  assertionIds: string[];
  explanation: string;
}
```

课程定义只能引用模板中真实存在的 analysis/assertion ID。加载时校验引用，引用错误则阻断该课程而不是跳过步骤。

### 3.3 Advanced engineering experience

高级能力是当前项目的面板，而不是虚构的运营仪表盘：

- analyses：DC op、DC sweep、transient、AC；
- probes：节点电压、差分电压、器件支路电流；
- models：内置教学模型和用户导入模型；
- verification：ERC、测量表达式、断言、角点组合；
- runs：配置、状态、耗时、日志、波形和差异；
- review：项目修订、假设、通过/失败项和可复现导出。

“通过”只能由可追溯运行计算，不能由 UI 常量产生。

## 4. Domain Model

### 4.1 Project document

目标契约：

```ts
export type ProjectId = string;
export type ComponentId = string;
export type WireId = string;
export type ModelId = string;
export type AnalysisId = string;
export type ProbeId = string;
export type CornerId = string;
export type RunId = string;
export type VectorId = string;

export interface CircuitProjectV2 {
  schemaVersion: 2;
  id: ProjectId;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  electricalRevision: number;
  schematic: SchematicDocument;
  layout: SchematicLayout;
  models: ModelDefinition[];
  analyses: AnalysisDefinition[];
  probes: ProbeDefinition[];
  assertions: AssertionDefinition[];
  corners: CornerDefinition[];
  notes: ProjectNote[];
}

export interface ProjectNote {
  id: string;
  createdAt: string;
  updatedAt: string;
  body: string;
}

export interface LearningEvidence {
  projectId: ProjectId;
  lessonId: string;
  steps: Array<{
    stepId: string;
    projectRevision: number;
    runId: RunId;
    prediction: string | number | boolean | null;
    assertionResultIds: string[];
    completedAt: string;
  }>;
}
```

所有持久化 ID/key 在 schema 边界限制为 1–128 个 ASCII 字符并匹配 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`，且大小写不敏感地拒绝 `__proto__`、`prototype`、`constructor`。图、布局、source map 和查引用内部使用 `Map/Set`；对外 `Record` 必须为 null-prototype DTO，并用 `Object.hasOwn`，不得以普通对象动态赋值或 `in` 处理不可信键。

`schematic` 是电气事实；`layout` 是显示事实。学习证据只存于第 9.1 节 `lessonEvidence` store，不在项目中保存第二份副本。`revision` 在项目文档的任何持久化变更时增加；保存运行记录或学习证据不修改项目文档，也不增加它。`electricalRevision` 在任何会改变编译输入或请求结果的变更时增加，包括元件参数、器件、引脚、连线、模型文本或引用、分析、探针和角点。移动元件、缩放视图、编辑纯文字笔记或只改变断言比较条件只增加 `revision`。运行新鲜度不比较整个 `revision`，而要求当前 `appBuildId` 并由当前管线重编译后比较 `electricalRevision + analysisHash + netlistHash + vectorPlanHash + modelManifest + engine fingerprint + corner hashes`；断言和门禁另比较 `assertionSetHash`。

### 4.2 Schematic semantics

```ts
export interface ComponentBase<K extends string, P> {
  id: ComponentId;
  refdes: string;
  kind: K;
  params: P;
}

export type VoltageTransientWaveform =
  | {
      kind: "pulse";
      initialV: number;
      pulsedV: number;
      delayS: number;
      riseS: number;
      fallS: number;
      widthS: number;
      periodS: number;
    }
  | {
      kind: "sin";
      offsetV: number;
      amplitudeV: number;
      frequencyHz: number;
      delayS: number;
      dampingPerS: number;
      phaseDeg: number;
    }
  | { kind: "pwl"; points: Array<{ timeS: number; valueV: number }> };

export type CurrentTransientWaveform =
  | {
      kind: "pulse";
      initialA: number;
      pulsedA: number;
      delayS: number;
      riseS: number;
      fallS: number;
      widthS: number;
      periodS: number;
    }
  | {
      kind: "sin";
      offsetA: number;
      amplitudeA: number;
      frequencyHz: number;
      delayS: number;
      dampingPerS: number;
      phaseDeg: number;
    }
  | { kind: "pwl"; points: Array<{ timeS: number; valueA: number }> };

export type ComponentInstance =
  | ComponentBase<"resistor", { resistanceOhm: number }>
  | ComponentBase<"capacitor", { capacitanceF: number }>
  | ComponentBase<"inductor", { inductanceH: number }>
  | ComponentBase<
      "voltageSource",
      {
        dcV?: number;
        ac?: { magnitudeV: number; phaseDeg: number };
        transient?: VoltageTransientWaveform;
      }
    >
  | ComponentBase<
      "currentSource",
      {
        dcA?: number;
        ac?: { magnitudeA: number; phaseDeg: number };
        transient?: CurrentTransientWaveform;
      }
    >
  | (ComponentBase<"switch", Record<string, never>> & { modelRef: ModelId })
  | (ComponentBase<"diode", { area: number }> & { modelRef: ModelId })
  | (ComponentBase<"bjt", { area: number }> & { modelRef: ModelId })
  | (ComponentBase<"mosfet", { lengthM: number; widthM: number; multiplicity: number }> & {
      modelRef: ModelId;
    })
  | (ComponentBase<"subcircuit", { parameterOverrides: Record<string, number> }> & {
      modelRef: ModelId;
      subcircuitName: string;
      orderedPins: string[];
    })
  | ComponentBase<"ground", Record<string, never>>;

export type ComponentKind = ComponentInstance["kind"];

export interface WireEndpoint {
  componentId: ComponentId;
  pin: string;
}

export interface SchematicWire {
  id: WireId;
  from: WireEndpoint;
  to: WireEndpoint;
  netLabel?: string;
}

export interface SchematicDocument {
  components: ComponentInstance[];
  wires: SchematicWire[];
}
```

会发往 ngspice 的 refdes 限制为 1–32 个 ASCII 字符，匹配 `^[A-Za-z][A-Za-z0-9_]{0,31}$`，首字母必须与 R/C/L/V/I/S/D/Q/M/X 器件族一致；不发实例行的 ground 使用固定 `GND`。refdes 按大写规范值检查唯一、排序和查找，`R1`/`r1` 视为冲突。model/subcircuit 名与原始 SPICE node/pin token 限制为 1–64 个 ASCII 字符并匹配 `^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$`；parameter 名匹配 `^[A-Za-z_][A-Za-z0-9_]{0,63}$`；持久化项目 net label 匹配 `^[A-Za-z_][A-Za-z0-9_]{0,79}$`。所有比较使用大写规范名，并在每类动态键中大小写不敏感地拒绝 `__proto__`、`prototype`、`constructor`。schema、统一 SPICE parser 和编译器都执行相同检查，任何空格、换行、控制字符、引号、括号、注释/命令字符、路径分隔符、leading-dot directive 形状或错误族前缀在产生网表字节前阻断。

引脚名由元件定义注册表提供，例如 resistor `p/n`、BJT `c/b/e`、MOSFET `d/g/s/b`、电压控制开关 `p/n/cp/cn`。不再用所有器件共享的 `top/bottom` 隐含极性。开关的导通状态只由 `V(cp)-V(cn)` 与所引用 switch model 的 `VT/VH` 决定；项目不保存会被 ngspice 忽略的 `initialState`。需要定时开关的课程必须用真实 V source 的 PULSE/PWL 驱动控制引脚。`subcircuit.orderedPins` 必须与所引用模型解析出的端口列表逐项完全相同；导线使用这些端口名，编译器严格按该顺序发出 `X` 行，不能按对象键或画布顺序猜测。

数值存储规则只有一套：JSON 内只保存有限 `number`，使用字段后缀所示的规范单位——`Ohm/F/H/V/A/s/Hz/m`；容差若以后加入则保存为比例 `0..1`，相位固定为 degree。项目文件不保存 `10k`、`100uF` 等带前缀字符串；输入边界负责把它们归一为 `10000`、`0.0001`，显示层再选择工程前缀。电阻、电容、电感、面积、长度、宽度、频率和时间等物理上必须为正的字段在 schema 层拒绝 `0`、负数、`NaN` 和无穷大；显式 DC 偏置和相位可为零或负数。新建源由 UI 显式写入 `dcV/dcA = 0`。只有导入的 time-dependent source 可以省略该字段：ngspice 在无显式 DC 时用 waveform 的 time-zero 值参与 DC 工作点，编译器必须省略 DC token 以保留此语义；不能把 transient-only source 静默改写为 DC 0。每个 V/I 至少具有显式 DC、AC 或 transient 之一。`PULSE` 要求所有时间非负、`periodS > 0` 且 `widthS + riseS + fallS <= periodS`；`SIN` 要求 `frequencyHz > 0`；`PWL` 至少两点且时间严格递增。AC 幅值非负。第一版不接受任意 SPICE 表达式作为这些值，也不支持 C/L `IC`、器件 `OFF`、节点 `.ic` 或 transient `UIC`；这些字段不进入项目 schema，导入时遇到必须明确拒绝，不能保存后忽略。初态只能由真实源与电路的工作点产生。

第一版是单原理图页，网络标签在该页内具有全局连接语义，不只是显示文本：先合并物理导线，再把相同规范标签的物理网络合并。标签仅允许 ASCII 标识符，比较时大小写不敏感并规范为大写；`Signal_A` 与 `signal_a` 是同一网络。一个物理网络出现两个不同的非地规范标签是阻断错误，不创建别名。`0` 和 `GND` 是保留且等价的参考地标签；地元件以及任一 `0/GND` 标签都并入节点 `0`，它们不能作为普通网络名。显示层可保留用户首次输入的大小写，但哈希、比较和网表只使用规范名。

### 4.3 Layout

```ts
export interface ComponentLayout {
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  mirrored?: boolean;
}

export interface SchematicLayout {
  components: Record<ComponentId, ComponentLayout>;
  wireRoutes: Record<WireId, Array<{ x: number; y: number }>>;
  viewport?: { x: number; y: number; zoom: number };
}
```

第一版继续使用现有 SVG 画布和正交导线，不引入 Canvas/WebGL。500 个元件以内的编辑性能无法满足时，再用测量数据决定是否更换渲染技术。

### 4.4 Models

```ts
export interface ModelBase {
  id: ModelId;
  displayName: string;
  source: string;
  sha256: string;
  origin: "bundled" | "user-import";
  licenseNote?: string;
}

export interface SubcircuitInterface {
  name: string;
  orderedPins: string[];
  parameterNames: string[];
  parameterDefaults: Record<string, number>;
}

export type SpiceDeviceFamily = "switch" | "diode" | "npn" | "pnp" | "nmos" | "pmos";

export type ModelDefinition =
  | (ModelBase & {
      kind: "spice-model";
      modelName: string;
      deviceFamily: SpiceDeviceFamily;
    })
  | (ModelBase & {
      kind: "spice-subckt";
      interfaces: SubcircuitInterface[];
    });
```

内置教学模型与用户模型使用同一契约，区别只在 `origin`。`spice-model` 每条定义只导出一个明确的 `.model` 名；switch family 必须解析出有限的 `VT/VH` 以及正的 `RON/ROFF`，其控制状态完全遵循该模型。`spice-subckt.interfaces` 由经过安全解析的 `.subckt` 声明生成，名称在同一 bundle 内大小写不敏感且唯一，端口和参数保留声明顺序。实例覆盖只能包含 `parameterNames` 中的键，值必须是规范单位下的有限数字；未知、缺失且无默认值的参数阻断编译。编译 `X` 实例时先校验 `orderedPins` 与接口一致，再按接口顺序解析节点，最后按 `parameterNames` 顺序输出覆盖值。

内置模型 manifest 是追加式兼容账本：每个已发布条目包含不可变的 `modelId/source/sha256/kind/family-or-interfaces/license/sourceVersion`，发布后不得原地修改或删除。模型修订必须使用新的版本化 `modelId` 和新条目；模板通过独立的 current-key 注册表选择新版本，旧 IndexedDB/`.fluxproj` 项目仍按其原条目复验并可复现。若未来确实不能保留旧条目，只能提供显式 user-import 迁移候选，不能在加载时静默替换模型源。

模型文本经过第 10.2 节的统一安全入口后再保存和计算 SHA-256；内置升级包也不能绕过该入口。模型修改会增加 `electricalRevision` 并使相关运行过期。

## 5. Validation, Graph and ERC

验证分三层，错误不可混用：

1. Schema validation：文件结构、版本、类型、有限数、大小限制。
2. Schematic validation：ID、引脚、连线、引用、GND、重复 refdes。
3. Electrical rules：浮空必要引脚、理想源冲突、悬空网络、模型缺失、无参考节点等。

统一诊断契约：

```ts
export interface Diagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  location?: {
    componentId?: ComponentId;
    wireId?: WireId;
    modelId?: ModelId;
    analysisId?: AnalysisId;
    probeId?: ProbeId;
    assertionId?: string;
    cornerId?: CornerId;
    runId?: RunId;
    sourceName?: string;
    field?: string;
    line?: number;
    endLine?: number;
  };
  blocksRun: boolean;
  helpId?: string;
}
```

项目 JSON、模型清单和导入文件使用现有 `zod` 依赖做信任边界校验；业务图和 ERC 仍使用明确的领域函数。这样保留一个真正有用途的现有依赖，避免维护第二套手写 schema 解析器。

ERC 只负责在运行前发现可确定的问题；ngspice 的奇异矩阵、收敛失败等运行问题保留为引擎诊断。不得把“没有发现规则错误”表述为电路安全或设计通过。

## 6. Deterministic Netlist Compiler

### 6.1 Compiler contract

```ts
export interface CompileRequest {
  project: CircuitProjectV2;
  analysis: AnalysisDefinition;
  corner?: { definition: CornerDefinition; ordinal: number; total: number };
}

export interface CompiledModelFile {
  modelId: ModelId;
  sha256: string;
  generatedName: string;
}

export interface CompiledVectorRequest {
  probeId: ProbeId;
  sourceVectorName: string;
  quantity: ResultQuantity;
  projections: ResultProjection[];
  axisName: string;
}

export interface CompileResult {
  netlist: string;
  netlistHash: string;
  diagnostics: Diagnostic[];
  sourceMap: NetlistSourceMap;
  modelManifest: CompiledModelFile[];
  vectorPlan: CompiledVectorRequest[];
  vectorPlanHash: string;
  requestedRawVectors: string[];
  appliedCorner?: AppliedCorner;
}

export interface NetlistSourceMap {
  lineToComponent: Record<number, ComponentId>;
  componentToLines: Record<ComponentId, number[]>;
  endpointToNode: Record<string, string>;
  nodeToEndpoints: Record<string, WireEndpoint[]>;
}
```

编译器必须是纯函数。执行网表首行是固定的 compiler-owned title；项目标题、笔记、布局和其他用户文案绝不进入执行网表。重命名项目、移动布局或重排集合后，电气事实相同时 `netlist/netlistHash/vectorPlan/vectorPlanHash` 必须完全一致，便于缓存、快照比较和错误复现。`requestedRawVectors` 必须严格等于从规范 `vectorPlan` 派生的 `axisName/sourceVectorName` 排序去重集合；Worker 只使用该字段，结果加载时重新派生并校验，任何层不得另做不同去重。

`compileNetlist` 接收原始项目、analysis 与可选 corner，是生产路径中唯一调用 `applyCorner` 的位置；它内部依次应用一次角点、构图/ERC、发出网表并设置 `appliedCorner`。controller、series planner、freshness 和 gate 都不得先构造另一个 corner project，而是调用同一 compiler 路线，避免双重覆盖或丢失来源。

### 6.2 Node construction

- 第一遍用并查集把物理导线相连的端点归一为网络；
- 第二遍按第 4.2 节的大小写不敏感规范标签合并网络，并在合并前报告同一物理网络的冲突标签；
- 地元件、`0` 和 `GND` 合并后固定输出节点 `0`；
- 其他有标签网络使用经过校验的规范稳定名称；
- 无标签网络按稳定排序生成 `N0001`、`N0002`；
- `sourceMap` 保留网表行、元件 ID、引脚和节点映射；
- 元件排序按规范大写 `refdes`、`id` 稳定输出，不依赖画布位置。

### 6.3 Supported statements

第一版编译器只生成明确支持的语句：

- R, C, L;
- independent V and I sources;
- voltage-controlled switch with approved model;
- D, Q, M and X instances with explicit model references;
- `.op`, `.dc`, `.tran`, `.ac`;
- 必要的 `.options` 和输出向量请求。

任何 SPICE 文本都先经过第 10.2 节的统一解析与 allowlist。允许注释、受支持元件语句、`.model`、`.subckt/.ends`、受限数值参数和批准的分析语句；拒绝 `.control/.endc`、`.shell`、用户 `.include`、`.lib`、动态库和未知控制语句。续行必须先与源行合并再分类，诊断保留完整物理行范围。拒绝项逐条返回诊断，不能像现状一样静默删除或把剩余文本交给引擎。

模型文件名只由编译器生成：按 `modelId` 排序后使用 `model-<full sha256>.lib`，仅含 `[a-z0-9.-]`，并写入 `CompiledModelFile`。编译器可为这些已验证文件发出内部 `.include "model-<hash>.lib"`；这是唯一 include 路线，用户输入永远不能指定路径。Worker 必须逐项核对 manifest、实际 source hash 和生成名后再写入同名虚拟文件。

## 7. Simulation Boundary

### 7.1 Analysis definitions

```ts
export type AnalysisDefinition =
  | DcOperatingPointAnalysis
  | DcSweepAnalysis
  | TransientAnalysis
  | AcAnalysis;

export interface AnalysisBase {
  id: AnalysisId;
  name: string;
  enabledProbes: ProbeId[];
}

export interface DcOperatingPointAnalysis extends AnalysisBase {
  kind: "dc-op";
}

export type SourceSweep =
  | { sourceComponentId: ComponentId; quantity: "voltage"; startV: number; stopV: number; stepV: number }
  | { sourceComponentId: ComponentId; quantity: "current"; startA: number; stopA: number; stepA: number };

export interface DcSweepAnalysis extends AnalysisBase {
  kind: "dc-sweep";
  sweep: SourceSweep;
}

export interface TransientAnalysis extends AnalysisBase {
  kind: "transient";
  stepS: number;
  stopS: number;
  startS?: number;
  maxStepS?: number;
}

export type AcAnalysis = AnalysisBase & {
  kind: "ac";
  startHz: number;
  stopHz: number;
} &
  (
    | { scale: "lin"; totalPoints: number }
    | { scale: "dec" | "oct"; pointsPerInterval: number }
  );
```

所有数值在进入编译器前验证为有限数，并执行正值、方向、顺序、点数和资源上限检查。DC sweep 的 quantity 必须匹配 V/I source kind，step 符号必须能从 start 走向 stop；transient 的 `0 <= startS < stopS`、`stepS > 0` 且 `maxStepS` 若存在则为正；AC 要求 `0 < startHz < stopHz`，点数为正整数。

### 7.2 Engine acquisition and qualification

实施不得随意下载一个来源不明的 `ngspice.wasm`。第一个实现任务必须完成引擎资格验证：

1. 候选必须来自 ngspice 官方发布源码，或提供可核验上游源码、构建脚本和许可证的预编译发行物；
2. 固定 ngspice tag/commit、Emscripten 版本、构建参数、补丁、许可证和产物 SHA-256；
3. 提交可独立运行的最小资格 PoC：`vendor/ngspice/qualification/qualification.worker.ts`、四个固定网表、预期数值和浏览器测试；不能只提交一段人工操作说明；
4. 在 Chromium、Firefox 和 WebKit 各运行分压 DC、RC transient、二极管 DC sweep 和 RC low-pass AC 四个网表；
5. 验证单线程 Worker 初始化、取消后重建、重复运行、模型加载、虚拟文件系统清理、无业务网络请求和第 10.2 节资源上限；第一版不启用 WASM threads，也不要求 COOP/COEP；
6. 把选择结果写入 `vendor/ngspice/VERSION`、`SOURCE.md`、`BUILD.md`、`RESULT_TRANSPORT.json`、`QUALIFIED_VECTORS.json`、`SHA256SUMS` 和许可证目录。

产品代码只能依赖下列自有适配器边界，候选发行物的 Emscripten 符号和回调差异封闭在实现内部：

```ts
export type ResultTransport = "vector-callback" | "binary-rawfile";

export interface RuntimeLimits {
  maxWasmHeapBytes: number;
  maxVirtualFsBytes: number;
  maxLogBytes: number;
  maxResultPoints: number;
  maxSingleVectorBytes: number;
  maxRawResultBytes: number;
  maxSnapshotTransferBytes: number;
}

export interface AdapterResult {
  exitCode: number;
  vectors: Array<{
    name: string;
    axisName: string;
    real: Float64Array;
    imaginary?: Float64Array;
  }>;
  log: string[];
  resultTransport: ResultTransport;
  rawResultBytes: number;
  rawfileFsBytes: number;
  wasmHeapPeakBytes: number;
  virtualFsPeakBytes: number;
}

export interface NgspiceRuntimeAdapter {
  initialize(input: {
    wasmUrl: string;
    expectedResultTransport: ResultTransport;
    expectedModuleSha256: string;
    expectedWasmSha256: string;
    expectedVersion: string;
    expectedEngineBuildId: string;
  }): Promise<EngineMetadata>;
  runBatch(input: {
    netlistUtf8: Uint8Array;
    modelFiles: Array<{ generatedName: string; utf8: Uint8Array }>;
    requestedVectors: string[];
    limits: RuntimeLimits;
  }): Promise<AdapterResult>;
  dispose(): Promise<void>;
}
```

构建前的标准库校验器必须核对 `vendor/ngspice/ngspice.mjs`、WASM、`RESULT_TRANSPORT.json` 与 `QUALIFIED_VECTORS.json` 均匹配 `SHA256SUMS`；只有通过的 MJS 才由 Vite 静态打入 simulation Worker，发布中不再运行时加载一份独立 glue script。错误 MJS hash 使 qualification/production build 在任何浏览器执行前失败。资格门必须固定一种 `resultTransport` 并写入引擎 provenance/fingerprint，产品运行时不得在 callback 与 rawfile 间静默切换。callback 候选的 rawfile FS 预算恒为 0；只有候选确实不暴露合格 callback/API 时才允许固定 `binary-rawfile`，且其可证明的 header + axis + real/imaginary 数据上界在 Worker 创建前计入 32 MiB 虚拟 FS 门禁。

`QUALIFIED_VECTORS.json` 是编译器、适配器与 UI 共同消费的不可变能力矩阵，不是说明文字。唯一 schema/解析器是无 Node API 的 `client/src/simulation/qualified-vectors.mjs` 及其 `.d.mts` 类型；它使用 zod strict 对 `{ schemaVersion: 1, capabilities: [...] }` 校验。每个 capability 对应唯一 `(quantity, family, analysis)`：`branch-current` 的 family 为 `R|C|L|V|I|D|S`、方向固定 `p-to-n`；`device-power` 的 family 仅 `R|D`、符号固定 `absorbed`。数组按该三元组排序且不得重复。`rawNameTemplate` 的唯一语法是两段 0–64 字符的安全 ASCII literal 夹一个且仅一个 `{ref}`，不允许其他花括号；共享 resolver 先用项目 refdes schema 校验，再以规范小写 refdes 替换一次。缺失组合返回 `null`，不猜名。

Task 1 必须在三浏览器中逐项资格化 R/C/L/V/I/D 与 switch p→n 的拟支持组合；任何无法稳定读取或方向不一致的组合从矩阵和 UI 同时删除。Node 资产校验、Task 8 编译、Task 10 适配和 Task 15 探针选择必须 import 这同一 parser/resolver；任何一层都不得再实现第二份 family/analysis/raw-name/sign 表。

`initialize` 校验 Worker 内编译进来的 `moduleSha256` 常量等于请求 fingerprint，再以同源 URL 读取 WASM 字节、先计算 SHA-256，并把已校验 `wasmBinary` 交给该静态模块工厂，同时校验版本、固定 result transport 与 `engineBuildId`；禁止胶水代码再下载另一个 WASM。`runBatch` 在适配器内部生成不可由用户控制的运行目录，必须完成目录创建、模型/网表写入、batch run、向量回调或 rawfile 读取、返回码检查以及 `unlink/reset/destroy plot` 清理。每次运行后资格测试要证明目录为空且下一次结果不含上次 plot。适配器按唯一 raw axis/source/complex pair 监控 `rawResultBytes`；结果解析器在 `postMessage` 前按最终唯一轴及每个 probe/projection 监控 `snapshotTransferBytes`。两者分别受 64 MiB 限制，不能用 raw 去重后的较小数字替代真实快照传输。数值只来自合格 vector callback/API 或已固定的 binary rawfile；控制台文本只进入有上限的诊断日志，禁止从 `print` 文本提取电压、电流或通过状态。

若没有候选通过全部资格测试，实施必须停止在架构门禁，报告证据并由用户重新选择运行方式；不得静默改用自研求解器、云服务或主线程执行。

### 7.3 Worker protocol

主线程只通过可判别消息与 Worker 通信：

```ts
export interface EngineFingerprint {
  name: "ngspice";
  version: string;
  resultTransport: ResultTransport;
  moduleSha256: string;
  wasmSha256: string;
  engineBuildId: string;
}

export interface EngineMetadata extends EngineFingerprint {
  verifiedAt: string;
}

export type RunPhase =
  | "initializing"
  | "loading-models"
  | "running"
  | "parsing-results";

export interface SimulationRunRequest {
  appBuildId: string;
  runId: RunId;
  projectId: ProjectId;
  projectRevision: number;
  electricalRevision: number;
  analysisHash: string;
  requestedAssertionSetHash: string;
  analysis: AnalysisDefinition;
  corner?: AppliedCorner;
  compiled: CompileResult;
  models: Array<CompiledModelFile & { source: string }>;
}

export interface SimulationFailure {
  code: string;
  message: string;
  diagnostics: Diagnostic[];
  log: string[];
  retryable: boolean;
}

export type SimulationWorkerRequest =
  | { type: "initialize"; appBuildId: string; workerGeneration: number; requestId: string }
  | { type: "run"; appBuildId: string; workerGeneration: number; requestId: string; run: SimulationRunRequest };

export type SimulationWorkerEvent =
  | { type: "ready"; appBuildId: string; workerGeneration: number; requestId: string; engine: EngineMetadata }
  | {
      type: "initialization-failed";
      appBuildId: string;
      workerGeneration: number;
      requestId: string;
      error: SimulationFailure;
    }
  | {
      type: "progress";
      appBuildId: string;
      workerGeneration: number;
      requestId: string;
      runId: RunId;
      phase: RunPhase;
    }
  | {
      type: "completed";
      appBuildId: string;
      workerGeneration: number;
      requestId: string;
      runId: RunId;
      snapshot: SimulationSnapshot;
    }
  | {
      type: "run-failed";
      appBuildId: string;
      workerGeneration: number;
      requestId: string;
      runId: RunId;
      error: SimulationFailure;
    };
```

Worker 初始化时校验页面请求的 `appBuildId`、编译进 Worker 的 module SHA-256、运行时 WASM SHA-256 和引擎版本。一次只运行一个任务；第一版不实现并行队列，也不发送无法保证被同步 WASM 处理的“软取消”消息。初始化阶段以 `{ appBuildId, workerGeneration, requestId }` 二元关联（除共同 build 字段外）匹配 `ready/initialization-failed`；运行阶段维护唯一活动三元组 `{ workerGeneration, requestId, runId }` 并同时要求 `appBuildId` 匹配。只有对应字段与活动值完全一致时，才允许更新 UI 或持久化；旧 build、旧 generation、旧 request、旧 run 或已终结事件一律忽略。`run.corner` 必须等于 `compiled.appliedCorner`，`run.models` 的 ID/hash/generatedName 必须逐项等于 `compiled.modelManifest`；不一致在写 FS 前失败。

每个 controller 在持久化 `running` 前必须取得 `navigator.locks` 的 exclusive `fluxlab-run:<runId>` 锁，并持有到 Worker 终止且终态事务完成；Task 1 必须在三个目标浏览器资格化 Web Locks。另一标签页启动恢复时只对 `ifAvailable` 能取得该锁的候选执行 orphan 修复；取不到表示仍有 owner，保持 running 并显示“另一标签页活动”，不能抢先写 `RUN_INTERRUPTED`。如果任一目标浏览器没有该原生能力，实施停在资格门并重新决定明确的单标签策略，不能用时间戳 lease 猜测存活。

取消或超时时，主线程先以一次不可分割状态转换把活动 run 标记为 `cancelled` 或 `timeout`、清空活动三元组并递增 generation，然后移除监听器、终止旧 Worker、写入终态 `RunRecord`，最后释放 run lock 并创建新 Worker。即使旧 Worker 已排队的 `completed` 随后到达，也因 generation 不匹配而不能覆盖新结果。重复终态事件不得创建第二条运行记录。该竞态用“取消 A、启动 B、延迟注入 A.completed”的确定性测试验收。

适配器每次运行在 Emscripten 虚拟文件系统中创建仅含生成文件名的运行目录，写入已验证模型，结束后清理；用户文件名不直接成为虚拟路径。数值优先通过 libngspice vector callback/API 读取；若选定构建不暴露该 API，则读取固定格式 rawfile。禁止从面向人的控制台文本猜测波形数值。

### 7.4 Result snapshot

```ts
export type AxisUnit = "s" | "Hz" | "V" | "A" | "index";
export type ResultUnit = "V" | "A" | "dB" | "deg" | "W" | "dimensionless";
export type ResultQuantity = "voltage" | "current" | "power";
export type ResultProjection = "scalar" | "real" | "imaginary" | "magnitude" | "phase" | "db20";

export interface ResultAxis {
  id: string;
  analysisId: AnalysisId;
  label: string;
  unit: AxisUnit;
  values: Float64Array;
}

export interface ResultVector {
  id: VectorId;
  probeId: ProbeId;
  analysisId: AnalysisId;
  quantity: ResultQuantity;
  projection: ResultProjection;
  sourceVectorName: string;
  label: string;
  unit: ResultUnit;
  axisId: string;
  values: Float64Array;
}

export interface SimulationSnapshot {
  schemaVersion: 1;
  appBuildId: string;
  runId: RunId;
  projectId: ProjectId;
  projectRevision: number;
  electricalRevision: number;
  analysisId: AnalysisId;
  analysis: AnalysisDefinition;
  analysisHash: string;
  netlistHash: string;
  vectorPlan: CompiledVectorRequest[];
  vectorPlanHash: string;
  engine: EngineMetadata;
  modelManifest: CompiledModelFile[];
  startedAt: string;
  finishedAt: string;
  axes: ResultAxis[];
  vectors: ResultVector[];
  diagnostics: Diagnostic[];
  log: string[];
}

export interface RunRecordBase {
  schemaVersion: 1;
  appBuildId: string;
  runId: RunId;
  projectId: ProjectId;
  projectRevision: number;
  electricalRevision: number;
  analysisId: AnalysisId;
  analysis: AnalysisDefinition;
  analysisHash: string;
  requestedAssertions: AssertionDefinition[];
  requestedAssertionSetHash: string;
  netlistHash: string;
  vectorPlan: CompiledVectorRequest[];
  vectorPlanHash: string;
  requestedEngine: EngineFingerprint;
  modelManifest: CompiledModelFile[];
  inputBundle: {
    netlist: string;
    models: Array<CompiledModelFile & { source: string }>;
    sourceMap: NetlistSourceMap;
  };
  corner?: AppliedCorner;
  startedAt: string;
  preflightDiagnostics: Array<{
    phase: "schema" | "model" | "graph" | "erc" | "compile" | "resource";
    diagnostic: Diagnostic;
  }>;
}

export type RunRecord = RunRecordBase &
  (
    | { status: "running"; verifiedEngine?: EngineMetadata }
    | {
        status: "success";
        finishedAt: string;
        snapshot: SimulationSnapshot;
        assertionEvaluations: AssertionEvaluation[];
      }
    | {
        status: "failed";
        finishedAt: string;
        verifiedEngine?: EngineMetadata;
        failure: SimulationFailure;
      }
    | { status: "cancelled"; finishedAt: string; reason: "user" | "project-changed" }
    | { status: "timeout"; finishedAt: string; limitMs: number }
  );

export type SuccessfulRunRecord = Extract<RunRecord, { status: "success" }>;
```

`SimulationSnapshot` 只表示成功数值结果；失败、取消和超时没有空快照，统一由终态 `RunRecord` 表示。schema/ERC/纯函数编译先完成；它们失败时显示项目诊断，不宣称已启动仿真。编译成功后，主线程已经知道 netlist/model hashes 和仓库内的 `requestedEngine`，此时才持久化 `running` 并初始化/调用 Worker。WASM 验证成功后填 `verifiedEngine`；初始化失败可以形成没有 `verifiedEngine` 的合法 failed 记录。成功时在一次事务中附加数值快照和当前断言求值；失败、取消或超时改写为对应终态。应用启动时发现遗留 `running` 记录，必须转为 `failed/RUN_INTERRUPTED`，不得继续显示运行中或通过。

成功记录的数值核心不可变。成功记录必须满足外层与快照的 `appBuildId/runId/projectId/revisions/analysis/analysisId/analysisHash/netlistHash/vectorPlan/vectorPlanHash/modelManifest/times` 完全一致，快照引擎 fingerprint 必须等于 `requestedEngine`，corner 必须等于编译/请求 corner；running/success 不得含 `blocksRun` 的 preflight 诊断。`vectorPlan` 使用编译器规范顺序，`vectorPlanHash = SHA-256(canonicalJson(vectorPlan))` 的完整小写十六进制；加载时按该 plan 要求每个轴/向量及其 probe/quantity/projection/source name 一一对应，不允许缺项或额外项。`inputBundle.netlist` 必须重算为 `netlistHash`，模型 source 必须逐项重算并等于 manifest，`sourceMap` 的行号必须落在该网表且组件/端点来自当时捕获；engine 行诊断只通过这份 source map 链回当时元件。`preflightDiagnostics` 带固定 phase 保存所有 schema/model/graph/ERC/compiler/resource 非阻断警告；`snapshot.diagnostics` 只保存 result/engine 阶段警告，二者不混名。这份有大小上限的实际输入使终态运行即使在项目后来改变后仍可审计和复现，不依赖历史项目修订仍存在。失败记录保留受 1 MiB 上限约束的引擎日志。`requestedAssertions` 只保存按下 Run 时捕获、`enabled && analysisId === run.analysisId` 且按 ID 排序的完整集合，所有定义必须匹配该分析，并重算为 `requestedAssertionSetHash`；运行中随后发生的断言编辑不能改变它。首次成功只用这份捕获生成原子附加的求值。之后用户只改同一分析的断言时，不篡改快照或旧结果，而是在同一成功记录的 `assertionEvaluations` 追加一个新 `AssertionEvaluation`。追加必须是事务性和去重的，门禁只选择与该分析当前 `assertionSetHash` 完全匹配的求值；其他分析的断言变化不使本运行求值失效。

向量 ID 规则固定为 `vector:v1:` 加 `SHA-256(canonicalJson([analysisId, probeId, quantity, projection]))` 的完整小写十六进制。轴 ID 同理使用 `[analysisId, axis unit, analysis kind]`。加载结果时重新计算 ID，并校验 probe、analysis、quantity、projection、单位和轴引用；任一不一致都把运行标为损坏。相同 probe 在 AC 中可以产生 `magnitude/db20/phase` 等多个明确投影，断言不能只靠易变标签查找向量。

DC operating point 与其他分析一样只保存 enabled probes 对应的显式 scalar `ResultVector`，不暗中抓取未估算的全节点/全器件 plot，也不维护另一份 operating-point map。大向量使用可转移 `ArrayBuffer` 从 Worker 返回，IndexedDB 用 structured clone 保存。Worker 在发送 `completed` 前计算 `snapshotTransferBytes = Σ(unique axes.values.byteLength) + Σ(each ResultVector.values.byteLength)`；不同 probe 或 projection 即使来自同一个 raw source 也分别计费，transfer list 中每个实际 `ArrayBuffer` 只能出现一次。`resultPoints` 同样按最终保存的轴与每个结果向量逐项计数，而不是按 adapter raw 名去重。超限产生 `RESOURCE_SNAPSHOT_TRANSFER` 并终止该 generation，绝不发送部分快照。

所有轴以及非 `db20` 投影必须有限；`db20` 唯一允许的非有限值是表示零幅值的负无穷，仍拒绝 `NaN/+Infinity`，并且所有数组都必须与轴等长。Bode 图可把负无穷裁到视窗下沿绘制，但标签/表格仍显示 `−∞`，存储、导出和测量层禁止把它夹成有限值；普通测量遇到它返回 error，`bandwidth3dB` 的基线或插值段含它时返回前置条件 error。UI 不保存另一个“简化结果”；格式化单位和派生测量必须引用快照向量及表达式。仪器、课程、断言、导出和报告的输入类型必须是 `SuccessfulRunRecord`，禁止只传裸 `SimulationSnapshot`；因此 corner、请求时断言集合和外层运行状态不会在投影中丢失。

`sourceMap` 的“组件/端点来自当时捕获”只在创建 RunRecord 时对仍在内存的项目校验。独立加载或 `.fluxrun` 导入不假装拥有可能已不存在的历史项目，而是校验 safe ID/pin、网表行界、`lineToComponent↔componentToLines` 与 `endpointToNode↔nodeToEndpoints` 的双向内部一致性；任何漂移使记录损坏。

### 7.5 Staleness

以下变化使运行过期：

- 电气元件、参数、引脚或导线变化；
- 模型文本或引用变化；
- 分析配置或探针变化；
- 引擎版本变化。

数值快照新鲜度的完整键为 `appBuildId + projectId + electricalRevision + analysisHash + netlistHash + vectorPlanHash + sorted(modelId, sha256) + engine(name, version, resultTransport, moduleSha256, wasmSha256, engineBuildId) + corner(definitionHash, appliedOverridesHash)`。`netlistHash/vectorPlanHash` 必须由当前 app 对当前项目、分析和角点重新执行同一 graph/compiler preflight 得到，不能因为修订号相等就沿用记录里的值。只移动元件、缩放画布或修改纯文字笔记会增加项目 `revision`，但不增加 `electricalRevision`，因此在同一 app build 内不使数值结果过期。任一 app 升级会把旧运行保守地标为历史，覆盖编译器、结果投影、测量或断言算法修复而引擎未变的情况。只修改断言也不要求重跑 ngspice，但旧 `AssertionEvaluation` 因 `assertionSetHash` 不同而失效，必须基于仍新鲜的快照追加一次新求值后门禁才能恢复。过期快照可用于历史比较，但不得驱动当前“通过”状态。

## 8. Instruments and Verification

### 8.1 Probes

```ts
export type ProbeDefinition =
  | { id: ProbeId; kind: "node-voltage"; node: WireEndpoint; label: string }
  | { id: ProbeId; kind: "differential-voltage"; positive: WireEndpoint; negative: WireEndpoint; label: string }
  | { id: ProbeId; kind: "branch-current"; componentId: ComponentId; label: string }
  | { id: ProbeId; kind: "device-power"; componentId: ComponentId; label: string };
```

示波器、Bode 图和数值表格只是 `ResultVector` 的不同投影。图表不得生成或补造波形。第一版 branch current 仅支持可确定的 R/C/L/V/I/D 与 switch p→n，Q/M/X 返回歧义诊断。`device-power` 的资格化 allowlist 恰为 R 和 D 的真实 `@ref[p]` 向量，且仅用于 dc-op、DC sweep、transient；AC power、X 及其他 family 返回 `PROBE_UNSUPPORTED_DEVICE_POWER`。Bode 只接受 voltage/current 投影，绝不对功率套 `20log10`。

### 8.2 Assertions

```ts
export type MeasurementUnit = AxisUnit | ResultUnit;

export interface QuantityValue {
  value: number;
  unit: MeasurementUnit;
}

export type MeasurementExpression =
  | { function: "valueAt"; vectorId: VectorId; at: QuantityValue }
  | { function: "min" | "max" | "mean"; vectorId: VectorId }
  | {
      function: "crossingTime";
      vectorId: VectorId;
      threshold: QuantityValue;
      edge: "rising" | "falling";
    }
  | { function: "bandwidth3dB"; vectorId: VectorId };

export type AssertionComparator =
  | { kind: "lt" | "lte" | "gt" | "gte"; expected: QuantityValue }
  | { kind: "between"; minimum: QuantityValue; maximum: QuantityValue; inclusive: true }
  | {
      kind: "near";
      expected: QuantityValue;
      absoluteTolerance?: QuantityValue;
      relativeTolerance?: number;
    };

export interface AssertionDefinition {
  id: string;
  name: string;
  enabled: boolean;
  analysisId: AnalysisId;
  expression: MeasurementExpression;
  comparator: AssertionComparator;
}

export interface AssertionResult {
  id: string;
  assertionId: string;
  assertionDefinitionHash: string;
  assertionSetHash: string;
  runId: RunId;
  projectRevision: number;
  electricalRevision: number;
  status: "passed" | "failed" | "error";
  actual?: QuantityValue;
  diagnostics: Diagnostic[];
}

export interface AssertionEvaluation {
  id: string;
  runId: RunId;
  projectRevision: number;
  electricalRevision: number;
  assertionSetHash: string;
  evaluatedAt: string;
  definitions: AssertionDefinition[];
  results: AssertionResult[];
}
```

表达式第一版只支持上述受控联合类型，不用 `eval`、字符串公式或任意 JavaScript。定义以下唯一求值语义：

- 先按确定性 `vectorId` 查找向量，并验证 `analysisId`、轴引用、等长数组、非空、有限数和严格递增轴；任何失败产生 `AssertionResult.status = "error"`，门禁为 blocked。
- `valueAt` 在精确轴值上返回对应值，在两个相邻点之间做线性插值；超出闭区间、重复轴值或缺点时返回 `MEAS_OUT_OF_RANGE/MEAS_BAD_AXIS`，不夹取、不外推。
- `min/max/mean` 对完整向量求值；空向量、`NaN` 或任何无穷大（包括合法存储的 `db20 = -Infinity`）是错误，`mean` 是普通算术平均。
- `crossingTime` 仅接受单位为 `s` 的轴和与向量同单位的阈值；按时间正序寻找第一个“前一点严格位于阈值一侧、后一点达到或越过阈值”的指定上升/下降边沿，并线性插值。无交点或整段贴阈值是错误，不返回 `0`。
- `bandwidth3dB` 仅接受 AC 分析、正且递增的 `Hz` 轴、`projection = "db20"` 且至少两个点的向量。参考电平固定为首点，目标为首点减 `3.01029995664 dB`，取首个下降交点；`dec/oct` 在 `log10(Hz)` 上插值，`lin` 在线性 Hz 上插值。首点非有限、首段先上升超过 0.1 dB 或不存在下降交点时返回前置条件错误；它不是任意带通带宽算法。
- 项目中数值已归一到规范单位，表达式输入、阈值、比较期望和绝对容差必须与结果维度兼容；`dB`、线性 magnitude、degree 不互换。`between` 固定含上下边界且要求 `minimum <= maximum`。`lt/lte/gt/gte` 使用其字面边界。
- `near` 至少提供一个严格为正的容差；通过条件为 `abs(actual - expected) <= max(absoluteTolerance, relativeTolerance * abs(expected))`，缺失项按零处理。相对容差必须在 `0..1`；当 expected 为零时必须给绝对容差。单位或容差配置错误使断言为 error，而不是 failed。

`assertionDefinitionHash` 固定为 `SHA-256(canonicalJson(definition))` 的完整小写十六进制。`assertionSetHash` 固定为 `SHA-256(canonicalJson(definitions))` 的完整小写十六进制，其中 `definitions` 只含同一 analysis 下 enabled 项并按 `id` 升序；空集是 `canonicalJson([])` 的哈希。`AssertionResult.id` 固定为 `assertion-result:v1:` 加 `SHA-256(canonicalJson([runId, assertionSetHash, assertionId, assertionDefinitionHash]))`；`AssertionEvaluation.id` 固定为 `assertion-evaluation:v1:` 加 `SHA-256(canonicalJson([runId, assertionSetHash]))`，相同集合不得重复追加。`definitions` 保存当时属于该 run `analysisId`、enabled 且按 ID 排序的完整定义；加载时按上述唯一公式重算集合/单项哈希，并要求 results 一一对应，因此项目后来改阈值也不会抹掉“当时通过了什么”。初始求值哈希必须等于 `RunRecord.requestedAssertionSetHash`。断言正常求值但不满足比较器是 `failed`；输入损坏、单位不兼容或前置条件不满足是 `error`。两者都不能通过交付门禁，但 UI 必须区分“设计未达标”和“证据无法求值”。

### 8.3 Corners and delivery gates

角点是对当前项目的显式、非破坏性变体：

```ts
export type CornerParameterPath =
  | "resistanceOhm"
  | "capacitanceF"
  | "inductanceH"
  | "dcV"
  | "dcA"
  | "area"
  | "lengthM"
  | "widthM"
  | "multiplicity"
  | `parameterOverrides.${string}`;

export type CornerOverride =
  | {
      kind: "component-parameter";
      componentId: ComponentId;
      path: CornerParameterPath;
      value: number;
    }
  | { kind: "component-model"; componentId: ComponentId; modelRef: ModelId };

export interface CornerDefinition {
  id: CornerId;
  name: string;
  enabled: boolean;
  overrides: CornerOverride[];
}

export interface AppliedCorner {
  cornerId: CornerId;
  name: string;
  definitionHash: string;
  appliedOverridesHash: string;
  ordinal: number;
  total: number;
}
```

第一版只允许上面列出的标量和模型替换，不允许角点注入表达式或任意 JSON path。覆盖路径必须适用于目标元件，subcircuit 参数名必须出现在接口声明中，替换模型必须兼容器件族，同一角点不能重复覆盖同一目标。应用覆盖后重新执行完整 schema/ERC/资源估计；它不修改已保存项目，仍使用同一 `electricalRevision`，但 `definitionHash/appliedOverridesHash` 进入运行新鲜度键。每个启用角点生成独立 `RunRecord` 和成功快照。第一版按项目中稳定 ID 顺序运行，取消即终止当前 Worker 并把未开始角点保持为“未运行”，不伪造 cancelled 记录。

交付门禁输入必须是：

- 当前项目 ID 和 `electricalRevision`；
- 当前 analysis、model、engine、corner 和启用断言集合的哈希；
- nominal 与所有启用角点所要求分析的成功 `RunRecord`；
- ERC 结果；
- `assertionSetHash` 匹配的所有启用断言结果；
- 未解决的阻断诊断。

门禁状态只有 `passed | failed | blocked`：目标 analysis 至少需要一个 enabled assertion，全部证据存在、新鲜、可求值且断言通过时才是 passed；空集合以 `GATE_NO_ENABLED_ASSERTIONS` blocked，不能真空通过。证据完整但至少一个断言正常求值为 failed 时是 failed；运行缺失/失败/取消/超时、快照过期、ERC 阻断、断言 error 或哈希不匹配时是 blocked。`AssertionDefinition.enabled = false` 的项不进入 `assertionSetHash` 和门禁，但仍保存在项目中。不存在默认 `passed: true`，也不能用上次成功运行填补当前角点。

## 9. Persistence and Offline Behavior

### 9.1 Storage

使用浏览器原生 IndexedDB，不增加状态数据库框架。持久化大对象与列表元数据明确分离：

```ts
export interface StoredProjectEnvelope {
  envelopeVersion: 1;
  storageVersion: number;
  project: CircuitProjectV2;
  listKey: readonly [updatedAt: string, projectId: ProjectId, title: string, revision: number];
  revisionKey: readonly [projectId: ProjectId, revision: number, electricalRevision: number];
}

export interface StoredRunSequence {
  envelopeVersion: 1;
  projectId: ProjectId;
  nextAttempt: number;
  storageVersion: number;
}

export interface StoredRunEnvelope {
  envelopeVersion: 1;
  storageVersion: number;
  localAttempt: number;
  immutableBaseHash: string;
  record: RunRecord;
  listKey: readonly [
    projectId: ProjectId,
    localAttempt: number,
    startedAt: string,
    analysisId: AnalysisId,
    status: RunRecord["status"],
    cornerKey: string,
    runId: RunId,
  ];
}

export interface StoredLearningEvidenceEnvelope {
  envelopeVersion: 1;
  storageVersion: number;
  evidence: LearningEvidence;
  lessonKey: readonly [lessonId: string, projectId: ProjectId];
  projectKey: readonly [projectId: ProjectId, lessonId: string];
  referencedRunIds: RunId[];
}

export interface LocalSettingsV1 {
  schemaVersion: 1;
  theme: "system" | "light" | "dark";
  reducedMotion: "system" | "reduce";
  defaultView: "guided" | "standard" | "expert";
}

export type StoredSettingValue =
  | { kind: "local-settings"; settings: LocalSettingsV1 }
  | { kind: "lesson-session"; lessonId: string; projectId: ProjectId; templateKey: "divider" | "led" | "rc" | "engineering-review" }
  | { kind: "last-opened-project"; projectId: ProjectId }
  | { kind: "legacy-notice"; path: "/divider" | "/led" | "/engineering" | "/engineering/ops"; acknowledged: true };

export interface StoredSettingEnvelope {
  envelopeVersion: 1;
  storageVersion: number;
  key: string;
  projectKey?: readonly [projectId: ProjectId, key: string];
  value: StoredSettingValue;
}
```

`client/src/storage/indexeddb.ts` 是以上五个 object store 的唯一访问与跨 store 事务所有者；功能组件不得直接打开 `fluxlab`、读写 raw envelope 或另建删除事务。它独占 `parseStoredSettingEnvelope`、`deriveSettingKey`、`deriveSettingProjectKey`，以及 Task 17 加入的 `parseStoredLearningEvidenceEnvelope`、`deriveLearningEvidenceEnvelope`。四类 setting 的唯一主键分别是 `local-settings`、`lesson-session:<lessonId>`、`last-opened-project`、`legacy-notice:<path>`；只有 lesson-session 与 last-opened-project 具有 `projectKey = [projectId, key]`。parser 必须在 zod strict 结构校验后重新派生并交叉核对 `key`、`projectKey`、kind 与 payload；缺失、多余或漂移都使整行无效。学习 envelope 同样重新派生 `lessonKey = [lessonId, projectId]`、`projectKey = [projectId, lessonId]` 和按字典序排序去重的 `referencedRunIds = steps[].runId`，不得信任落盘索引字段。

所有调用者只使用 `put/load/delete/listLearningEvidence`、`save/loadLessonSession`、`save/loadLastOpenedProject`、`acknowledge/hasAcknowledgedLegacyNotice`、`save/loadLocalSettings` 等专用 API；这些 API 复用上述 parser/deriver，禁止暴露通用 `getSetting/putSetting`。`deleteProject(projectId)` 是唯一项目级联删除入口，并在一个原子事务内删除 project、sequence、runs、lesson evidence 及带相同 `projectKey` 的内部导航记录；后续任务只能扩展它的覆盖测试，不能再实现第二个 cascade helper。

`projects` 以 project ID 为主键并以 `listKey`、`revisionKey` 建 compound index；`runSequences` 是独立小 store，保存 project ID → `StoredRunSequence`；`runs` 以 run ID 为主键，按 `listKey` 建 project/attempt index，并另建 status index。`lessonEvidence` 以 `lessonKey` 为主键，并建立 `lessonKey`、`projectKey` 与 multi-entry `referencedRunIds` 索引；后两者分别关闭按项目级联删除和运行引用检查的全表扫描。`settings` 以 `key` 为主键并对存在的 `projectKey` 建索引；它只允许上面四种严格判别记录，学习证据和运行结果绝不塞入这里。`localAttempt` 是某项目内由存储单调分配的运行尝试序号，不进入可导出的 `RunRecord`。sequence 从 1 开始，分配当前值后恰好加 1；所有字段必须是正 safe integer，溢出在任何写入前失败。`createRunningRun` 在横跨 `projects+runSequences+runs` 的一个短事务中，用 `projects.revisionKey` 的 `openKeyCursor` 确认请求仍属于当前 project/electrical revision（不得 `get` 15 MiB project），读取并增加小 sequence，再 `add` 运行 envelope。门禁“最新尝试”、历史排序与保留裁剪使用 `localAttempt`，不依赖可能相同或回拨的客户端时间。项目创建/删除在同一事务创建/删除其 sequence；运行分配绝不为更新 counter 而 structured-clone 或重写大项目 envelope。

所有 envelope 的派生 key、`referencedRunIds` 与内容都由 schema 交叉验证；保存、状态转换和删除在同一事务维护 envelope 与索引，key 漂移使整行无效。项目列表通过 compound index 的 `openKeyCursor` 直接从 index key 生成 `ProjectSummary`，运行列表同样生成 `RunSummary`，不得调用 object-store `get/getAll` 克隆最多 15 MiB 项目或 64 MiB 波形；只有打开具体项目/运行时才 `get` 并完整解析。学习目录通过 `lessonKey` 有界 cursor 查跨项目证据，逐条完成 schema 与 lesson-step 完整性验证；坏记录只产生诊断，绝不解锁 prerequisite。按项目删除使用 `projectKey` 的 key cursor；运行保留/删除先查询 `referencedRunIds`，命中坏 envelope 时保守阻断而不是删掉可能仍被引用的证据。

任何需要 zod 后置 refinement、canonical hash 或 Web Crypto 的存储操作都使用两阶段协议：先完成 readonly 读取并让事务结束，再在事务外异步完整验证 current/candidate、构造新 envelope；最后打开短 `readwrite` 事务，重新读取当前 envelope，只做同步 CAS（`storageVersion`、状态、`localAttempt`、`immutableBaseHash` 和必要的项目修订字段）、`put/add` 或 `abort`，并只在 `transaction.oncomplete` 后报告成功。活跃 IndexedDB 事务内禁止 `await` 非 IDB 工作、Web Crypto 或异步 schema refinement。`finishRun`、追加断言求值和启动恢复都遵守这一协议；恢复先在 readonly 事务中收集 running 原始候选，事务结束后逐条验证/构造，只在取得对应 `fluxlab-run:<runId>` orphan lock 后为每项执行独立 CAS，避免 `TransactionInactiveError`、半恢复和跨标签误杀。

同一 workspace 的项目保存进入 project-scoped 串行 lane：只保留尚未开始写入的最新 revision，可以从已持久化 rev1 直接保存 coalesced rev3；正在保存的 rev2 完成时若 UI 已在 rev3，仍显示 dirty/saving，不能把新状态标成“已保存”。每次写入用已持久化 revision 作 CAS 预期值，冲突或失败停止该 lane、保留内存中的最新 dirty 项目并显示可恢复诊断，绝不让旧完成回写覆盖新 revision。

项目和运行终态写入失败必须保持上一修订或上一运行状态可读。应用启动时先读 key-only 元数据列表，再按需加载项目和波形；运行保留策略只能删除完整 envelope，不能留下仍被课程证据或交付报告引用的孤儿 ID；被引用运行先要求用户删除对应证据或导出归档。确认删除项目时，一个事务用 key cursor 删除该项目、sequence、全部运行、课程证据及指向它的内部导航记录；取消或任一错误均不留下半删除状态。大 payload 浏览器测试必须证明项目/运行列表路径的 object-store `get/getAll` 调用为零，并覆盖 15 MiB 项目与接近 64 MiB 快照。

用户可编辑的首版偏好只有 `LocalSettingsV1` 的 theme、reduced-motion 和 default-view；其余 setting record 只是经过 schema 验证的课程恢复/旧路由导航指针，不得出现在设置表单中，也不能表达完成证据。`system` motion 始终服从 `prefers-reduced-motion`，产品不提供强制覆盖系统减弱动效的选项。设置页还只读展示当前 app/engine/module/WASM 身份、online/offline 与 Service Worker 状态，以及 `navigator.storage.estimate()`/`persisted()` 的真实结果；若浏览器不支持则明确显示 unsupported，不能放置无行为的假控件。

### 9.2 Files

- `.fluxproj.json`：项目、电路、模型、分析、探针、断言和笔记；默认不含大波形。
- `.fluxrun.json`：一个终态运行的 `full` 无损证据 envelope，或明确不可采用/不可驱动门禁的 `omitted` reference-only envelope；第一版没有第三种抽样向量模式。不能把 failed/cancelled/timeout 导出成成功快照。
- `.cir`：受控 SPICE 网表导入导出。
- `.csv`：选择的结果向量。

导入先解析到候选对象、完整校验、显示摘要，再由用户明确采用。`.fluxproj.json` 内嵌的每段模型文本也必须走第 10.2 节安全入口，不能因为外层 JSON 通过 schema 就信任 `source`。不能像当前 LED 页面一样仅检查是否存在某种元件。

`.cir` 只消费统一 parser 已产生的 discriminated AST，禁止二次 split/regex/tokenize。位于 `.subckt/.ends` 深度内的 element/parameter/model 语句只形成一个经过 `opaque-model` 复验的 `ModelDefinition` bundle 及其 `SubcircuitInterface`，不展开为顶层画布元件、导线或节点；只有顶层 X instance 成为 `subcircuit` 元件。首版 bundle 必须自包含其内部引用；无法无歧义封装的外部 model/subcircuit 依赖整次以行号拒绝，不能复制定义造成 last-definition-wins。

分析指令按顶层源顺序一对一转换：零条产生 `analyses: []` 并在 preview 明示“需先新增分析”；一条或多条 `.op/.dc/.tran/.ac` 各生成独立、带 ordinal 的稳定 analysis ID，不能只取第一条或把多条交给一次产品 run。`.dc` 必须解析到同一导入候选中的匹配 V/I source。空源或只有 AC 且未写 DC 的 V/I 可等价规范为显式 `0 V/0 A`；只要存在 PULSE/SIN/PWL 且未写 DC，就保持 `dcV/dcA` 缺省并让编译器省略 DC token，以保留 ngspice 的 waveform time-zero 工作点语义。D/Q 未写 area 时为 `1`；顶层 Q 若带第四 substrate node 因 v1 领域只有 c/b/e 必须明确拒绝，不能丢掉该节点；M 必须显式提供正的 L/W，未写 multiplicity 时为 `1`。这些是唯一默认值，其他缺失参数不得猜测。

SPICE node 只把原始 token `0` 映射为项目地；原始 `GND` 在 SPICE 中不等于 0，必须作为普通非地节点保留。对每个非地 token 先按 SPICE 大小写语义规范为大写：若它匹配项目 net-label regex、不是 `GND` 且不以保留前缀 `SPICE_` 开头，就直接使用；否则使用 `SPICE_` + `SHA-256(UTF-8(canonical raw token))` 的 64 位小写十六进制。导入器保存并显示 raw→project label 摘要，检测理论 hash/规范名碰撞并拒绝，因而数字、dot/hyphen node 永远不会作为不安全项目键落盘。

至少一个固定集成夹具必须走完整的“安全 `.cir` AST → 候选项目 → compileNetlist → 真实已资格化 ngspice Worker”路线，并与同一原始夹具的资格化直接运行逐轴/逐向量比较；覆盖 numeric node、空/AC-only V/I 的 0 默认、PULSE initial≠0 且无显式 DC 的 time-zero 工作点、D/Q area=1、M 的 L/W 与 multiplicity=1、self-contained subcircuit、零分析和多分析。只做 JSON round trip 或纯编译字符串比较不能批准 `.cir` 等价性。

这些 SHA-256、canonical JSON 和交叉字段只证明本地记录可追踪且内部自洽，不是数字签名、防篡改认证或第三方法律签核。本地用户能够修改 IndexedDB/JSON 并重新计算哈希；第一版不引入账号、私钥、远程证明或签名服务，因此 `.fluxrun` 只能作为可复现实验包，不能被 UI 宣称为不可伪造证书。

### 9.3 Offline installation

`vite.config.ts` 使用 `vite-plugin-pwa` 的 `generateSW`/prompt 模式；`client/src/app/register-service-worker.ts` 负责注册，并由 `client/src/main.tsx` 调用。`injectRegister` 关闭，避免存在第二个隐式注册点。预缓存清单明确包含内容哈希后的应用壳、路由 chunks、已静态包含校验后 ngspice glue 的 simulation Worker、独立 WASM、内置模型、课程模板和 manifest；不发布或运行时导入第二份 MJS。用户项目与运行只在 IndexedDB，不进入 Cache Storage。

应用发布定义独立的 `appBuildId`；它由 HTML/main、Worker 握手、Service Worker 和缓存名共同携带。引擎的 `engineBuildId` 来自 `vendor/ngspice/VERSION`，只在引擎产物改变时变化。缓存 `cacheId` 同时包含 `appBuildId` 与 `engineBuildId`，运行请求必须匹配当前页面/Worker 的 `appBuildId`，Worker 返回的 `EngineMetadata` 必须匹配预缓存的 `engineBuildId`、构建时 module hash 与运行时 WASM hash；UI-only 发布不得伪造新的引擎构建 ID。Service Worker 设置 `skipWaiting = false`、`clientsClaim = false`：新版本完整下载后保持 waiting，界面只提示“保存并关闭所有 FLUXLAB 标签页后重新打开”，不得在仍运行的项目页面上调用 `skipWaiting` 做热切换。所有旧 client 关闭后浏览器才激活新 worker；激活成功后再清理旧 build 缓存。安装中任一必需资产缺失则安装失败，旧 active worker 和旧缓存继续服务，不能形成新 UI + 旧 Worker/WASM 的混合版本。

构建身份有三个互斥 purpose。普通任务验证使用 `verification`，其 `appBuildId = verify-<64 lowercase SHA-256 of the sorted build-input tree>` 且产物显式携带 `nonReleaseBuild: true`；PWA 原子更新夹具只允许 `pwa-v1|pwa-v2` 并写到测试目录；正式发布只允许 `release`，其 ID 必须是 `git-<40 lowercase releaseSourceCommit>` 且工作树/HEAD 门禁通过。目的缺失时只可默认为 verification；verification/fixture 产物必须被发布清单生成器拒绝。这样实施任务可在提交前运行真实构建，又不能把测试身份伪装成可发布提交。

验收包含两个版本交叉测试：V1 打开时发布 V2，V1 页面在关闭前仍只使用 V1 Worker/WASM；关闭全部标签后离线重开才整体进入 V2。基础离线验收为首次在线加载成功后，关闭页面、禁用网络、重新打开，10 秒内载入项目并完成 RC 瞬态夹具。

仿真过程中不访问 CDN、Forge、分析服务或远程模型地址。

### 9.4 Static hosting contract

V1 只支持域名根路径部署。正式主机必须在 HTTPS 下把 `/`、`/project/*`、`/learn/*`、`/settings` 与过渡旧路由的 **navigation** 请求重写到 `index.html`；`.js/.mjs/.wasm/.css/.json`、图片、字体和 `/assets/*` 缺失时必须返回真实 404，不能返回 HTML。WASM MIME 为 `application/wasm`；JS/MJS/SW 为 JavaScript MIME。`index.html`、`sw.js`、`manifest.webmanifest` 和 `release-manifest.json` 必须使用 `Cache-Control: no-cache`；内容哈希资产使用 `public,max-age=31536000,immutable`。

`release-manifest.json` 不自哈希。写入它之前，唯一的 Node 标准库目录枚举器递归遍历 `dist/public`，拒绝 symlink、非普通文件、不安全或重复相对路径，并按 slash-normalized 路径排序生成 `deliveryFiles: Array<{ path, size, sha256 }>`；唯一排除项是 manifest 自身。远端验证使用 `cache: "no-store"` 和随机 cache-busting query，先要求远端 manifest 原始字节 SHA-256 等于本地文件，再逐项获取并核对清单中每个文件的大小与 SHA-256。不存在可以漏掉 Web Manifest、图标、Workbox、课程、模型或许可清单的“核心资产”子集。

manifest 写入后，同一枚举器对包含 manifest 的完整目录生成确定清单和树哈希：扫描前记录 `H_before`，对最终目录运行 gitleaks，扫描后重算 `H_after`，两份清单和哈希必须完全相同才能生成 post-manifest 证据；部署后的 external 阶段还要先证明本地树仍等于该证据。本地 RC 与远端主机的 Playwright 模式由显式枚举选择，不得因环境中偶然存在旧 URL 而切换目标。远端静态验证和真实浏览器分压运行各产生一份绑定同一 `releaseRunId`、manifest 原始哈希、build/engine 身份和 URL 的结构化证据；任一缺失或失败时不得冻结用户研究实例。最低安全头为本设计资格化的同源 CSP（脚本只允许 self 与 `wasm-unsafe-eval`，样式因 SVG/布局动态 style 允许 `unsafe-inline`，无 inline script）、`nosniff`、`no-referrer`、禁 frame ancestor 和禁 camera/microphone/geolocation。Vite preview 只验证构建，不证明真实托管 rewrite/header 已配置；发布必须对权威 URL 直接打开、刷新、MIME、404、缓存和安全头另行取证。

## 10. Security and Resource Limits

### 10.1 Immediate release blockers

- 撤销和轮换 `.project-config.json` 中所有已归档凭据；
- 从工作区、压缩包、远端历史和发布资产清除私有配置；
- 移除 Manus runtime、调试采集器、Forge storage proxy 和未配置分析脚本；
- 重新生成源码包并执行密钥扫描。

### 10.2 Import and runtime limits

所有 SPICE 文本只有一个信任边界函数 `parseAndValidateSpiceSource(source, origin, mode)`，调用路线包括：

- 用户 `.cir` 导入；
- `.fluxproj.json` 中每个 `ModelDefinition.source`；
- 内置模型首次安装和版本升级包；
- v1 迁移产生的模型文本；
- 运行前从 IndexedDB 重新读取的已有模型。

解析器先统一换行并建立物理行映射，再把首个非空字符为 `+` 的续行与上一逻辑行连接，最后分类指令；因此把 `.shell` 或 `.include` 放在续行不能绕过检查。它输出按 R/C/L、V/I、S、D、Q、M、X 分别判别的 element AST，字段直接表达位置节点、D/Q area、Q substrate、M L/W/M、X overrides 和 V/I source；每条 statement 还带 top-level/subcircuit scope。完整 `.model` 与 `.subckt/.ends` 以 canonical declaration block/source span 输出，后续层禁止读取 `statement.text` 再推断字段。`mode = "editable-circuit"` 只接受可映射为项目领域对象的 R/C/L/V/I/S/D/Q/M/X、批准的 `.op/.dc/.tran/.ac` 和模型声明；不识别的内容整次拒绝。`mode = "opaque-model"` 允许 `.model`、`.subckt/.ends`、子电路内部受支持元件和仅含有限数值默认值的 `.param/PARAMS:`，但“opaque”只表示不展开成画布元件，仍要完成词法分类、子电路配对、引用和资源校验。

两种模式都拒绝 `.control/.endc` 整块、`.shell`、`.include`、`.lib`、动态库、文件路径、任意命令替换、用户 `.options/.save/.print/.plot/.measure` 及未知 dot directive；输出请求和安全 `.options` 只由编译器生成。解析错误通过 `line/endLine` 保留逻辑语句覆盖的完整物理行范围。用户文本通过后保存规范换行的原文并计算哈希；bundled source 则先核对发布哈希，再按同一规则复验。任何路线失败都不能保存、编译或交给 ngspice。

第一版硬限制如下，单位均按 UTF-8 字节或实际二进制字节计算：

| Resource | Limit |
|---|---:|
| Project structure excluding model source | 5 MiB |
| Complete `.fluxproj.json` bundle | 15 MiB |
| Total imported model text | 10 MiB |
| Expanded netlist including embedded model text | 16 MiB |
| Components | 2,000 |
| Wires | 5,000 |
| Result points across stored axes and vectors | 2,000,000 |
| Single result vector buffer | 16 MiB |
| Raw engine axes/vectors inside adapter | 64 MiB |
| Completed snapshot axes/vectors transferred from Worker | 64 MiB |
| Emscripten virtual filesystem per run | 32 MiB |
| WASM linear-memory maximum | 256 MiB |
| Worker wall time per run | 30 s |
| Captured engine log | 1 MiB |
| Stored runs per project | 20 by default |

运行前必须做保守估算：DC sweep 由范围/步长算点数；transient 由输出 `step/start/stop` 算点数；AC 按 lin/dec/oct 和频率范围算上界。`rawResultBytes` 按 adapter 唯一 axis/source 以及 complex real+imaginary 计算；`snapshotTransferBytes` 与 result points 按最终唯一轴和每个启用 probe 的每个 scalar/real/imaginary/magnitude/phase/db20 投影逐项计算，duplicate probe 不能借 raw 去重少算。模型与生成网表按 UTF-8 实际字节求和。固定 `binary-rawfile` 时还必须用资格化格式的保守 header 公式加上 raw axis/complex 数据，计入 `virtualFsBytes`；callback 模式该项为 0。估算已超过点数、单向量、raw、snapshot transfer 或 FS 上限时不启动 Worker。

资格构建把 WebAssembly memory 的 maximum 固定为 256 MiB；适配器在 callback/rawfile 读取时累计 raw 点数/字节，在 FS 写入包装层累计文件字节，在日志回调累计 UTF-8 字节；结果解析器在创建每个轴/投影时累计最终点数、单向量与 snapshot bytes。任一运行中上限触发后主线程终止该 generation，并写入 `failed/RESOURCE_LIMIT`；30 秒 wall timeout 写入 `timeout`。rawfile 路线若不能在增长时限制 FS，必须用预估上界证明文件不会越界，否则该候选不通过资格门。部分向量、截断日志后的“成功”或解析完成后才事后忽略超限都不允许。限制未来只能由真实使用和性能数据通过架构变更调整。

### 10.3 No hidden data transmission

CI 和浏览器验收必须检查仿真、保存、导入、课程完成时没有应用业务网络请求。PWA 更新请求与静态资源请求单独识别，不上传项目数据。

## 11. State Management and UI Implementation

保留 React，使用一个工作台 `useReducer` 和显式命令，不新增 Redux/Zustand：

```ts
export type ProjectCommand =
  | { type: "project/rename"; title: string }
  | { type: "component/add"; component: ComponentInstance; layout: ComponentLayout }
  | { type: "component/replace"; component: ComponentInstance }
  | { type: "component/remove"; componentId: ComponentId }
  | { type: "wire/add"; wire: SchematicWire }
  | { type: "wire/replace"; wire: SchematicWire }
  | { type: "wire/remove"; wireId: WireId }
  | { type: "model/upsert"; model: ModelDefinition }
  | { type: "model/remove"; modelId: ModelId }
  | { type: "analysis/upsert"; analysis: AnalysisDefinition }
  | { type: "analysis/remove"; analysisId: AnalysisId }
  | { type: "probe/upsert"; probe: ProbeDefinition }
  | { type: "probe/remove"; probeId: ProbeId }
  | { type: "assertion/upsert"; assertion: AssertionDefinition }
  | { type: "assertion/remove"; assertionId: string }
  | { type: "corner/upsert"; corner: CornerDefinition }
  | { type: "corner/remove"; cornerId: CornerId }
  | { type: "note/upsert"; note: ProjectNote }
  | { type: "note/remove"; noteId: string }
  | { type: "layout/componentSet"; componentId: ComponentId; layout: ComponentLayout }
  | { type: "layout/wireRouteSet"; wireId: WireId; route: Array<{ x: number; y: number }> }
  | { type: "layout/viewportSet"; viewport: { x: number; y: number; zoom: number } };
```

每个通过校验并实际改变项目的命令恰好令 `revision += 1`；拒绝或 no-op 命令不改任何修订。下列命令同时令 `electricalRevision += 1`：`component/*`、`wire/*`、`model/*`、`analysis/*`、`probe/*`、`corner/*`，但 `layout/*` 不属于 `component/*`。`project/rename`、`note/*`、`layout/*` 和 `assertion/*` 只改 `revision`。每次 `assertion/*` 后，只为受影响的 `analysisId` 从按 ID 排序的 `enabled` 定义计算新的 `assertionSetHash`；该哈希使该分析旧求值失效，但不使数值快照或其他分析求值失效。运行记录状态转换、学习证据存储和追加断言求值不是项目命令，不改两个修订。

删除仍被其他领域对象引用的 component/model/analysis/probe 必须返回诊断，不能暗中级联；UI 若要级联，先展示将删除的明确列表，再作为一个经领域服务验证的原子项目变更提交并只增加一次修订。导入/迁移同样由领域服务构造完整候选项目并整体校验，不通过逐条 UI 命令产生几十个中间修订。viewport 和拖拽只在一次手势结束时持久化一个命令。

撤销/重做记录命令前后的最小项目状态。第一版可继续使用不可变快照历史，历史上限 50；只有测量表明内存成为问题时才改为逆命令或增量日志。

页面组件不得调用 ngspice、解析网表或计算工程结论。它们只派发命令、提交运行请求和投影完整成功运行记录。

## 12. Repository Structure

保持单应用：

```text
client/src/
  app/
    routes.tsx
    ProjectWorkspace.tsx
    register-service-worker.ts
  domain/
    project/
      project-v2.ts
      project-schema.ts
      migrate-v1.ts
    schematic/
      component-library.ts
      graph.ts
      diagnostics.ts
  simulation/
    contracts.ts
    compile-netlist.ts
    spice-source-parser.ts
    ngspice-adapter.ts
    simulator.worker.ts
    result-parser.ts
    measurements.ts
  features/
    editor/
      SchematicCanvas.tsx
      project-reducer.ts
    analysis/
    instruments/
    verification/
    learning/
    project-library/
  storage/
    indexeddb.ts
    project-files.ts
  legacy/
    v1-types.ts
tests/
  fixtures/
    circuits/
    netlists/
    models/
  browser/
    ngspice-qualification.spec.ts
    offline-update.spec.ts
vendor/
  ngspice/
    VERSION
    SOURCE.md
    BUILD.md
    LICENSES/
    SHA256SUMS
    ngspice.wasm
    ngspice.mjs
    qualification/
      qualification.worker.ts
      fixtures/
      expected-results.json
docs/
  2026-08-28-circuit-simulator-modernization/
```

不创建 `packages/*`，不引入通用插件系统。只有当第二个真实求解后端被批准时，才把适配器抽成公共包。

## 13. Existing Code Disposition

### 13.1 Keep and refactor

| Existing asset | Decision |
|---|---|
| `CircuitCanvas.tsx`, `RCChargeCanvas.tsx` | 合并为一个 `SchematicCanvas`，保留拖拽、吸附和正交连线 |
| `Oscilloscope.tsx` | 改为通用 `ResultVector` 投影 |
| `EDITOR_INTERACTIONS.md` | 作为编辑命令和交互迁移输入 |
| 分压/RC 公式和测试 | 移入黄金夹具与课程解释，不再作为自由电路权威求解 |
| 深色工程网格和信号色 | 保留可读部分，减少假仪器装饰和无功能控件 |
| JSON/CSV 下载工具 | 迁移到统一项目与快照导出 |

### 13.2 Remove after replacement

| Existing asset | Reason |
|---|---|
| `engineering-core.ts` | 互不相连的演示公式，不是统一内核 |
| `engineering-ops.ts` | 静态目录、风险和硬编码门禁 |
| `EngineeringStudio.tsx`, `EngineeringOps.tsx` | 由工作台分析/验证面板取代 |
| `LEDCanvas.tsx` 和独立 LED 页面状态 | 由共享画布和课程模板取代 |
| `Map.tsx`, `ManusDialog.tsx`, 未引用 UI 文件 | 生成器残留与依赖攻击面 |
| Manus/Forge/debug collector/analytics stub | 与离线本地产品边界冲突 |
| `template.json` | 重复且过期的生成器源副本 |
| Express 静态服务器 | 纯静态/PWA 构建不需要应用服务器 |

删除顺序遵循“替代能力通过验收后再删除旧入口”，但 P0 凭据和遥测不等待功能替代。

## 14. Migration Strategy

### 14.1 v1 to v2

迁移器执行：

1. 安全解析 v1，拒绝缺失数组、未知版本和非有限数；
2. `kind` 映射到 v2 元件定义；
3. `top/bottom` 映射到明确引脚；
4. `x/y` 移到 `layout.components`；
5. 导线端点重新校验；
6. 生成相应模板的分析和探针；
7. 记录所有无法无损映射的字段；
8. 丢弃旧仿真结果、门禁和学习完成标记；
9. 用户预览后明确保存为 v2。

旧 RC 的 `switchMode/closed/initialValue` 没有可信 ngspice 等价物：迁移器仍保留可保留的元件、导线、坐标和 R/C/V 参数，删除这些伪初态字段，并把旧两端开关保存为合法的四端 v2 switch——`p/n` 保留旧连接，`cp/cn` 明确保持未连接，引用一个经过统一解析器验证的内置迁移开关模型。迁移预览生成 `MIGRATION_SWITCH_REQUIRES_REWIRE`；保存后，即使预览诊断不再单独持久化，ERC 仍以悬空的必要控制引脚阻断运行，直到用户接入真实控制源或重构拓扑。用户也可另建新的 RC 课程模板。不得因这一字段丢弃整个旧项目，也不得把旧模式伪造成已经验证的 PULSE/放电拓扑。

### 14.2 Legacy routes

- `/divider` -> 对应分压模板的 `/learn/foundation-divider`；
- `/led` -> 对应 LED 模板的 `/learn/foundation-led`；
- `/` 保持为新项目库；若检测到旧 RC LocalStorage，则显示一次明确的“迁移旧 RC 项目”卡片，不自动覆盖当前项目；
- `/engineering` -> 当前项目 `analysis` 面板；
- `/engineering/ops` -> 当前项目 `verification` 面板。

没有当前项目时，工程旧路由先打开项目库，不生成虚假默认项目快照。

## 15. Verification Architecture

验证按价值顺序：

### Stage A: changed functionality

- 浏览器加载统一工作台；
- 编辑真实拓扑并运行 ngspice Worker；
- 仪器读数引用返回快照；
- 课程完成引用真实 run ID。

### Stage B: affected regressions

- 9 V / 1 kΩ / 2 kΩ 分压得到 6 V；
- 5 V / 10 kΩ / 100 μF RC 在 1τ 和 5τ 与解析基线一致；
- PULSE/SIN/PWL 与 AC source 按规范单位编译；subcircuit 端口和参数始终按声明顺序输出；
- 同名大小写不同的 net label 合并，冲突标签和保留地标签得到确定诊断；
- 悬空、短路、无地、坏参数不显示旧成功结果；
- v1 项目坐标、拓扑和参数迁移后保持。

### Stage C: robustness

- 坏 JSON、未知版本、缺模型、超限网表；
- `.cir`、`.fluxproj`、bundled model 的危险指令与续行绕过样本；
- Worker 超时、取消、WASM 初始化失败，以及旧 generation 延迟完成事件；
- success/failed/cancelled/timeout `RunRecord` 往返与中断恢复；
- 测量插值、越界、空/NaN、单位、near/between 和 3 dB 前置条件；
- 预估和运行中 heap/FS/vector/transfer 限额；
- 离线重开与 V1 active/V2 waiting 的原子更新；
- 参数变化导致快照和门禁过期；
- 导入危险控制语句被逐行拒绝。

核心测试层：

- 纯函数：schema、graph、compiler、measurement；
- Worker contract：固定小网表、ABI 清理、资源故障和 generation 竞态；
- 浏览器：项目编辑到波形、课程到工程视图、离线重开；
- 发布 smoke：所有正式路由、WASM、Worker、PWA 缓存和静态资产。

不为每个 UI 组件添加快照测试，不以覆盖率百分比代替产品证据。

## 16. Acceptance Metrics

### Correctness and traceability

- 100% 可见分析结果来自 `status = success` 的 `RunRecord`，并带 project/electrical revision、analysis hash、netlist hash、engine fingerprint、model hashes、corner metadata 和确定性 vector provenance。
- 100% ERC、断言、角点和交付门禁引用当前 `electricalRevision` 的具体 run ID。
- 0 个未知 SPICE 行被静默忽略。
- 0 个失败、过期或取消运行显示为通过。
- 9 V / 1 kΩ / 2 kΩ 分压节点误差不超过 1 μV；RC 1τ/5τ 与解析基线相对误差不超过 0.5%；一阶低通 −3 dB 截止频率误差不超过 1%。

### Learning

“新用户”定义为从未使用 FLUXLAB、且测试前未看过任务脚本的人；20 人使用同一发布候选、默认设置和无主持人代操作的任务测试。计时从任务首屏可交互开始，到满足“用户行为 + 可见数值 + run/revision 追溯”三项为止。允许使用产品内帮助，但记录 help count、错误次数、首次成功时间、viewport、projectId/revision/runId 和屏幕/网络证据。

| Task | Fixed start and script | Success threshold |
|---|---|---|
| 基础 01 分压 | 9 V、1 kΩ、2 kΩ、GND 模板；进入课程、检查/完成连接、运行 DC、读取 Vout、展开工作台、保存 checkpoint | Vout = 6 V（误差 ≤1 μV），run/revision 可见；≤8 min，至少 17/20 |
| LED 真实调参 | 5 V、680 Ω、Vf≈2 V，默认约 4.4 mA、目标 8–12 mA；先预测，再修改 R 或 Vs、运行、查看电流/功耗并提交断言 | 必须发生真实参数变更，电流进入目标且断言通过；≤6 min，至少 18/20；默认不能完成 |
| 课程到工作台 | 完成基础 01，展开同一项目，修改 R2，再运行一类分析，回看旧运行 | projectId/拓扑连续，旧快照 stale，新 run 成功；≤10 min，至少 16/20 |
| 工程导入 | 5 名有 SPICE 使用经验者导入固定允许模型，运行 DC/transient/AC 任两类，导出 run 并定位 revision、engine、model hash | ≤20 min，至少 4/5；另一个含 `.control/.shell` 的固定样本必须逐行拒绝 |

同一 20 名新用户在 RC 63.2% 与 LED 限流两个固定概念题上做节点前/后同题异序测试；两题的组内正确率各自至少提高 30 个百分点。该指标验证学习，不替代上述操作成功率。

研究不得为产品添加遥测。协议先固定同一 release candidate、任务、计时、排除规则与知情同意；研究员本地计时并仅在同意后录屏，参与者主动导出运行证据。身份和原始录屏不进入 Git；仓库只保存脱敏聚合、脚本版本、app build ID、运行证据哈希和非敏感保管引用。AI/自动浏览器不能充当参与者；没有真人证据时学习指标必须保持 Pending。

### UX and accessibility

- 正式导航中 0 个点击后只显示“规划中”或“已展开”的入口。
- 键盘可完成选中、参数修改、运行、查看诊断和撤销/重做。
- 尊重 `prefers-reduced-motion`；颜色不是状态的唯一载体。
- 360 px 支持课程、参数和结果查看；768 px 支持轻量编辑；1024 px 以上支持完整工程工作台。

### Performance and delivery

- 500 个元件内，普通拖拽和选择不产生超过 50 ms 的主线程长任务。
- `ResultTable` 使用原生分页，每页最多 200 行；页码切换只读取当前 slice。接近 2,000,000 stored points 的已验证运行在数据加载完成后的表格打开、翻页和列切换窗口内不得产生超过 50 ms 的主线程长任务，不引入虚拟列表依赖。
- 用户取消后 500 ms 内 Worker 终止并回到可再次运行状态。
- ngspice/WASM 不进入首次交互所需的 eager JS，也不阻塞首屏；它可由 Service Worker 安装在后台预缓存，或由首次 Run 先触发下载，两者共用同源内容哈希资产，并单独报告原始/gzip/缓存字节和“离线就绪”状态。
- 生产依赖审计无未解释 high；源码包密钥扫描为零。
- 首次缓存后断网重开可完成 RC 瞬态夹具。

2026-08-28 只读审计基线 B0 固定如下，后续报告不能只写“更小”：

| Metric | B0 | First modernization gate |
|---|---:|---:|
| Direct runtime dependencies | 51 | ≤45；保留将用于信任边界的 `zod`，删除未用模板/网络依赖 |
| Direct dev dependencies | 22 | ≤16；`vite-plugin-pwa` 和浏览器验收工具计入，不把它们藏到脚本下载 |
| Direct dependency total | 73 | ≤61 |
| Lockfile | 260,363 bytes | pinned Node/pnpm 下 frozen install 不改 lockfile |
| Initial HTML + CSS + eager JS, raw | 1,033,996 bytes | ≤827,000 bytes（至少降低 20%） |
| Initial HTML + CSS + eager JS, gzip | 275,268 bytes | ≤220,000 bytes（至少降低 20%） |
| Eager JS, raw / gzip | 503,404 / 141,883 bytes | ≤402,000 / 114,000 bytes |
| Entire `dist/public` | 1,059,221 bytes | 逐类报告；debug collector 必须为 0 bytes |
| Production audit | 71 findings: 16 high / 47 moderate / 8 low | high = 0；其余逐项记录直接路径、修复版本和接受理由 |

B0 来自隔离副本的成功 `check/test/build`，gzip 用相同字节流重新压缩测量；未来门禁使用固定工具链 clean install 重测。体积统计按浏览器首次打开项目库实际需要的所有 HTML/CSS/JS 求和，不能通过任意拆 chunk 规避；包含已校验 ngspice glue 的 simulation Worker 与独立 WASM 分别报告原始、gzip 和缓存体积，并证明它们不属于首屏 eager 依赖闭包，即使 Service Worker 在首屏可交互后后台预缓存它们。依赖删除可能只收缩安装与漏洞面、不改变 Vite bundle，此时必须分别报告，不能虚构包体收益。

## 17. Requirement Traceability

| Requirement | Design element | Planned evidence |
|---|---|---|
| R1 | Sections 4–7, unified graph/compiler/Worker | topology fixtures and browser run |
| R2 | Section 3, one workspace and learning overlay | lesson-to-expert E2E |
| R3 | Sections 7.3–7.5 `RunRecord`/snapshot provenance | contract test and inspector UI |
| R4 | Section 8, run-bound verification | stale snapshot and gate tests |
| R5 | Sections 6.3 and 10.2 unified SPICE trust boundary | all-route line-level rejection fixtures |
| R6 | Section 9 and 10.3 | offline and network capture |
| R7 | Section 10.1 | rotated credentials, clean archive scan |
| R8 | Sections 5, 9.2, 14 | malformed and migration fixtures |
| R9 | Section 15 | change-scoped CI and browser evidence |
| R10 | Sections 12–13 and 16 | dependency, size and route smoke comparison |

## 18. Architecture Invariants for Agentic Implementers

后续 AI 每次改动必须保持：

1. React 页面不能产生权威电气结果。
2. 课程不能绕过项目、编译器或 Worker。
3. 验证不能在没有当前成功快照时通过。
4. 相同输入必须产生确定性网表和可追溯哈希。
5. 未支持输入必须明确失败，不能“尽量解析”后继续。
6. 项目或模型默认不发送到网络。
7. 不新增第二套求解器、云服务、monorepo 或插件系统，除非另开架构决策。
8. 每个纵向切片必须以真实浏览器结果验收，而不只是单元测试变绿。
9. 正式构建在入口、Vite release build 紧前、pre/post 门禁结束和 external 验证入口都必须证明 `HEAD === releaseSourceCommit` 且工作树洁净。
10. 发布 manifest 的 `deliveryFiles` 封闭覆盖所有公开普通文件（除 manifest 自身）；扫描前后目录树和远端静态/浏览器证据必须绑定同一 RC。

## 19. Approval

- Status: Approved for implementation
- Approved scope: Problem scope and Approach A
- Approved runtime: Browser-only ngspice WASM in Web Worker
- Detailed architecture approved: Yes, by user in this task
- Implementation plan: Complete and independently reviewed
- Product-code implementation started: No
- Next gate: Satisfy the Git/gitleaks/credential-rotation preconditions, then execute Task 1; Task 1 runtime qualification is a hard stop for Tasks 8–23
- Post-approval clarifications: `Diagnostic.endLine`, compiler `vectorPlan`, and loss-aware v1 RC migration were added during plan consistency review; they close provenance/migration ambiguity without changing the approved architecture
- Date: 2026-08-28

# FLUXLAB Trusted Circuit Simulator Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有五个演示页面重建为一个可离线使用、由 ngspice/WASM 提供唯一数值真源、从课程到工程验证共享同一项目与运行证据的电路工作台。

**Architecture:** 单个 React/Vite 应用保存 `CircuitProjectV2`，经 schema、图/ERC、确定性网表编译后，在 Web Worker 内调用固定版本 ngspice/WASM。成功和失败都进入可追溯 `RunRecord`；课程、仪器、断言、角点、导出和门禁只能投影成功运行记录，不拥有第二套求解器。

**Tech Stack:** React 19、TypeScript 5.6 strict、Vite 7、Vitest 2、Playwright、zod 4、原生 IndexedDB/Web Worker/Web Crypto/Service Worker、SVG、ngspice WebAssembly、`vite-plugin-pwa`。

**Spec:** `docs/2026-08-28-circuit-simulator-modernization/02-design.md`

## Global Constraints

- 开始每个任务前完整阅读本计划、设计文档和 `04-progress.md`；只执行当前任务列出的范围。
- 保持单应用；不创建 monorepo、服务端、账号、云同步、远程仿真、通用插件系统、自研 MNA/SPICE 或第二求解器。
- React 页面、课程和图表不得计算权威电气结果；数值只来自 `SuccessfulRunRecord`。
- ngspice 只能从同源、固定版本、SHA-256 校验后的 Worker 加载；第一版单线程，不启用 WASM threads，不依赖 COOP/COEP。
- 构建 purpose 只有 `verification | pwa-fixture | release`：普通 `pnpm build` 产生带 `nonReleaseBuild` 标记的源树哈希 verification 产物；PWA 夹具只写测试目录；只有 Task 23 的 clean-commit release 模式可生成候选发布物。
- 项目数值只存有限 SI 数；不支持的 SPICE、IC/OFF/UIC、模型或资源规模必须结构化失败，不能丢行、夹取、截断后成功或复用旧结果。
- 信任边界统一使用现有 `zod`；状态使用 `useReducer`；存储使用原生 IndexedDB；SVG 画布继续使用；不得新增 Redux、Zustand、数据库封装或图表框架。
- 运行限制：项目结构 5 MiB、完整项目 15 MiB、模型文本 10 MiB、展开网表 16 MiB、完整 `.fluxrun` 文本 128 MiB、2,000 元件、5,000 导线、2,000,000 个 stored axis/vector 点、单向量 16 MiB、adapter 原始结果 64 MiB、最终快照传输 64 MiB、虚拟 FS 32 MiB、WASM memory 256 MiB、单次 30 s、日志 1 MiB、每项目默认 20 次运行。
- UI 门禁：360 px 可完成课程/参数/结果，768 px 可轻量编辑，1024 px 可完整工作；键盘可完成选中、参数修改、运行、诊断、撤销/重做；遵守 `prefers-reduced-motion`，颜色不是唯一状态载体。
- 发布门禁：runtime dependencies ≤45、dev dependencies ≤16、总数 ≤61；首次 HTML/CSS/eager JS raw ≤827,000 B、gzip ≤220,000 B；eager JS raw/gzip ≤402,000/114,000 B；production audit high = 0；密钥扫描 = 0。
- 测试按价值顺序执行：先当前任务的 changed behavior；它失败时不运行 regression；regression 通过后才运行同一影响面的 robustness；最后才运行全局 release checks。
- 每个产品可见、存储、迁移、Worker 或 PWA 任务必须用真实构建/浏览器留下新证据；只有单元测试通过时必须写：`Code-level checks passed; product acceptance remains unverified.`
- 每个任务完成后更新 `04-progress.md`；验证证据更新 `05-verification.md`；不得把计划步骤本身写成已验证事实。
- 本日期目录是唯一规范内容；`docs/superpowers/specs/2026-08-28-circuit-simulator-modernization-design.md` 和 `docs/superpowers/plans/2026-08-28-circuit-simulator-modernization.md` 只是稳定入口。根目录旧评审/路线图只描述改造前基线，冲突时不得据其实现。

## Execution Preconditions

当前交付目录没有 `.git`，且历史归档包含私有配置。执行代理在 Task 1 前必须运行：

```powershell
git rev-parse --show-toplevel
Get-Command gitleaks -ErrorAction Stop
gitleaks version
gitleaks detect --no-git --source . --redact
```

预期当前 `git rev-parse` 失败，且当前工作机可能没有 gitleaks。任一前置命令不可用时不得把“command not found”解释成扫描通过或发现风险；停止并要求安装固定的 gitleaks `v8.30.1`，且先校验官方发布资产 SHA-256。执行代理还必须请用户提供规范 Git 仓库/工作树，或明确授权在该目录初始化 Git；不得自行 `git init`。用户必须确认已撤销并轮换归档泄露的凭据。所有计划内 commit 步骤都以 Git 和固定扫描器前提已满足为条件；任何日志、diff、测试夹具和文档都不得复制密钥值。

## Target File Map

This is the cross-task ownership map; each task's **Files** block is authoritative for its complete focused test/fixture list.

```text
client/src/
  app/
    routes.tsx                         # 四类正式路由和旧路由重定向
    ProjectWorkspace.tsx               # 单一工作台外壳
    build-info.ts                      # appBuildId，与 engineBuildId 分离
    LegacyRedirect.tsx                 # 一周期旧链接兼容
    register-service-worker.ts         # 唯一 SW 注册与 waiting UI
    OfflineStatus.tsx                  # 离线就绪/waiting 状态
    SettingsPage.tsx                   # 真实 build/engine/offline/storage/preferences
  domain/project/
    project-v2.ts                      # 项目、元件、模型、分析、探针、断言、角点类型
    project-schema.ts                  # zod 信任边界与 SI/大小限制
    canonical.ts                       # canonical JSON 与 Web Crypto SHA-256
    templates.ts                       # divider/RC/LED/engineering v2 模板
    bundled-models.ts                  # 固定模型 source/hash/license manifest
    migrate-v1.ts                      # v1 候选迁移与诊断
  domain/schematic/
    component-library.ts               # 元件 pin 注册表与参数元数据
    graph.ts                           # 物理导线、label union、稳定节点
    diagnostics.ts                     # schema/schematic/ERC 诊断
  legacy/v1-types.ts                   # 只读 v1 zod 类型
  simulation/
    contracts.ts                       # engine/worker/run/vector 协议
    qualified-vectors.mjs              # Node/browser 共用 strict matrix parser/resolver
    qualified-vectors.d.mts            # 共用 ESM 类型
    spice-source-parser.ts             # 所有 SPICE 文本的唯一 allowlist
    resource-estimator.ts              # 运行前点数/字节上界
    compile-netlist.ts                 # 确定性网表、source map、corner
    ngspice-adapter.ts                 # 候选 ABI 封装
    simulator.worker.ts                # Worker 消息与 runtime limits
    simulation-controller.ts           # generation、取消、超时、RunRecord 状态机
    result-parser.ts                   # raw vectors -> typed snapshot
    run-record.ts                      # 纯终态转换和 freshness
    run-record-schema.ts               # IDB/文件运行信任边界
    measurements.ts                    # 受控测量函数
    verification.ts                    # assertions、corners、delivery gate
  features/
    project-library/ProjectLibrary.tsx
    editor/SchematicCanvas.tsx
    editor/project-reducer.ts
    editor/PropertiesPanel.tsx
    analysis/AnalysisPanel.tsx
    analysis/ProbePanel.tsx
    analysis/RunControls.tsx
    analysis/RunHistory.tsx
    instruments/ResultDock.tsx
    verification/VerificationPanel.tsx
    learning/LessonOverlay.tsx
    learning/LessonCatalog.tsx
    learning/lessons.ts
  storage/
    indexeddb.ts                       # projects/runSequences/runs/evidence/settings 五 store
    project-files.ts                   # fluxproj/fluxrun/cir/csv import/export
tests/
  fixtures/{circuits,netlists,models,migrations,imports}/
  browser/
    ngspice-qualification.spec.ts
    project-persistence.spec.ts
    run-storage.spec.ts
    divider-run.spec.ts
    analysis-and-instruments.spec.ts
    verification-gates.spec.ts
    project-files.spec.ts
    learning-flow.spec.ts
    offline-update.spec.ts
    release-smoke.spec.ts
    no-business-network.spec.ts
    legacy-routes.spec.ts
    accessibility-performance.spec.ts
  release/                            # Node stdlib hygiene/dependency/build/host gates
scripts/
  resolve-build-identity.mjs
  verify-ngspice-assets.mjs
  build-pwa-fixtures.mjs
  verify-release-hygiene.mjs
  measure-build.mjs
  verify-static-host.mjs
  verify-dependencies.mjs
  verify-build-identity.mjs
  verify-audit-report.mjs
  create-license-inventory.mjs
  run-release-gates.mjs
  create-release-manifest.mjs
  create-study-instance.mjs
vendor/ngspice/
  VERSION SOURCE.md BUILD.md SHA256SUMS LICENSES/
  RESULT_TRANSPORT.json QUALIFIED_VECTORS.json
  ngspice.mjs ngspice.wasm
  qualification/{qualification.worker.ts,fixtures,expected-results.json}
```

相邻纯函数测试使用现有 `*.test.ts` 风格；只有真实浏览器边界放到 `tests/browser`。不得为每个 React 组件增加快照测试。

---

## Phase 1 — Prove the Runtime and Remove Immediate Risk

### Task 1: Qualify and Pin the Only Simulation Engine

**Behavior:** 在产品代码依赖 ngspice 之前，证明一个可审计候选能在 Chromium、Firefox、WebKit 的单线程 Worker 中执行 DC、transient、DC sweep 和 AC，并清理虚拟 FS/plot 状态。

**Files:**
- Create: `vendor/ngspice/VERSION`
- Create: `vendor/ngspice/SOURCE.md`
- Create: `vendor/ngspice/BUILD.md`
- Create: `vendor/ngspice/SHA256SUMS`
- Create: `vendor/ngspice/RESULT_TRANSPORT.json`
- Create: `vendor/ngspice/QUALIFIED_VECTORS.json`
- Create: `vendor/ngspice/LICENSES/`
- Create: `vendor/ngspice/ngspice.mjs`
- Create: `vendor/ngspice/ngspice.wasm`
- Create: `vendor/ngspice/qualification/qualification.worker.ts`
- Create: `vendor/ngspice/qualification/fixtures/divider-op.cir`
- Create: `vendor/ngspice/qualification/fixtures/rc-transient.cir`
- Create: `vendor/ngspice/qualification/fixtures/diode-sweep.cir`
- Create: `vendor/ngspice/qualification/fixtures/rc-lowpass-ac.cir`
- Create: `vendor/ngspice/qualification/fixtures/qualified-vectors/{op,sweep,transient,ac}.cir`
- Create: `vendor/ngspice/qualification/fixtures/subcircuit-model.lib`
- Create: `vendor/ngspice/qualification/fixtures/subcircuit-op.cir`
- Create: `vendor/ngspice/qualification/fixtures/cancel-long-run.cir`
- Create: `vendor/ngspice/qualification/expected-results.json`
- Create: `client/src/simulation/qualified-vectors.mjs`
- Create: `client/src/simulation/qualified-vectors.d.mts`
- Create: `scripts/verify-ngspice-assets.mjs`
- Create: `tests/release/ngspice-assets.test.mjs`
- Create: `client/qualification.html`
- Create: `client/src/qualification.ts`
- Create: `tests/browser/qualification-window.d.ts`
- Create: `tests/browser/ngspice-qualification.spec.ts`
- Create: `playwright.config.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `vite.config.ts`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- Produces: build-time hash-verified `ngspice.mjs` statically bundled into the simulation/qualification Worker, runtime hash-verified `ngspice.wasm`, one immutable `resultTransport`, one strict `QUALIFIED_VECTORS.json` capability matrix, provenance files, four numerical fixtures, one explicit R/C/L/V/I/D/switch vector-matrix fixture family, a model/subcircuit fixture, cancellation fixture and `window.__qualificationResult` for the test-only page. No independent glue MJS is emitted or dynamically imported in production.
- Gate for Tasks 8–23: selected module exposes controlled instantiate, FS write/read/unlink, batch run, exactly one qualified `vector-callback | binary-rawfile` path, plot cleanup, heap metrics and deterministic resource failure.
- `qualified-vectors.mjs` is the sole Node/browser implementation of `parseQualifiedVectorManifest(input)`, `resolveQualifiedVector(manifest, request)` and `listQualifiedFamilies(manifest, quantity, analysis)`; the asset verifier and Tasks 8/10/15 import it directly.

```ts
export type QualifiedVectorCapability =
  | {
      quantity: "branch-current";
      family: "R" | "C" | "L" | "V" | "I" | "D" | "S";
      analysis: "dc-op" | "dc-sweep" | "transient" | "ac";
      rawNameTemplate: string;
      positiveDirection: "p-to-n";
    }
  | {
      quantity: "device-power";
      family: "R" | "D";
      analysis: "dc-op" | "dc-sweep" | "transient";
      rawNameTemplate: string;
      sign: "absorbed";
    };

export interface QualifiedVectorManifest {
  schemaVersion: 1;
  capabilities: QualifiedVectorCapability[];
}
```

Capabilities are unique and sorted by `[quantity,family,analysis]`. `rawNameTemplate` is exactly `safe-fragment "{ref}" safe-fragment`, with each fragment 0–64 characters from `[A-Za-z0-9_@#.[\]:+\-]` and no other brace. The resolver validates canonical refdes, substitutes its lowercase form exactly once and returns `null` for an absent tuple.

```ts
export type QualifiedResultTransport =
  | { schemaVersion: 1; kind: "vector-callback"; rawfileHeaderEstimator: null }
  | {
      schemaVersion: 1;
      kind: "binary-rawfile";
      rawfileHeaderEstimator: {
        version: 1;
        fixedBytes: number;
        perVariableBytes: number;
        perVariableNameUtf8Byte: number;
        safetyBytes: number;
      };
    };
```

For binary rawfile, the preflight header upper bound is `fixedBytes + variableCount*perVariableBytes + sum(variableNameUtf8Bytes)*perVariableNameUtf8Byte + safetyBytes`; Task 1 must prove it covers the selected build's actual header for every qualification boundary. Raw binary point bytes are added separately.

- [ ] **Step 1: Add the failing three-browser qualification test and exact fixture expectations**

```ts
// tests/browser/ngspice-qualification.spec.ts; Playwright projects supply each browser once.
import { expect, test } from "@playwright/test";

test("qualifies the pinned runtime, cleanup, cancellation, model loading, and limits", async ({ page }) => {
  const responses = new Map<string, string>();
  page.on("response", response => responses.set(new URL(response.url()).pathname, response.headers()["content-security-policy"] ?? ""));
  await page.goto("/qualification.html");
  const result = await page.evaluate(async () => await window.__qualificationResult);
  expect(result.dividerVout).toBeCloseTo(6, 6);
  expect(result.rcAt1Tau).toBeCloseTo(3.160602794, 2);
  expect(result.rcAt5Tau).toBeCloseTo(4.966310266, 2);
  expect(result.diodeCurrentRatio).toBeGreaterThan(10);
  expect(result.lowpassCutoffHz).toBeGreaterThan(157.56);
  expect(result.lowpassCutoffHz).toBeLessThan(160.75);
  expect(result.subcircuitVout).toBeCloseTo(2.5, 6);
  expect(result.dividerR1PowerW).toBeCloseTo(0.009, 9);
  expect(result.diodePowerMatchesVI).toBe(true);
  expect(result.secondRunEqualsFirst).toBe(true);
  expect(result.cancelledWorkerRebuilt).toBe(true);
  expect(result.webLocksAvailable).toBe(true);
  expect(result.cancelReadyMs).toBeLessThanOrEqual(500);
  expect(result.hashMismatchCode).toBe("ENGINE_HASH_MISMATCH");
  expect(result.moduleHashMismatchCode).toBe("ENGINE_MODULE_HASH_MISMATCH");
  expect(result.versionMismatchCode).toBe("ENGINE_VERSION_MISMATCH");
  expect(result.transportMismatchCode).toBe("ENGINE_TRANSPORT_MISMATCH");
  expect(result.engineBuildMismatchCode).toBe("ENGINE_BUILD_MISMATCH");
  expect(["vector-callback", "binary-rawfile"]).toContain(result.resultTransport);
  if (result.resultTransport === "vector-callback") expect(result.rawfileFsBytes).toBe(0);
  else expect(result.rawfileEstimateCoversActual).toBe(true);
  expect(result.limitCodes).toEqual(["RESOURCE_FS", "RESOURCE_HEAP", "RESOURCE_LOG", "RESOURCE_POINTS", "RESOURCE_RAW_RESULT", "RESOURCE_VECTOR"]);
  expect(result.fsEntriesAfterRun).toEqual([]);
  expect(result.plotsAfterCleanup).toEqual([]);
  expect(result.businessRequests).toEqual([]);
  expect(responses.get("/qualification.html")).toContain("default-src 'self'");
});
```

Declare the browser-only result type:

```ts
interface QualificationResult {
  dividerVout: number;
  rcAt1Tau: number;
  rcAt5Tau: number;
  diodeCurrentRatio: number;
  lowpassCutoffHz: number;
  subcircuitVout: number;
  dividerR1PowerW: number;
  diodePowerMatchesVI: boolean;
  secondRunEqualsFirst: boolean;
  cancelledWorkerRebuilt: boolean;
  webLocksAvailable: boolean;
  cancelReadyMs: number;
  hashMismatchCode: string;
  moduleHashMismatchCode: string;
  versionMismatchCode: string;
  transportMismatchCode: string;
  engineBuildMismatchCode: string;
  resultTransport: "vector-callback" | "binary-rawfile";
  rawfileFsBytes: number;
  rawfileEstimateCoversActual: boolean;
  limitCodes: string[];
  fsEntriesAfterRun: string[];
  plotsAfterCleanup: string[];
  businessRequests: string[];
}

interface Window {
  __qualificationResult: Promise<QualificationResult>;
}
```

- [ ] **Step 2: Run the test and prove it fails before a candidate is vendored**

Run:

```powershell
pnpm exec playwright test tests/browser/ngspice-qualification.spec.ts
```

Expected: FAIL because `/qualification.html` or the vendored module is absent; an arbitrary timeout is not an acceptable expected failure.

- [ ] **Step 3: Build or adopt one auditable upstream candidate and record provenance**

Use official ngspice release source, or a prebuilt candidate that links to its exact upstream source and reproducible build. `SOURCE.md` contains upstream URL, immutable tag/commit and download SHA-256; `BUILD.md` contains Emscripten version, complete build commands, patches, single-thread settings and 256 MiB maximum memory; `VERSION` contains only ngspice version and `engineBuildId`; `SHA256SUMS` covers both runtime files, `RESULT_TRANSPORT.json` and `QUALIFIED_VECTORS.json`. `RESULT_TRANSPORT.json` fixes exactly one `kind`. For `vector-callback` its rawfile sizing is `null`; for `binary-rawfile` it includes the qualified conservative header estimator inputs/version used by Task 9. `QUALIFIED_VECTORS.json` is strict/versioned and records one capability per accepted `{ quantity, family, analysis, rawNameTemplate, positiveDirection | sign }` tuple exactly matching `QualifiedVectorCapability`; unknown keys, duplicate/unsorted tuples and a family/analysis not proven by the qualification fixtures fail the asset verifier. Copy all required upstream licenses into `LICENSES/`.

Run:

```powershell
Get-FileHash -Algorithm SHA256 vendor/ngspice/ngspice.mjs
Get-FileHash -Algorithm SHA256 vendor/ngspice/ngspice.wasm
node --test tests/release/ngspice-assets.test.mjs
```

Expected: hashes exactly equal `SHA256SUMS`; no runtime URL points to a CDN.

`scripts/verify-ngspice-assets.mjs` parses `SHA256SUMS` with Node standard libraries, imports `parseQualifiedVectorManifest` from `../client/src/simulation/qualified-vectors.mjs`, and is invoked synchronously by Vite config before it imports/bundles the module factory. The verifier has no local vector schema/name/sign table: after the shared parser succeeds, it only cross-checks that every capability has a three-browser qualification observation and that no observation is omitted. Its unit fixtures reject unknown keys, bad `{ref}` syntax, duplicate/unsorted tuples and an observation/matrix mismatch. A copied fixture with one changed MJS byte expects `ENGINE_MODULE_HASH_MISMATCH` before Vite/Worker execution; a similar WASM mismatch also blocks the build. The verified module hash becomes a compile-time Worker constant and part of every `EngineFingerprint`/release manifest.

- [ ] **Step 4: Implement the minimal qualification worker**

The Vite-compiled worker statically imports only the build-verified module factory, loads verified WASM bytes, creates one generated run directory, writes only generated fixture/model names, runs batch mode, reads vectors through the one `RESULT_TRANSPORT.json` path, calls ngspice plot cleanup, unlinks every file, and returns `QualificationResult`. The qualification page must also prove `navigator.locks.request` and `ifAvailable` work in Chromium, Firefox and WebKit; absence is a hard gate because Task 11 recovery cannot safely guess whether another tab still owns a run. It must reject console-text value parsing and any runtime fallback to the other transport. Callback mode proves rawfile FS bytes are exactly zero. Binary-rawfile mode proves its conservative header + axis + complex-vector estimator is never below actual bytes and that the full rawfile budget participates in the 32 MiB FS limit before execution. In addition to voltage/current vectors, request the real ngspice `@R1[p]` divider power and `@D1[p]` diode-sweep power vectors; prove 9 mW for R1 and each diode power point equals its voltage×current within the fixed tolerance. These two proven primitive names are the complete v1 device-power allowlist. The four `qualified-vectors/{op,sweep,transient,ac}.cir` files each contain the applicable members of R, C, L, independent V/I, D and voltage-controlled switch with unambiguous p→n references; together with `expected-results.json` they name and numerically assert every proposed family/analysis tuple. Qualify and write `QUALIFIED_VECTORS.json` only from those exact observations. Each retained tuple must pass in all three browsers with the same raw name and positive direction; remove any unreliable tuple from the matrix and make Task 8/UI block it. Run the divider twice in the same Worker and prove equality/no plot leak; load the fixed subcircuit/model; deliberately request each heap/FS/log/point/vector/raw-result limit at one unit below and above its ceiling. Start `cancel-long-run.cir`, terminate that Worker, record `cancelReadyMs` until the controller can accept a new run (must be ≤500 ms), then create a new generation and prove divider succeeds without imposing a 500 ms solve-time limit. Instantiate separately with wrong expected module hash, WASM hash, version, result transport and engine build and capture `ENGINE_MODULE_HASH_MISMATCH`, `ENGINE_HASH_MISMATCH`, `ENGINE_VERSION_MISMATCH`, `ENGINE_TRANSPORT_MISMATCH` and `ENGINE_BUILD_MISMATCH`; the wrong module source fixture itself must fail at build time before this runtime handshake. Its only message boundary is:

```ts
type QualificationRequest = { type: "run-qualification"; wasmSha256: string };
type QualificationResponse =
  | { type: "qualification-complete"; result: QualificationResult }
  | { type: "qualification-failed"; code: string; message: string };
```

`client/src/qualification.ts` creates the Worker and assigns one promise to `window.__qualificationResult`; it must not import React or application state.

Add `qualification.html` as a Vite build input. Serve the built qualification page with this minimum response header in all three browser projects: `Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'`. Do not loosen it unless a recorded browser failure identifies the exact directive.

- [ ] **Step 5: Run the qualification in all engines and inspect cleanup/network evidence**

Run:

```powershell
pnpm exec playwright install chromium firefox webkit
node --test tests/release/ngspice-assets.test.mjs
pnpm build
pnpm exec playwright test tests/browser/ngspice-qualification.spec.ts --reporter=line
```

Expected: exactly 3 passed, one per configured Playwright project. If any browser, numerical fixture, repeat, cancellation/rebuild, model load, cleanup, hash/version, CSP, runtime ceiling or source-license check fails, update `04-progress.md` with the evidence and stop the entire implementation; do not continue with a different solver or main-thread fallback.

- [ ] **Step 6: Record the gate and commit**

Write exact versions, hashes, browser versions and numerical results to `05-verification.md`, then run:

```powershell
git add package.json pnpm-lock.yaml playwright.config.ts vite.config.ts scripts/verify-ngspice-assets.mjs client/qualification.html client/src/qualification.ts client/src/simulation/qualified-vectors.mjs client/src/simulation/qualified-vectors.d.mts tests/browser tests/release/ngspice-assets.test.mjs vendor/ngspice docs/2026-08-28-circuit-simulator-modernization/04-progress.md docs/2026-08-28-circuit-simulator-modernization/05-verification.md
git commit -m "build: qualify pinned ngspice wasm runtime"
```

Expected: one commit containing only engine qualification and its evidence.

### Task 2: Remove Credential, Telemetry, Proxy, and Server Scaffolding

**Behavior:** 本地开发、构建和浏览器操作不再采集日志、调用 Forge/OAuth/analytics 或依赖 Express；源码包不含私有配置。

**Files:**
- Delete after credential rotation confirmation: `.project-config.json`
- Delete: `client/public/__manus__/`
- Delete: `client/src/components/Map.tsx`
- Delete: `client/src/components/ManusDialog.tsx`
- Delete: `client/src/const.ts`
- Delete: `client/src/components/ui/`
- Delete: `client/src/hooks/`
- Delete: `shared/`
- Delete: `server/`
- Delete: `template.json`
- Delete: `components.json`
- Delete: `patches/wouter@3.7.1.patch`
- Modify: `client/index.html`
- Modify: `client/src/index.css`
- Modify: `client/src/App.tsx`
- Modify: `client/src/pages/NotFound.tsx`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.gitignore`
- Modify: `tsconfig.json`
- Modify: `.github/workflows/quality.yml`
- Create: `.node-version`
- Create: `.gitattributes`
- Create: `scripts/verify-release-hygiene.mjs`
- Create: `tests/release/hygiene.test.mjs`
- Create: `tests/browser/no-business-network.spec.ts`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- Produces scripts: `dev`, `build`, `preview`, `start`, `check`, `test`, `test:browser`, `format`, `format:check`, `release:hygiene`.
- Produces `verifyReleaseHygiene(root): Promise<HygieneReport>` for forbidden files/vendor references only; gitleaks remains the sole secret-shape scanner. Reports contain rule, path and count, never matched source text.
- Produces a Vite-only static application. `start` is the cross-platform alias for `vite preview --host 127.0.0.1 --port 4173 --strictPort`.
- Keeps for now: React, wouter, lucide-react, sonner, zod and files still used by legacy pages.

- [ ] **Step 1: Add a browser test that fails on business-network requests**

```ts
// tests/browser/no-business-network.spec.ts
import { expect, test } from "@playwright/test";

test("startup sends no business or cross-origin request", async ({ context, page }) => {
  const forbidden: string[] = [];
  context.on("request", request => {
    const url = new URL(request.url());
    const allowedStatic = /^(?:\/|\/assets\/[^?#]+|\/vendor\/ngspice\/[^?#]+|\/manifest\.webmanifest|\/sw\.js)$/;
    if (
      url.origin !== "http://127.0.0.1:4173" ||
      !["GET", "HEAD"].includes(request.method()) ||
      !allowedStatic.test(url.pathname)
    ) {
      forbidden.push(`${request.resourceType()} ${url.origin}${url.pathname}`);
    }
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(forbidden).toEqual([]);
});
```

Run this test against `pnpm build` plus strict preview, not Vite dev. The final release suite reuses the context-wide recorder for simulation, save, import/export and lesson completion. Cross-origin and every non-GET/HEAD request fail; same-origin fetch is allowed only for paths proven to be build-manifest static documents/assets, Worker/WASM, manifest or Service Worker—not `/api` or arbitrary endpoints.

- [ ] **Step 2: Run the test and capture the current failure**

Run:

```powershell
pnpm exec playwright test tests/browser/no-business-network.spec.ts --project=chromium
```

Expected: FAIL with the current analytics/debug request recorded; malformed analytics URLs also count as failure.

- [ ] **Step 3: Add a redacted release-hygiene check, then delete the unwanted paths**

Use Node's test runner so this release check does not create another test framework. The fixture contains a fake marker and asserts that the path/rule are reported while the marker value is absent from stdout:

```js
// tests/release/hygiene.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { scanText } from "../../scripts/verify-release-hygiene.mjs";

test("reports a forbidden vendor reference without echoing source text", () => {
  const source = "load https://example.invalid/__manus__/debug.js";
  const report = scanText("fixture.txt", source);
  assert.equal(report.findings.length, 1);
  assert.equal(JSON.stringify(report).includes(source), false);
});
```

Run `node --test tests/release/hygiene.test.mjs`; expect RED because the script does not exist. Implement the scanner with `node:fs/promises` and a fixed forbidden path/reference list for Manus, Forge, analytics, collectors, server/proxy and remote fonts. It must skip `.git`, dependency caches and generated `dist`, and it must never read or print `.project-config.json` contents. Do not duplicate gitleaks rules. Then delete the listed generator, proxy, server, template UI, hook and patch paths. Remove `package.json.pnpm.patchedDependencies` and `package.json.pnpm.overrides` with the wouter patch.

- [ ] **Step 4: Reduce Vite to native plugins and repair every surviving caller**

`vite.config.ts` must import only `path`, `defineConfig`, React and Tailwind at this stage:

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "client", "src") } },
  root: path.resolve(import.meta.dirname, "client"),
  build: { outDir: path.resolve(import.meta.dirname, "dist", "public"), emptyOutDir: true },
  server: { host: "127.0.0.1", port: 3000, strictPort: true },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    headers: {
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'",
    },
  },
});
```

Remove the analytics script and generator comment from `client/index.html`. Remove Google Fonts and `tw-animate-css` from `client/src/index.css` and use a system font stack. Import `Toaster` directly from `sonner` in `App.tsx`, remove `TooltipProvider`, and replace `NotFound.tsx` template controls with semantic native elements before deleting `components/ui`. Do not delete active legacy pages/solvers in this task.

- [ ] **Step 5: Make install, typecheck and static serving reproducible**

Set `.node-version` to the verified exact runtime `24.15.0`, `package.json.engines.node` to `24.15.0`, `@types/node` to the matching 24 line, and preserve exact `packageManager: pnpm@10.4.1`. Set `.gitattributes` to force LF for source, JSON, Markdown, `.cir`, `.lib`, `.model`, `.mjs` and `.wasm.sha256` text metadata so canonical netlist/hash fixtures do not vary on Windows. Change `build` to `vite build`, and set `start`/`preview` to strict Vite preview without POSIX environment assignment. Remove test/config exclusions from `tsconfig.json`; typecheck client, tests, Worker, Vite and Playwright configuration. Pin CI through `node-version-file: .node-version` and pnpm 10.4.1.

Document in `README.md` or the deployment section of `04-progress.md` that production static hosting must rewrite `/project/*`, `/learn/*`, `/settings` and legacy pretty paths to `index.html`; Vite preview fallback is not evidence that an arbitrary host is configured correctly.

Run:

```powershell
corepack pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm exec playwright test tests/browser/no-business-network.spec.ts --project=chromium
```

Expected: all pass; `dist/public/__manus__` and `dist/index.js` do not exist.

- [ ] **Step 6: Verify local hygiene without overstating remote cleanup**

Run:

```powershell
gitleaks detect --no-git --source . --redact
git ls-files | Select-String -Pattern '^\.project-config\.json$|__manus__|template\.json|^server/'
pnpm release:hygiene
pnpm audit --prod --json | Out-File -LiteralPath "$env:TEMP\fluxlab-audit-task2.json" -Encoding utf8
$task2AuditExit = $LASTEXITCODE
$global:LASTEXITCODE = 0
```

Expected: local hygiene/gitleaks scans exit 0 and tracked-path search returns no lines. Record `$task2AuditExit` plus counts/direct dependency paths from the temporary JSON in `05-verification.md`, then remove that temporary file; this transitional evidence capture deliberately resets only that command's exit code. Record remote Git history, old ZIP/source archives and release assets as **unverified** until the authoritative repository owner supplies separate redacted evidence of rotation and cleanup; a clean current tree does not prove those locations are clean. Production high becomes a hard zero gate in the final CI/release task.

- [ ] **Step 7: Update progress and commit the bounded cleanup**

```powershell
git add -A
git commit -m "chore: remove hosted template and telemetry runtime"
```

Expected: no credential value appears in commit output or documentation.

## Phase 2 — Establish One Versioned Project

### Task 3: Define Typed Project Contracts, Canonical Hashing, and Trust-Boundary Schema

**Behavior:** 一个 v2 项目可以被严格解析；非法单位、非有限数、错误 source waveform、未知字段、错误引用形状和超限结构得到稳定诊断，而不是渲染期异常。

**Files:**
- Create: `client/src/domain/project/project-v2.ts`
- Create: `client/src/domain/project/canonical.ts`
- Create: `client/src/domain/project/project-schema.ts`
- Create: `client/src/domain/project/project-schema.test.ts`
- Create: `client/src/simulation/contracts.ts`
- Create: `tests/fixtures/circuits/projects.ts`
- Modify: `tsconfig.json`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`

**Interfaces:**
- `project-v2.ts` exports persistent IDs, project/component/model/analysis/probe/assertion/corner/note/layout contracts, the shared `AxisUnit`/`ResultUnit` vocabulary and `Diagnostic` from design §§4, 7.1 and 8.
- `simulation/contracts.ts` imports only from `project-v2.ts` and exports engine, Worker, result axis/vector/snapshot, failure, assertion result/evaluation and run contracts from design §§7.2–7.4 and 8.2. `project-v2.ts` never imports `simulation/contracts.ts`.
- `Diagnostic.location` has optional typed `componentId/wireId/modelId/analysisId/probeId/assertionId/cornerId/runId/sourceName/field/line/endLine`; continued SPICE statements carry source/model identity plus their full physical line range, so panels can navigate without parsing message text.
- `DomainResult<T> = { ok: true; value: T; diagnostics: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[] }` is the one shared success/failure result; success diagnostics may contain non-blocking warnings.
- `parseCircuitProjectV2(input: unknown): DomainResult<CircuitProjectV2>`.
- `canonicalJson(value: unknown): string` sorts object keys recursively and preserves array order.
- `sha256Hex(value: string | Uint8Array): Promise<string>` uses `crypto.subtle.digest("SHA-256", ...)`.
- `hashCanonical(value: unknown): Promise<string>` composes the previous two functions.

- [ ] **Step 1: Write failing schema and canonicalization tests**

```ts
// client/src/domain/project/project-schema.test.ts
import { describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../../tests/fixtures/circuits/projects";
import { canonicalJson } from "./canonical";
import { parseCircuitProjectV2 } from "./project-schema";

describe("CircuitProjectV2 trust boundary", () => {
  it("accepts a divider fixture and canonicalizes key order", () => {
    expect(parseCircuitProjectV2(dividerProjectFixture()).ok).toBe(true);
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
  });

  it("rejects non-finite SI values and an invalid PULSE period", () => {
    const project = dividerProjectFixture();
    project.schematic.components[0] = {
      id: "V1",
      refdes: "V1",
      kind: "voltageSource",
      params: {
        dcV: Number.NaN,
        transient: { kind: "pulse", initialV: 0, pulsedV: 5, delayS: 0, riseS: 1, fallS: 1, widthS: 2, periodS: 3 },
      },
    };
    const result = parseCircuitProjectV2(project);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map(item => item.code)).toEqual(["SCHEMA_NON_FINITE", "SCHEMA_BAD_PULSE"]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify missing modules fail**

Run:

```powershell
pnpm vitest run client/src/domain/project/project-schema.test.ts
```

Expected: FAIL because the project modules do not exist.

- [ ] **Step 3: Add the exact approved discriminated contracts**

Copy the approved field names and unions from design §§4, 7 and 8 without aliases such as generic `params: Record<string, unknown>`. Keep project types in `project-v2.ts`; import them into `simulation/contracts.ts` so UI files never declare competing shapes. Export `Diagnostic` once from `project-v2.ts`. `ResultTransport = "vector-callback" | "binary-rawfile"` is part of `EngineFingerprint`; `RuntimeLimits` has separate `maxRawResultBytes` and `maxSnapshotTransferBytes`, never one ambiguous transfer ceiling.

The parser result remains a discriminated union:

```ts
export type DomainResult<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

export function parseCircuitProjectV2(input: unknown): DomainResult<CircuitProjectV2> {
  const parsed = circuitProjectV2Schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data, diagnostics: [] };
  return { ok: false, diagnostics: zodIssuesToDiagnostics(parsed.error.issues) };
}
```

Use `.strict()` at object boundaries. Every persistent ID/key used in a `Record` is 1–128 ASCII characters matching `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` and must not equal `__proto__`, `prototype` or `constructor` case-insensitively. Emitted component refdes are 1–32 ASCII characters matching `^[A-Za-z][A-Za-z0-9_]{0,31}$`; their first letter must match the concrete device family `R/C/L/V/I/S/D/Q/M/X` case-insensitively, while the non-emitted ground component uses exactly `GND`. Refdes uniqueness, sorting and lookup use one uppercase normalization because ngspice treats `R1` and `r1` as the same symbol. Model/subcircuit symbols and raw SPICE node/pin tokens are 1–64 ASCII characters matching `^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$`, so common names such as `1N4148` and numeric nodes/pins remain legal. Parameter names match `^[A-Za-z_][A-Za-z0-9_]{0,63}$`; persisted project net labels match `^[A-Za-z_][A-Za-z0-9_]{0,79}$`. Comparisons use uppercase canonical names. These token allowlists exclude whitespace, controls, quotes, parentheses, comment/command characters, path separators and leading dot directives and are shared by Task 4 and defensively rechecked by Task 8. Add refinements for finite/positive SI values, PULSE/SIN/PWL rules, AC/DC/transient ranges, unique IDs/refdes, model/subcircuit interfaces and project byte/count limits. V/I `dcV/dcA` is optional only to preserve imported transient-source semantics; every source must still contain at least one of DC/AC/transient, and all newly created templates/UI sources write an explicit zero DC by default. Connectivity and ERC remain outside the schema. Add hostile JSON cases for newline/space/leading-dot refdes, wrong family prefix, case-only duplicate refdes, malicious model/subcircuit/pin/parameter/net tokens and all three prototype keys; none may reach graph or compiler.

- [ ] **Step 4: Implement canonical JSON and Web Crypto hashing**

```ts
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Canonical JSON requires finite numbers");
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Canonical JSON does not support undefined");
  return encoded;
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
```

Add tests proving objects with different insertion order hash equally and arrays with different order do not.

- [ ] **Step 5: Run changed behavior, then the shared-contract regression suite**

Run in order:

```powershell
pnpm vitest run client/src/domain/project/project-schema.test.ts
pnpm check
pnpm test
```

Expected: focused test passes; then strict typecheck and the inexpensive existing suite pass. A schema/protocol change justifies the full unit suite here.

- [ ] **Step 6: Update progress and commit**

```powershell
git add client/src/domain/project client/src/simulation/contracts.ts tests/fixtures/circuits/projects.ts tsconfig.json docs/2026-08-28-circuit-simulator-modernization/04-progress.md
git commit -m "feat: define versioned circuit project contracts"
```

Expected: contract commit contains no UI or solver behavior.

### Task 4: Enforce One SPICE Source Allowlist Before Any Model Exists

**Behavior:** 用户网表、项目模型、内置模型、迁移文本和运行前重读模型全部使用同一个续行安全解析器；未知或危险语句使整个来源失败，不会被静默丢弃。

**Files:**
- Create: `client/src/simulation/spice-source-parser.ts`
- Create: `client/src/simulation/spice-source-parser.test.ts`
- Create: `tests/fixtures/netlists/allowed-circuit.cir`
- Create: `tests/fixtures/netlists/allowed-model.lib`
- Create: `tests/fixtures/netlists/continued-directive-bypass.cir`
- Create: `tests/fixtures/netlists/forbidden-control.cir`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`

**Interfaces:**
- Consumes: `DomainResult<T>` and `Diagnostic` from Task 3.
- Produces: `parseAndValidateSpiceSource(source, origin, mode): Promise<DomainResult<ParsedSpiceSource>>`.
- Produces: `validateProjectModels(project, origin, bundledManifest): Promise<DomainResult<CircuitProjectV2>>`; it parses every source, recomputes the normalized hash, cross-checks declared metadata and verifies any `origin: "bundled"` claim against an immutable manifest entry.
- `origin` is exactly `"user-cir" | "project-model" | "bundled-model" | "migration" | "stored-model"`; `mode` is exactly `"editable-circuit" | "opaque-model"`.
- No later task may tokenize, normalize or approve SPICE text independently.

- [ ] **Step 1: Write the failing continuation and allowlist tests**

```ts
import { describe, expect, it } from "vitest";
import { parseAndValidateSpiceSource } from "./spice-source-parser";

describe("SPICE source trust boundary", () => {
  it("cannot hide a forbidden directive in a continuation", async () => {
    const result = await parseAndValidateSpiceSource(
      ".model DLED D(IS=1e-12)\r\n+ .shell touch owned",
      "project-model",
      "opaque-model",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "SPICE_FORBIDDEN_DIRECTIVE",
        location: { line: 1, endLine: 2 },
      });
    }
  });

  it("preserves declared subcircuit pin and parameter order", async () => {
    const result = await parseAndValidateSpiceSource(
      ".subckt FILTER IN OUT PARAMS: R=1k C=1u\nR1 IN OUT {R}\n.ends FILTER",
      "bundled-model",
      "opaque-model",
    );
    expect(result.ok && result.value.subcircuits[0]).toMatchObject({
      name: "FILTER",
      orderedPins: ["IN", "OUT"],
      parameterNames: ["R", "C"],
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm exec vitest run client/src/simulation/spice-source-parser.test.ts
```

Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Implement physical-line normalization and the explicit result shape**

```ts
export type SpiceSourceOrigin =
  | "user-cir"
  | "project-model"
  | "bundled-model"
  | "migration"
  | "stored-model";

export type SpiceSourceMode = "editable-circuit" | "opaque-model";

export interface ParsedSpiceStatementBase {
  text: string;
  startLine: number;
  endLine: number;
  scope: { kind: "top-level" } | { kind: "subcircuit"; name: string };
}

export type ParsedSpiceValue =
  | { kind: "finite-number"; sourceToken: string; valueSI: number }
  | { kind: "parameter-reference"; sourceToken: string; name: string };

export type ParsedSpiceElement =
  | (ParsedSpiceStatementBase & { kind: "element"; device: "R" | "C" | "L"; name: string; positiveNode: string; negativeNode: string; value: ParsedSpiceValue })
  | (ParsedSpiceStatementBase & { kind: "element"; device: "V" | "I"; name: string; positiveNode: string; negativeNode: string; source: ParsedIndependentSource })
  | (ParsedSpiceStatementBase & { kind: "element"; device: "S"; name: string; positiveNode: string; negativeNode: string; controlPositiveNode: string; controlNegativeNode: string; modelName: string })
  | (ParsedSpiceStatementBase & { kind: "element"; device: "D"; name: string; anodeNode: string; cathodeNode: string; modelName: string; area?: ParsedSpiceValue })
  | (ParsedSpiceStatementBase & { kind: "element"; device: "Q"; name: string; collectorNode: string; baseNode: string; emitterNode: string; substrateNode?: string; modelName: string; area?: ParsedSpiceValue })
  | (ParsedSpiceStatementBase & { kind: "element"; device: "M"; name: string; drainNode: string; gateNode: string; sourceNode: string; bulkNode: string; modelName: string; length: ParsedSpiceValue; width: ParsedSpiceValue; multiplicity?: ParsedSpiceValue })
  | (ParsedSpiceStatementBase & { kind: "element"; device: "X"; name: string; orderedNodes: string[]; subcircuitName: string; orderedOverrides: ParsedParameterAssignment[] });

export type ParsedSpiceStatement =
  | (ParsedSpiceStatementBase & { kind: "title" | "terminator" | "comment" })
  | ParsedSpiceElement
  | (ParsedSpiceStatementBase & { kind: "analysis"; analysis: ParsedAnalysisDirective })
  | (ParsedSpiceStatementBase & { kind: "model"; name: string; family: SpiceDeviceFamily; orderedParameters: ParsedParameterAssignment[] })
  | (ParsedSpiceStatementBase & { kind: "subckt-start"; name: string; orderedPins: string[]; orderedDefaults: ParsedParameterAssignment[] })
  | (ParsedSpiceStatementBase & { kind: "subckt-end"; name?: string })
  | (ParsedSpiceStatementBase & { kind: "parameter"; orderedAssignments: ParsedParameterAssignment[] });

export type ParsedDeclarationBlock =
  | { kind: "model"; name: string; family: SpiceDeviceFamily; startLine: number; endLine: number; normalizedSource: string }
  | {
      kind: "subcircuit";
      interface: SubcircuitInterface;
      startLine: number;
      endLine: number;
      normalizedSource: string;
      statements: ParsedSpiceStatement[];
      externalModelNames: string[];
      externalSubcircuitNames: string[];
    };

export interface ParsedSpiceSource {
  normalizedSource: string;
  statements: ParsedSpiceStatement[];
  declarationBlocks: ParsedDeclarationBlock[];
  models: Array<{ name: string; family: SpiceDeviceFamily }>;
  subcircuits: SubcircuitInterface[];
  utf8Bytes: number;
  sha256: string;
}

export async function parseAndValidateSpiceSource(
  source: string,
  origin: SpiceSourceOrigin,
  mode: SpiceSourceMode,
): Promise<DomainResult<ParsedSpiceSource>>;
```

`ParsedIndependentSource` exactly mirrors the V2 V/I source contract: finite optional `dc`, optional AC magnitude/phase, and at most one transient discriminated form `pulse | sin | pwl`; combinations legal in V2 remain legal in the AST. A top-level V/I statement with no DC/AC/transient term is legal and remains explicitly empty in the AST so Task 18 applies the one normative empty/AC-only `dc = 0` normalization; a transient-only source keeps `dc` absent so ngspice may use the waveform time-zero value. `ParsedAnalysisDirective` is a discriminated union for `.op`, `.dc`, `.tran` and `.ac` with already parsed finite SI fields, sweep source/mode and integer point count; `ParsedParameterAssignment` preserves name, source order and a `ParsedSpiceValue`. The only numeric grammar is a fully consumed signed decimal with optional exponent and at most one case-insensitive ngspice suffix: `T=1e12`, `G=1e9`, `MEG=1e6`, `K=1e3`, `M=1e-3`, `U=1e-6`, `N=1e-9`, `P=1e-12`, `F=1e-15`, `MIL=25.4e-6`; longest suffix matches first. Reject trailing letters, locale comma, hex, `NaN/Inf`, overflow and nonzero underflow-to-zero. Before tokenization reject BOM, NUL, DEL, C1 and every C0 control except TAB/LF; normalize CRLF and standalone CR to LF with physical line mapping, then require each physical and joined logical statement to be at most 65,536 UTF-8 bytes. Join a line whose first non-space character is `+` to its predecessor, then classify and fully parse the logical statement into this AST. Reject an orphan continuation. Hash the normalized UTF-8 bytes with Task 3's `sha256Hex` only after every byte/line/statement check passes.

The discriminated element union owns every positional field, arity and default input; no consumer may infer D/Q area, Q substrate, M L/W/M, X overrides or source forms from `text`. `scope` is assigned while pairing subcircuits, and nested/unpaired blocks fail. `declarationBlocks` contains canonical LF source slices and already grouped statements for each top-level `.model` or complete `.subckt/.ends`; dependency lists name only references not declared inside that subcircuit block. Top-level editable R/C/L values must be finite; D/Q accept optional positive area, M requires explicit positive L/W and accepts optional positive multiplicity, while parameter references are legal only inside allowed subcircuit scope. There is no generic component shape whose optional fields or original text require later tokenization.

- [ ] **Step 4: Implement the two exact mode allowlists**

`editable-circuit` accepts one optional first non-comment title record, comments, R/C/L/V/I/S/D/Q/M/X, `.model`, paired `.subckt/.ends`, `.op/.dc/.tran/.ac`, and one optional `.end` that must be the final non-comment logical line. Title and terminator are metadata; import maps neither to a component, and export emits its own title/`.end` exactly once. `opaque-model` accepts comments, `.model`, paired `.subckt/.ends`, supported elements inside a subcircuit, and finite numeric `.param`/`PARAMS:` defaults. Apply Task 3's exact ASCII token limits while building the AST to every refdes, raw node/pin, project label, model/subcircuit name and parameter name; no parser mode may preserve an unsafe token for later emission. A switch-family `.model` must expose finite `VT/VH`, positive `RON/ROFF`, and `ROFF > RON`; missing or invalid values fail. Both modes reject `.control/.endc`, `.shell`, `.include`, `.lib`, paths, command substitution, user `.options/.save/.print/.plot/.measure`, unsupported IC/OFF/UIC tokens and every unknown dot directive. Emit one diagnostic per rejected logical statement with `line/endLine`; return `ok: false` if any exist. Add every numeric suffix/case/boundary plus `10kgarbage`, comma, non-finite/overflow/underflow fixtures; NUL/BOM/C0/C1, standalone-CR mapping, overlong physical/continued logical-line and hostile symbol fixtures proving failure occurs before hashing or any Worker FS call. Add AST field tests for every element family; V/I absent source/DC plus DC, PULSE, SIN, PWL and combined AC magnitude/phase; D/Q omitted/explicit area; M required L/W and omitted/explicit M; all four analyses including zero/multiple directives; numeric `.subckt` pins, model/subcircuit bindings, scope and parameter order; plus title + `.end` round-trip and misplaced/duplicate `.end` tests.

Implement `validateProjectModels` in this file rather than creating a second validator. Within every source/bundle, `.model` symbols and `.subckt` symbols are each unique case-insensitively; `.model D` plus `.model d` is rejected even when text/hash come from one file, so ngspice's last-definition behavior can never select a winner. For `spice-model`, require exactly one parsed `.model` and exact case-insensitive name plus exact `SpiceDeviceFamily`; for `spice-subckt`, require all declared interfaces, pins, parameter order and defaults to equal parser output. Require `ModelDefinition.sha256` to equal the parser's normalized-source hash. An `origin: "bundled"` model must exactly match the supplied manifest's model ID, hash, kind/family/interfaces and license metadata; an absent/mismatched claim fails rather than gaining bundled trust. On success return a clone whose only rewrite is `source = parsed.normalizedSource` (LF); names, family, interfaces, defaults and hash must already agree and are never silently repaired. Add case-only duplicate `.model` and `.subckt` fixtures.

- [ ] **Step 5: Run changed behavior and bypass fixtures**

```powershell
pnpm exec vitest run client/src/simulation/spice-source-parser.test.ts
```

Expected: legal R/C/L/V/I/S/D/Q/M/X and paired model/subcircuit fixtures pass; every forbidden and continuation-bypass fixture fails with stable physical ranges; source/hash/name/family/interface drift fails; zero unknown lines disappear silently.

- [ ] **Step 6: Record the trust-boundary contract and commit**

```powershell
git add client/src/simulation/spice-source-parser.ts client/src/simulation/spice-source-parser.test.ts tests/fixtures/netlists docs/2026-08-28-circuit-simulator-modernization/04-progress.md
git commit -m "feat: enforce one spice source allowlist"
```

### Task 5: Create Honest V2 Templates and Explicit V1 Migration

**Behavior:** 新建 divider、RC、LED 项目得到可验证 v2 事实；旧 v1 数据只形成预览候选，保留可保留的 ID/布局，明确丢弃旧结果、门禁、完成标记及无法表达的伪初态。

**Files:**
- Create: `client/src/domain/project/templates.ts`
- Create: `client/src/domain/project/templates.test.ts`
- Create: `client/src/domain/project/bundled-models.ts`
- Create: `client/src/domain/project/bundled-models.test.ts`
- Create: `client/src/legacy/v1-types.ts`
- Create: `client/src/domain/project/migrate-v1.ts`
- Create: `client/src/domain/project/migrate-v1.test.ts`
- Create: `tests/fixtures/migrations/divider-v1.json`
- Create: `tests/fixtures/migrations/rc-v1.json`
- Create: `tests/fixtures/migrations/led-v1.json`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`

**Interfaces:**
- Consumes: `parseAndValidateSpiceSource/validateProjectModels` from Task 4; bundled and migrated model text has no bypass.
- `BUNDLED_MODEL_MANIFEST` is an append-only compatibility ledger containing exact model ID, normalized SHA-256, normalized source, model kind/family or interfaces, license note and source-module version. Only entries in this manifest may carry `origin: "bundled"`; once released, an `(id, hash, metadata, source)` entry is never edited or removed.
- `CURRENT_BUNDLED_MODEL_KEYS` is the separate template registry selecting current append-only entries. A revised model receives a new versioned `modelId`/manifest entry; it never reuses an old ID.
- `createDividerTemplate(projectId, createdAt): Promise<DomainResult<CircuitProjectV2>>` uses 9 V, 1 kΩ, 2 kΩ and a Vout probe.
- `createRcTemplate(projectId, createdAt): Promise<DomainResult<CircuitProjectV2>>` uses a real PULSE voltage source, 5 V, 10 kΩ, 100 μF and transient analysis; it stores no C/L IC or switch mode.
- `createLedTemplate(projectId, createdAt): Promise<DomainResult<CircuitProjectV2>>` uses 5 V, 680 Ω and a bundled LED diode model so its initial current is outside 8–12 mA.
- `migrateV1CircuitDocument(input, options): Promise<MigrationResult>` returns a preview candidate or a structural rejection and never persists.

- [ ] **Step 1: Write failing template and migration tests**

```ts
import { describe, expect, it } from "vitest";
import legacyDivider from "../../../../tests/fixtures/migrations/divider-v1.json";
import { migrateV1CircuitDocument } from "./migrate-v1";
import { createLedTemplate } from "./templates";

describe("v2 templates and migration", () => {
  it("does not ship a pre-completed LED lesson", async () => {
    const result = await createLedTemplate("led-a", "2026-08-28T00:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resistor = result.value.schematic.components.find(item => item.id === "R1");
    expect(resistor?.params).toEqual({ resistanceOhm: 680 });
    expect(result.value.learning).toBeUndefined();
  });

  it("preserves divider ids/layout and discards legacy evidence", async () => {
    const result = await migrateV1CircuitDocument(legacyDivider, {
      projectId: "migrated-a",
      migratedAt: "2026-08-28T00:00:00.000Z",
    });
    expect(result.kind).toBe("candidate");
    if (result.kind === "candidate") {
      expect(result.project.layout.components.R1.x).toBe(490);
      expect(result.project.schematic.components.some(item => item.id === "R1")).toBe(true);
      expect("learning" in result.project).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

```powershell
pnpm vitest run client/src/domain/project/templates.test.ts client/src/domain/project/bundled-models.test.ts client/src/domain/project/migrate-v1.test.ts
```

Expected: FAIL because templates and migration do not exist.

- [ ] **Step 3: Implement deterministic templates with fixed IDs**

Use fixed IDs (`V1`, `R1`, `R2`, `C1`, `D1`, `GND`, stable wire/probe/analysis/assertion IDs) inside each new project. Only project ID and timestamps are caller inputs. RC charge behavior must be represented by source waveform/topology, not a mode field. LED and migration switch models must pass Task 4 with origin `bundled-model`, mode `opaque-model`, and exact `BUNDLED_MODEL_MANIFEST` match before a template/candidate may be returned. Test that a self-consistent attacker model claiming `origin: "bundled"` is rejected. Add a manifest compatibility fixture with old and new model versions: the current template selects the new ID, while a stored/`.fluxproj` project referencing the released old ID/source still validates byte-for-byte. A future implementation that deletes or mutates the old entry must fail the test; any deliberate conversion instead creates an explicit user-import migration preview and never silently rewrites source during load.

- [ ] **Step 4: Implement migration as preview-only data conversion**

```ts
export type MigrationResult =
  | {
      kind: "candidate";
      project: CircuitProjectV2;
      diagnostics: Diagnostic[];
      sourceVersion: 1;
      discardedEvidence: true;
    }
  | { kind: "rejected"; diagnostics: Diagnostic[] };

export async function migrateV1CircuitDocument(
  input: unknown,
  options: { projectId: ProjectId; migratedAt: string },
): Promise<MigrationResult>;
```

Map `top/bottom` by component family, move `x/y` to layout, preserve non-conflicting IDs and convert legacy probe components to `ProbeDefinition`. Never migrate v1 run results, `learning-progress`, static gates, fixed LED voltage as an accuracy promise, `initialValue`, `closed` or `switchMode`. A v1 RC switch still returns `kind: "candidate"`: map the old conduction pins to `p/n`, leave required control pins `cp/cn` visibly unconnected, reference a Task 4-validated bundled migration switch model, and include a `blocksRun: true` diagnostic whose exact code is `MIGRATION_SWITCH_REQUIRES_REWIRE`. It is neither rejected nor silently rewritten into a fabricated PULSE circuit; after save, Task 7 ERC preserves the blocker as floating required control pins until the user rewires it. Every model text produced during migration passes Task 4 with origin `migration`. Unknown version, missing arrays and non-finite data return `rejected`.

For every `ModelDefinition`, cross-check declaration metadata against Task 4 output before returning a candidate: `spice-model` must contain exactly one `.model` whose name and precise `SpiceDeviceFamily` equal `modelName/deviceFamily`; `spice-subckt.interfaces` must equal all parsed interfaces in stable source order. Source hash must equal the normalized parser hash. Metadata/source drift is a blocking failure.

- [ ] **Step 5: Run changed behavior and migration robustness**

```powershell
pnpm vitest run client/src/domain/project/templates.test.ts client/src/domain/project/bundled-models.test.ts client/src/domain/project/migrate-v1.test.ts
```

Expected: divider, LED and old RC fixtures produce candidates; append-only old/new bundled model entries both validate while a forged bundled claim fails; RC carries `MIGRATION_SWITCH_REQUIRES_REWIRE` with `blocksRun: true`; malformed/unknown input is rejected without throwing.

- [ ] **Step 6: Commit templates and migration**

```powershell
git add client/src/domain/project client/src/legacy tests/fixtures/migrations docs/2026-08-28-circuit-simulator-modernization/04-progress.md
git commit -m "feat: add v2 templates and explicit legacy migration"
```

### Task 6: Implement Revision-Safe Commands, IndexedDB, and the First Real Project Journey

**Behavior:** 用户从 `/` 创建一个 v2 分压项目，进入 `/project/:projectId`，修改布局或电气参数后得到正确修订号，刷新仍恢复同一项目；坏存储记录只显示诊断，不使页面白屏。

**Files:**
- Create: `client/src/features/editor/project-reducer.ts`
- Create: `client/src/features/editor/project-reducer.test.ts`
- Create: `client/src/features/editor/SchematicCanvas.tsx`
- Create: `client/src/features/editor/PropertiesPanel.tsx`
- Create: `client/src/storage/indexeddb.ts`
- Create: `client/src/storage/indexeddb.test.ts`
- Create: `client/src/app/routes.tsx`
- Create: `client/src/app/SettingsPage.tsx`
- Create: `client/src/features/project-library/ProjectLibrary.tsx`
- Create: `client/src/app/ProjectWorkspace.tsx`
- Create: `tests/browser/project-persistence.spec.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/main.tsx`
- Modify: `client/src/index.css`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- `applyProjectCommand(project, command, changedAt): DomainResult<CircuitProjectV2>` is the only synchronous project mutation function; callers inject the ISO timestamp so tests never depend on wall-clock timing. Model editors must await Task 4 validation before dispatch, and storage validates the complete project again before writing.
- `projectReducer(state, action): ProjectEditorState` maintains at most 50 immutable past states.
- `listProjects()`, `loadProject(projectId)`, `saveProject(expectedRevision, project)` and `deleteProject(projectId)` use one native `fluxlab` IndexedDB database. Run accessors are added only after their schema in Task 11; lesson-evidence accessors wait for Task 17.
- IndexedDB stores: `projects`, `runSequences`, `runs`, `lessonEvidence`, `settings` with schema version 1. Their key paths/indexes are created once here exactly as specified in design §9.1, even when the validated accessors arrive in later tasks.
- `client/src/storage/indexeddb.ts` is the sole owner of native database access, all stored-envelope parsers/derivers and every cross-store write/delete transaction. It exports only domain-specific APIs; raw store/transaction helpers remain private.
- `parseStoredSettingEnvelope(input): DomainResult<StoredSettingEnvelope>`, `deriveSettingKey(value): string` and `deriveSettingProjectKey(value): readonly [ProjectId, string] | undefined` are the only setting schema/key implementation. The fixed mappings are `local-settings`, `lesson-session:<lessonId>`, `last-opened-project`, and `legacy-notice:<path>`; parser success requires stored `key`, optional `projectKey`, kind and payload to equal freshly derived values.
- `deleteProject(projectId)` is the only cascade entry from Task 6 onward. Its single transaction deletes the project, sequence, all runs, all lesson evidence and only settings rows reached through `projectKey=[projectId,*]`; later tasks add schema-aware accessors and tests, never another cascade helper.
- `createProjectSaveLane(input): ProjectSaveLane` is the only workspace autosave coordinator; one lane exists per open project and serializes/coalesces revisions.

```ts
export interface ProjectSummary {
  projectId: ProjectId;
  title: string;
  updatedAt: string;
  revision: number;
}

export interface StoredProjectEnvelope {
  envelopeVersion: 1;
  storageVersion: number;
  project: CircuitProjectV2;
  listKey: readonly [updatedAt: string, projectId: ProjectId, title: string, revision: number];
  revisionKey: readonly [projectId: ProjectId, revision: number, electricalRevision: number];
}

export type ProjectSaveState =
  | { status: "saved"; latestRevision: number; persistedRevision: number }
  | { status: "saving" | "dirty"; latestRevision: number; persistedRevision: number }
  | { status: "error"; latestRevision: number; persistedRevision: number; diagnostics: Diagnostic[] };

export interface ProjectSaveLane {
  enqueue(project: CircuitProjectV2): void;
  flush(): Promise<DomainResult<{ persistedRevision: number }>>;
  retry(): void;
  dispose(): void;
}
```

- [ ] **Step 1: Write reducer tests for revision and reference semantics**

```ts
import { describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../../tests/fixtures/circuits/projects";
import { applyProjectCommand } from "./project-reducer";

describe("project commands", () => {
  it("separates layout and electrical revisions", () => {
    const project = dividerProjectFixture();
    const moved = applyProjectCommand(project, {
      type: "layout/componentSet",
      componentId: "R1",
      layout: { x: 510, y: 210, rotation: 0 },
    }, "2026-08-28T00:00:01.000Z");
    expect(moved.ok && [moved.value.revision, moved.value.electricalRevision]).toEqual([2, 1]);
    const changed = moved.ok && applyProjectCommand(moved.value, {
      type: "component/replace",
      component: { id: "R1", refdes: "R1", kind: "resistor", params: { resistanceOhm: 1500 } },
    }, "2026-08-28T00:00:02.000Z");
    expect(changed && changed.ok && [changed.value.revision, changed.value.electricalRevision]).toEqual([3, 2]);
  });

  it("refuses to remove a referenced probe", () => {
    const result = applyProjectCommand(
      dividerProjectFixture(),
      { type: "probe/remove", probeId: "probe-vout" },
      "2026-08-28T00:00:01.000Z",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe("PROJECT_REFERENCE_EXISTS");
  });
});
```

- [ ] **Step 2: Run reducer tests and verify RED**

```powershell
pnpm vitest run client/src/features/editor/project-reducer.test.ts
```

Expected: FAIL because the reducer module is absent.

- [ ] **Step 3: Implement the complete command union and revision matrix**

Use the exact `ProjectCommand` union from design §11. Every accepted non-no-op command increments `revision` once. `component/*`, `wire/*`, `model/*`, `analysis/*`, `probe/*`, `corner/*` also increment `electricalRevision`; project/note/layout/assertion commands do not. Rejected/no-op commands leave the original object and both revisions untouched. Referenced component/model/analysis/probe deletion returns `PROJECT_REFERENCE_EXISTS`; it never cascades.

```ts
export interface ProjectEditorState {
  past: CircuitProjectV2[];
  present: CircuitProjectV2;
  future: CircuitProjectV2[];
  diagnostics: Diagnostic[];
}

export type ProjectEditorAction =
  | { type: "command"; command: ProjectCommand; changedAt: string }
  | { type: "undo"; changedAt: string }
  | { type: "redo"; changedAt: string };
```

Undo/redo restores earlier content but never restores an earlier revision number. Each accepted undo/redo increments the current `revision` once; it increments `electricalRevision` once only when the restored content differs electrically. It sets `updatedAt = changedAt`, clears the opposite history as normal, and a no-op undo/redo leaves revisions untouched. Add focused tests for electrical undo/redo, layout-only undo, no-op actions and the 50-entry cap.

- [ ] **Step 4: Implement native IndexedDB transactions without a wrapper dependency**

```ts
const DATABASE_NAME = "fluxlab";
const DATABASE_VERSION = 1;

export async function saveProject(
  expectedRevision: number | null,
  project: CircuitProjectV2,
): Promise<DomainResult<CircuitProjectV2>>;
export async function loadProject(projectId: ProjectId): Promise<DomainResult<CircuitProjectV2 | null>>;
export async function listProjects(): Promise<DomainResult<ProjectSummary[]>>;
export async function deleteProject(projectId: ProjectId): Promise<DomainResult<null>>;
```

Before opening a write transaction, `saveProject` awaits Task 3 `parseCircuitProjectV2` and Task 4 `validateProjectModels(project, "stored-model", BUNDLED_MODEL_MANIFEST)`, derives the exact `listKey/revisionKey`, and validates the candidate envelope; any failure performs zero IndexedDB writes. The short `readwrite` transaction then performs only IDB requests and synchronous guards: read current envelope, require its project ID/revision to equal `expectedRevision` (or require absence for create), increment `storageVersion`, and `put/add` once. Project creation atomically adds a small `runSequences` row `{ envelopeVersion:1, projectId, nextAttempt:1, storageVersion:1 }`. `deleteProject` opens all five stores once, verifies the target, deletes project/sequence, walks run/evidence/setting project indexes with key cursors and commits or aborts as one unit. Never await Web Crypto, model parsing or another promise inside the active transaction. Resolve only on `transaction.oncomplete`; reject on `onerror/onabort` and map a revision mismatch to `STORAGE_REVISION_CONFLICT`.

The `projects` store uses project ID as primary key and compound `listKey` plus `[projectId,revision,electricalRevision]` indexes. `listProjects` calls the list index's `openKeyCursor`, validates each tuple/primary-key pair and constructs summaries from index keys; it never calls object-store `get/getAll`. `loadProject` may `get` one raw envelope, but first lets the readonly transaction complete and only then awaits full project/model/hash validation and cross-checks both keys; invalid rows return diagnostics while valid library navigation remains available. Create future `runSequences`, `runs`, `lessonEvidence` and `settings` stores/indexes now, including lesson `lessonKey/projectKey/referencedRunIds` and optional setting `projectKey`. Implement the strict setting union parser/derivers now and unit-test every fixed key plus wrong kind/key/projectKey, extra field and malformed payload; expose no generic or unvalidated read/write API. Full-project import replacement is defined in Task 18 so it cannot roll revisions backward here.

- [ ] **Step 5: Serialize and coalesce project saves without stale completion UI**

`ProjectWorkspace` sends every accepted immutable project to one `ProjectSaveLane`. While rev2 is in flight, an arriving rev3 replaces only the not-yet-started pending value. After rev2 commits, the lane advances `persistedRevision=2` but keeps status `saving/dirty` because `latestRevision=3`, then saves rev3 with expected revision 2. If rev2 and rev3 arrive before any write begins, the lane may write rev3 directly with expected persisted rev1. A completion may set `saved` only when its returned revision equals both `persistedRevision` and the lane's current `latestRevision`; an old completion never labels a newer editor state saved. Conflict/write failure stops automatic writes, retains the newest in-memory pending project, reports `error`, and resumes only via explicit Retry after reload/conflict handling. `dispose` prevents late callbacks from updating an unmounted/different project. Add controlled-promise unit tests for rev2→rev3, direct rev1→rev3 coalescing, failure/retry and dispose.

- [ ] **Step 6: Replace the root route with the minimum project library/workspace shell**

`routes.tsx` defines `/`, `/project/:projectId`, `/settings` and keeps the existing legacy routes temporarily; `/learn/:lessonId` is added with complete behavior in Task 17 rather than exposing an empty route. `ProjectLibrary` has a real “新建分压项目” button using `crypto.randomUUID()`. `ProjectWorkspace` loads the project, initializes `useReducer`, displays project/revision/save state and persists accepted commands. `SchematicCanvas` renders the existing SVG interaction model and dispatches one layout command at pointer/keyboard gesture end. `PropertiesPanel` edits the selected component through `component/replace`. No simulation result is shown.

`/settings` renders a real, read-only `SettingsPage`, not an empty shell: it reports this build's current identity label, actual online state and the exact result/error/unsupported state of `navigator.storage.estimate()` and `persisted()`. Before Tasks 13/20 exist it truthfully reports engine metadata and Service Worker as unavailable/not installed; it does not invent success or render preference controls whose behavior has not been implemented. Task 22 extends this same component with the qualified engine/offline providers and the three validated preferences. Add a direct-open/reload assertion for `/settings` to `project-persistence.spec.ts`.

- [ ] **Step 7: Verify the real persistence journey and lazy lists**

```ts
// tests/browser/project-persistence.spec.ts
import { expect, test } from "@playwright/test";

test("edits electrical and layout state, undo/redoes, and reloads one project", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建分压项目" }).click();
  const projectUrl = page.url();
  await expect(page.getByText("9V 分压器实验")).toBeVisible();
  await expect(page.getByTestId("project-revision")).toHaveText("修订 1 / 电气 1");

  await page.getByRole("button", { name: "选择 R2" }).click();
  await page.getByLabel("电阻（Ω）").fill("3000");
  await page.getByRole("button", { name: "应用参数" }).click();
  await expect(page.getByTestId("project-revision")).toHaveText("修订 2 / 电气 2");

  await page.getByTestId("component-R2").focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("project-revision")).toHaveText("修订 3 / 电气 2");
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByTestId("project-revision")).toHaveText("修订 4 / 电气 2");
  await page.getByRole("button", { name: "重做" }).click();
  await expect(page.getByTestId("project-revision")).toHaveText("修订 5 / 电气 2");
  await expect(page.getByText("已保存")).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(projectUrl);
  await expect(page.getByTestId("project-revision")).toHaveText("修订 5 / 电气 2");

  const storedCount = await page.evaluate(async () => {
    const request = indexedDB.open("fluxlab");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = database.transaction("projects").objectStore("projects").count();
    return await new Promise<number>((resolve, reject) => {
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    });
  });
  expect(storedCount).toBe(1);
});
```

Add a second test that writes `{ schemaVersion: 2, id: "broken" }` directly into the `projects` store, opens `/project/broken`, and asserts a visible `STORAGE_INVALID_PROJECT` diagnostic while the navigation and project library remain usable. Add a rapid rev2/rev3 edit with a deliberately delayed first transaction and prove the refresh restores rev3 while the old completion never shows saved for rev2.

Add a near-15-MiB valid project envelope directly to IndexedDB, instrument `IDBObjectStore.prototype.get/getAll`, open the project library and assert both call counts stay zero while its summary renders from `openKeyCursor`. Opening that specific project may then perform exactly one `get` and full validation. This is a real Chromium test because an in-memory fake can hide structured-clone cost and transaction lifetime behavior.

Run:

```powershell
pnpm vitest run client/src/features/editor/project-reducer.test.ts client/src/storage/indexeddb.test.ts
pnpm exec playwright test tests/browser/project-persistence.spec.ts --project=chromium
```

Expected: both pass; the browser assertion proves one stored project, electrical/layout revisions differ as specified, undo/redo persists, and a malformed record produces a recoverable diagnostic rather than a white screen.

- [ ] **Step 8: Update evidence and commit the vertical slice**

```powershell
git add client/src/app client/src/domain client/src/features/editor client/src/features/project-library client/src/storage client/src/App.tsx client/src/main.tsx client/src/index.css tests/browser/project-persistence.spec.ts docs/2026-08-28-circuit-simulator-modernization/04-progress.md docs/2026-08-28-circuit-simulator-modernization/05-verification.md
git commit -m "feat: persist one versioned project workspace"
```

### Task 7: Build One Schematic Graph and ERC Boundary

**Behavior:** 所有元件、导线和标签形成唯一稳定图；相同标签连接、冲突标签、GND、坏 pin、悬空必要 pin、模型缺失和理想源冲突产生确定诊断。

**Files:**
- Create: `client/src/domain/schematic/component-library.ts`
- Create: `client/src/domain/schematic/graph.ts`
- Create: `client/src/domain/schematic/graph.test.ts`
- Create: `client/src/domain/schematic/diagnostics.ts`
- Modify: `tests/fixtures/circuits/projects.ts`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`

**Interfaces:**
- `getStaticComponentDefinition(kind)` supplies pins for fixed-pin families; `resolveComponentDefinition(component, models): DomainResult<ComponentDefinition>` resolves X/subcircuit pins from the referenced parsed interface.
- `endpointKey(endpoint): string` is `canonicalJson([componentId, pin])` and is the sole key encoding used by graph, compiler and probes.
- `buildSchematicGraph(project): DomainResult<SchematicGraph>` performs physical union, label union and stable naming.
- `runErc(project, graph): Diagnostic[]` checks only deterministically knowable rules; it never promises hardware safety.

- [ ] **Step 1: Write graph identity and diagnostics tests**

```ts
import { describe, expect, it } from "vitest";
import { buildSchematicGraph } from "./graph";

describe("schematic graph", () => {
  it("unions case-insensitive labels and reserves ground", () => {
    const result = buildSchematicGraph(labelledProjectFixture("Signal_A", "signal_a"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(new Set(Object.values(result.value.endpointToNode))).toContain("SIGNAL_A");
  });

  it("blocks conflicting labels on one physical net", () => {
    const result = buildSchematicGraph(conflictingLabelProjectFixture("OUT", "SENSE"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe("GRAPH_CONFLICTING_LABELS");
  });
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
pnpm vitest run client/src/domain/schematic/graph.test.ts
```

Expected: FAIL because graph modules do not exist.

- [ ] **Step 3: Implement the fixed component registry and two-pass union**

```ts
export interface ComponentDefinition {
  kind: ComponentKind;
  pins: readonly string[];
  requiredPins: readonly string[];
  refdesPrefix: string;
}

export function resolveComponentDefinition(
  component: ComponentInstance,
  models: ModelDefinition[],
): DomainResult<ComponentDefinition>;

export interface SchematicGraph {
  endpointToNode: Record<string, string>;
  nodeToEndpoints: Record<string, WireEndpoint[]>;
  nodes: Array<{ name: string; grounded: boolean; labels: string[] }>;
}
```

Registry pin order is R/C/L/V/I/D `p/n`, switch `p/n/cp/cn`, BJT `c/b/e`, MOSFET `d/g/s/b`, and ground `gnd`. An X instance is resolved from its concrete `modelRef`, then selects exactly one interface by case-insensitive `subcircuitName`; duplicate/missing names fail, and the instance's `orderedPins` must equal that interface exactly before node resolution. It is never guessed from `kind` or from the first interface in a bundle. Encode every endpoint as `canonicalJson([componentId, pin])`; never concatenate with `:` or another delimiter. Internal union/find, ID, refdes and endpoint indexes use `Map`/`Set`; when returning the declared `Record` DTO, create null-prototype objects and use `Object.hasOwn`, never `key in object` or dynamic assignment to a normal prototype-bearing object. Union physical wires first, normalized ASCII labels second; `0/GND` become node `0`; labelled nodes use normalized uppercase; unlabelled nodes sort endpoint keys and become `N0001...`. Add a collision fixture such as `componentId="a:b", pin="c"` versus `componentId="a", pin="b:c"` and prove distinct keys, plus direct graph tests showing reserved prototype keys are rejected at Task 3 rather than becoming inherited entries.

- [ ] **Step 4: Add ERC without swallowing ngspice runtime failures**

ERC codes cover duplicate ID/refdes, missing endpoint/pin, missing ground, floating required pin, missing/incompatible model, ideal voltage-source conflict and empty analysis probe references. Add fixed parallel-load, disconnected-singleton endpoint and voltage-source-terminal-short fixtures: parallel branches share the same stable node, the disconnected required pin reports `ERC_FLOATING_REQUIRED_PIN`, and a nonzero ideal source whose terminals resolve to one node reports `ERC_VOLTAGE_SOURCE_SHORT`. Mark only deterministic blockers with `blocksRun: true`; singular matrix and convergence stay engine failures.

- [ ] **Step 5: Run changed behavior and ordering regression**

```powershell
pnpm vitest run client/src/domain/schematic/graph.test.ts
```

Expected: same graph and diagnostics after shuffling component/wire arrays; moving layout changes nothing; every location carries component/wire/field IDs.

- [ ] **Step 6: Commit the graph boundary**

```powershell
git add client/src/domain/schematic tests/fixtures/circuits/projects.ts docs/2026-08-28-circuit-simulator-modernization/04-progress.md
git commit -m "feat: build schematic graph and erc diagnostics"
```

## Phase 3 — Compile Deterministically and Preserve Evidence

### Task 8: Compile the Graph, Corners, Models, and Vector Plan Deterministically

**Behavior:** 相同电气项目、分析和角点始终产生字节一致的网表、内部模型文件名、source map 与 vector plan；布局和数组顺序不影响输出。

**Files:**
- Create: `client/src/simulation/compile-netlist.ts`
- Create: `client/src/simulation/compile-netlist.test.ts`
- Create: `tests/fixtures/netlists/divider-op.expected.cir`
- Create: `tests/fixtures/netlists/rc-transient.expected.cir`
- Create: `tests/fixtures/netlists/diode-sweep.expected.cir`
- Create: `tests/fixtures/netlists/lowpass-ac.expected.cir`
- Modify: `client/src/simulation/contracts.ts`
- Modify: `tests/fixtures/circuits/projects.ts`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`

**Interfaces:**
- Consumes: Task 4 parser, Task 7 `buildSchematicGraph/runErc`, and Task 1's build-verified matrix only through `parseQualifiedVectorManifest`, `resolveQualifiedVector` and `listQualifiedFamilies` imported from `qualified-vectors.mjs`.
- Produces the exact design contracts `CompileRequest`, `CompiledModelFile`, `CompiledVectorRequest`, `CompileResult` and `NetlistSourceMap`.
- `applyCorner(project, definition, ordinal, total): Promise<DomainResult<{ project: CircuitProjectV2; appliedCorner: AppliedCorner }>>` is a non-persisting pure transform called by `compileNetlist` (and focused tests) only; controller/UI never call it separately.
- `compileNetlist(request): Promise<DomainResult<CompileResult>>` is the only producer of executable netlists and the sole production owner of corner application → graph/ERC → emission.
- `hashAnalysisDefinition(analysis): Promise<string>` validates unique `enabledProbes`, sorts that set by `ProbeId`, preserves semantically ordered fields, then hashes canonical JSON.
- On success `CompileResult.netlistHash = SHA-256(UTF-8 netlist)` and `vectorPlanHash = SHA-256(canonicalJson(vectorPlan))`, both full lowercase hexadecimal; no later layer recomputes them with another algorithm.
- On compiler success, `DomainResult.diagnostics` and `CompileResult.diagnostics` are the same non-blocking diagnostic array; any blocking diagnostic returns `ok: false` with no `CompileResult`.

- [ ] **Step 1: Write the failing deterministic compiler test**

```ts
import { describe, expect, it } from "vitest";
import { compileNetlist } from "./compile-netlist";

describe("deterministic netlist compiler", () => {
  it("emits identical bytes and mappings after arrays, layout, and project title are changed", async () => {
    const first = await compileNetlist({ project: dividerProjectFixture(), analysis: dividerAnalysis() });
    const second = await compileNetlist({ project: shuffledDividerFixture(), analysis: dividerAnalysis() });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.netlist).toBe(second.value.netlist);
    expect(first.value.netlistHash).toBe(second.value.netlistHash);
    expect(first.value.sourceMap).toEqual(second.value.sourceMap);
    expect(first.value.vectorPlan).toEqual(second.value.vectorPlan);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
pnpm exec vitest run client/src/simulation/compile-netlist.test.ts
```

Expected: FAIL because the compiler module does not exist.

- [ ] **Step 3: Implement the exact corner transform**

Accept only the approved `CornerParameterPath` union. Validate component family, parameter name, finite value, compatible replacement model and duplicate target. `compileNetlist(rawProject, analysis, optionalCorner)` invokes `applyCorner` exactly once, then runs the Task 3 schema, Task 7 graph/ERC and Task 4 model parser on that candidate and hashes the sorted definition/concrete applied values. Do not save the corner project or alter the source project's two revisions. Tests may call the pure helper directly; no other production call site is permitted.

```ts
export async function applyCorner(
  project: CircuitProjectV2,
  definition: CornerDefinition,
  ordinal: number,
  total: number,
): Promise<DomainResult<{ project: CircuitProjectV2; appliedCorner: AppliedCorner }>>;
```

- [ ] **Step 4: Implement stable SPICE emission and source mapping**

Start every executable netlist with one constant compiler-owned title such as `FLUXLAB GENERATED NETLIST`; never emit `project.title`, notes, layout text or other user prose. Immediately before emission, defensively recheck Task 3's exact refdes, model/subcircuit symbol, parameter, interface-pin and net-label ASCII rules plus family prefix and case-insensitive uniqueness; whitespace, control, quote/parenthesis, path/comment character, leading dot, wrong-family or case-only duplicate values return a blocker and no bytes. Sort components by normalized uppercase `refdes`, then `id`; use Task 7 node names. Emit R/C/L, independent V/I with DC/PULSE/SIN/PWL/AC data, S, D, Q, M and X in the exact pin/interface order. For V/I, emit `DC <value>` only when `dcV/dcA` is present. A transient source with absent DC must omit that token so fixed ngspice uses its waveform time-zero value for the operating point; an empty/AC-only import has already been normalized to explicit zero. Add a golden PULSE(initial≠0) case proving compile→real OP differs from an explicit DC 0 source as ngspice specifies. Emit only compiler-owned `.options`, internal `.include`, `.op/.dc/.tran/.ac`, output requests and `.end`. First compute the models actually referenced by the corner-applied components; an opaque subcircuit bundle must be self-contained, but unused project alternatives are not included or conflict-checked. Parse that referenced set again with origin `stored-model`. Build case-insensitive model/refdes symbol tables with `Map`, never prototype-bearing object assignment: the same model/subcircuit symbol from different hashes fails `MODEL_SYMBOL_CONFLICT`; the same normalized full hash/generated name is included and written once even if multiple model IDs reference it. Do not rename arbitrary subcircuit internals. Model files are named `model-<full lowercase sha256>.lib`; manifest entries remain sorted by `modelId` and may map multiple IDs to one generated file. User text never controls a path. A failed schema, parser, graph, ERC, corner or model check returns no runnable `CompileResult`.

- [ ] **Step 5: Bind probes through an explicit vector plan**

```ts
export interface CompiledVectorRequest {
  probeId: ProbeId;
  sourceVectorName: string;
  quantity: ResultQuantity;
  projections: ResultProjection[];
  axisName: string;
}
```

Resolve node, differential, branch-current and device-power probes against the graph. Load the hash-verified JSON once with `parseQualifiedVectorManifest`; use `resolveQualifiedVector` for every branch/power source name and use `listQualifiedFamilies` only for diagnostics/UI-compatible metadata. The compiler owns no second schema, family/analysis allowlist, raw-name template or direction/sign table. Sort vector-plan entries by `probeId`, then `sourceVectorName`; sort each entry's `projections` by the fixed enum order `scalar, real, imaginary, magnitude, phase, db20`, then hash that complete ordered plan, so `enabledProbes` array order cannot change output. Two probes may deliberately reference the same raw source: `CompileResult.requestedRawVectors` is the sorted unique union of non-scalar axis names and `sourceVectorName` values, while `vectorPlan` retains one entry per probe for deterministic fan-out. The v1 `branch-current` contract is accepted only for an unambiguous two-terminal conduction branch whose family/analysis tuple resolves in that matrix; Q/M/X or `null` returns a blocking diagnostic rather than guessing. The v1 `device-power` contract likewise accepts only a tuple resolved from the matrix; `null`, X or an AC power request returns `PROBE_UNSUPPORTED_DEVICE_POWER`, never a guessed sum or `db20` power. DC operating point requests scalar values and uses a synthetic `index=[0]` axis; sweep requests the swept source raw axis; transient requires the raw `time` vector; AC requires raw `frequency` plus explicit real/imaginary/magnitude/phase/db20 projections only for voltage/current quantities. Do not infer probe identity later from a display label.

- [ ] **Step 6: Verify all four golden netlists and compiler failures**

```powershell
pnpm exec vitest run client/src/simulation/compile-netlist.test.ts
```

Expected: four golden files match byte-for-byte with LF endings; rename/layout/array shuffle leaves netlist/netlistHash/vectorPlanHash identical; D/Q/M/S/X, subcircuit parameter ordering and all waveform forms are covered; unsafe/case-duplicate refdes, conflicting labels, bad corner paths, unsupported power probes, missing models and forbidden stored text return blocking diagnostics and no netlist.

Also shuffle `enabledProbes` and assert both `hashAnalysisDefinition` and the emitted netlist/vector plan remain identical; duplicate probe IDs fail schema validation rather than producing a different hash.

- [ ] **Step 7: Commit the compiler boundary**

```powershell
git add client/src/simulation/compile-netlist.ts client/src/simulation/compile-netlist.test.ts client/src/simulation/contracts.ts tests/fixtures docs/2026-08-28-circuit-simulator-modernization/04-progress.md
git commit -m "feat: compile deterministic spice netlists"
```

### Task 9: Estimate and Enforce Run Resources Before Worker Creation

**Behavior:** stored 点数、单向量、adapter raw、最终 snapshot transfer、网表与虚拟文件上界在创建 Worker 前用同一组常量保守计算；超出一字节或一个点即明确阻断。

**Files:**
- Create: `client/src/simulation/resource-estimator.ts`
- Create: `client/src/simulation/resource-estimator.test.ts`
- Modify: `client/src/simulation/contracts.ts`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`

**Interfaces:**
- Consumes: Task 8 `CompileResult.vectorPlan`, validated `AnalysisDefinition`, and Task 1's fixed `RESULT_TRANSPORT.json`.
- Produces `DEFAULT_RUNTIME_LIMITS: RuntimeLimits`, `DEFAULT_RUN_POLICY`, `estimateRunResources(input): DomainResult<ResourceEstimate>` and `checkRunResourceLimits(estimate): Diagnostic[]`.
- The exact ceilings remain those in Global Constraints; no UI can override them in v1.

- [ ] **Step 1: Write boundary-value tests for each analysis family**

```ts
import { expect, it } from "vitest";
import { estimateRunResources } from "./resource-estimator";

it("blocks a transient request above two million total axis/vector points", () => {
  const result = estimateRunResources(oversizedTransientFixture());
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.diagnostics[0].code).toBe("RESOURCE_RESULT_POINTS");
});
```

Add paired tests at the exact limit and one unit above for stored result points, single vector bytes, raw-result bytes, snapshot-transfer bytes, expanded netlist bytes and virtual FS bytes. Include DC `start=0, stop=0.3, step=0.1` and assert the conservative estimate is four points despite binary floating-point division. Add an AC plan where one complex raw node fans out to five projections and duplicate probes: raw is counted once, while every concrete projection is counted in `resultPoints/snapshotTransferBytes`; place it one byte below and above 64 MiB so the old raw-only calculation would incorrectly pass the failing case.

- [ ] **Step 2: Run the estimator test and verify RED**

```powershell
pnpm exec vitest run client/src/simulation/resource-estimator.test.ts
```

Expected: FAIL because the estimator module does not exist.

- [ ] **Step 3: Implement conservative point and byte formulas**

```ts
export interface ResourceEstimate {
  axisPoints: number;
  resultPoints: number;
  maxSingleVectorBytes: number;
  rawResultBytes: number;
  snapshotTransferBytes: number;
  rawfileFsBytes: number;
  modelUtf8Bytes: number;
  expandedNetlistBytes: number;
  virtualFsBytes: number;
}

export function estimateRunResources(input: {
  project: CircuitProjectV2;
  analysis: AnalysisDefinition;
  compiled: CompileResult;
  resultTransport: QualifiedResultTransport;
}): DomainResult<ResourceEstimate>;
```

Use the conservative upper bound `ceil(abs(stop-start)/abs(step)) + 1` for an inclusive DC sweep after direction validation; it may overestimate by one when a range is not divisible, but must never underestimate because of values such as `0.3 / 0.1`. Use `ceil((stop-start)/step) + 1` for transient; exact `totalPoints` for linear AC and `ceil(intervals * pointsPerInterval) + 1` for dec/oct. Reject any arithmetic overflow or non-safe integer.

Count `rawResultBytes` once per sorted unique raw axis/source name, using 8 bytes per real scalar and 16 only for a complex real+imaginary source. Count `resultPoints` and `snapshotTransferBytes` once for each final unique stored axis plus every concrete per-probe projection in `vectorPlan`; two same-node probes share one raw source but still create and charge two traceable `ResultVector` buffers per requested projection. For `vector-callback`, `rawfileFsBytes = 0`. For `binary-rawfile`, call only the Task 1 qualified conservative header estimator and add header + raw axis/complex data to `rawfileFsBytes` and total `virtualFsBytes`; a missing/unknown estimator is a qualification failure, not zero. Count model/FS bytes once per unique verified `generatedName/hash/source` file even when the full manifest has multiple model IDs. Use `TextEncoder`, never JavaScript string length.

- [ ] **Step 4: Return diagnostics before any Worker side effect**

The caller must run `estimateRunResources` before creating or initializing a Worker. Emit distinct stable codes for points, vector, raw result, snapshot transfer, netlist and FS limits. Never clamp a requested analysis or silently drop a projection.

- [ ] **Step 5: Run exact-boundary tests and commit**

```powershell
pnpm exec vitest run client/src/simulation/resource-estimator.test.ts
git add client/src/simulation/resource-estimator.ts client/src/simulation/resource-estimator.test.ts client/src/simulation/contracts.ts docs/2026-08-28-circuit-simulator-modernization/04-progress.md
git commit -m "feat: enforce deterministic simulation resource limits"
```

Expected: all limit and overflow tests pass; source contains one runtime limit object and no duplicate numeric ceiling.

### Task 10: Wrap the Qualified ngspice ABI and Close Model-File Routes

**Behavior:** 产品 Worker 使用 Task 1 已资格化的同一产物和 ABI，写入前重新验证每个模型来源、哈希与生成文件名，运行后无残留文件、plot 或跨运行状态。

**Files:**
- Create: `client/src/simulation/ngspice-adapter.ts`
- Create: `client/src/simulation/ngspice-adapter.test.ts`
- Create: `tests/spice-trust-boundary.test.ts`
- Modify: `client/src/simulation/contracts.ts`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- Implements the Task 3/design `NgspiceRuntimeAdapter` contract; it is the only product wrapper around Emscripten symbols.
- Produces `verifyCompiledModelFiles(manifest, models): Promise<DomainResult<VerifiedModelFile[]>>`.
- `AdapterRuntimeError` carries one structured `SimulationFailure`; callers never parse its message string.
- Imports Task 1's `parseQualifiedVectorManifest` and `resolveQualifiedVector`; it never owns a second vector schema, family/analysis list, raw-name template or direction/sign table.

- [ ] **Step 1: Write failing hash, cleanup, and route tests**

```ts
import { expect, it } from "vitest";
import { verifyCompiledModelFiles } from "./ngspice-adapter";

it("rejects a source whose bytes do not match the compiled manifest", async () => {
  const result = await verifyCompiledModelFiles(
    [{ modelId: "DLED", sha256: "0".repeat(64), generatedName: `model-${"0".repeat(64)}.lib` }],
    [{ modelId: "DLED", sha256: "0".repeat(64), generatedName: `model-${"0".repeat(64)}.lib`, source: ".model DLED D(IS=1e-12)" }],
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.diagnostics[0].code).toBe("MODEL_HASH_MISMATCH");
});
```

In `tests/spice-trust-boundary.test.ts`, pass `.control` through bundled template creation, v1 migration, an in-memory project model and a stored-model compile call; assert each is rejected before the fake FS records a write.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
pnpm exec vitest run client/src/simulation/ngspice-adapter.test.ts tests/spice-trust-boundary.test.ts
```

Expected: FAIL because the product adapter does not exist.

- [ ] **Step 3: Implement verified initialization and model preparation**

Statically import the Task 1 build-verified module factory into the Worker; there is no runtime `moduleUrl` or independent glue fetch. Before factory invocation require the compiled `moduleSha256` constant and `RESULT_TRANSPORT.json` kind to equal the request fingerprint, require the compiled `QUALIFIED_VECTORS.json` bytes to match their build-verified SHA entry, and parse those bytes only with `parseQualifiedVectorManifest`. Then fetch the same-origin WASM URL, hash its bytes, pass only the verified `wasmBinary` into that factory, and compare exact version/transport/build metadata. A mismatch returns `ENGINE_TRANSPORT_MISMATCH` or `ENGINE_VECTOR_CONTRACT_MISMATCH`; production never probes then falls back to another result route or raw-name convention. For each model, call Task 4 with origin `stored-model`, recompute normalized-source SHA-256, require an exact manifest entry, and enforce `model-<64 lowercase hex>.lib`. Return UTF-8 bytes only after every model passes; one failure yields no partial list.

- [ ] **Step 4: Implement bounded batch execution and unconditional cleanup**

Create one generated run directory. Validate every full model-manifest entry against its source first, then group by `generatedName`: identical name/hash/source bytes are written once, while any disagreement fails before FS rather than last-write-wins. Resource accounting charges actual unique files; RunRecord retains the full per-model-ID manifest. Write only generated netlist/model names; collect only the sorted unique raw names requested by the compiled plan and, for each branch/power request, call `resolveQualifiedVector` again and require the resolved raw name to equal the compiled plan before calling the ABI. A `null` or mismatch fails before FS execution. The adapter does not synthesize power from display values or maintain a second name/sign table.

Accumulate UTF-8 log, heap, total FS, single raw vector, raw points and `rawResultBytes` while data arrives. Callback mode asserts no rawfile was created and reports `rawfileFsBytes=0`. Binary mode rejects execution unless Task 9's header + axis/complex rawfile bound fits 32 MiB, then monitors actual file bytes and proves they do not exceed that bound. Crossing the raw 64 MiB or FS ceiling throws `AdapterRuntimeError` before returning vectors; snapshot projection/transfer is deliberately not charged here and is enforced in Task 11 before Worker postMessage. In `finally`, destroy plots, unlink every file and remove the run directory. Console text never becomes a numerical vector. Add callback-zero-FS, binary-header-bound, raw one-byte boundary, two-model-ID→one-generated-file and same-name/different-byte tests.

- [ ] **Step 5: Prove two-run isolation and failure cleanup**

Use the documented fake ABI for unit tests to run A then B, inject a write failure and an engine failure, and assert no files/plots remain and B contains no A vector. Then rerun the real Task 1 qualification suite; a fake alone is insufficient to approve the adapter ABI.

```powershell
pnpm exec vitest run client/src/simulation/ngspice-adapter.test.ts tests/spice-trust-boundary.test.ts
pnpm exec playwright test tests/browser/ngspice-qualification.spec.ts --project=chromium --project=firefox --project=webkit
```

Expected: unit tests and the same four real analysis fixtures plus model and R/D power-vector checks pass; hash/version/transport mismatch and every running raw/FS limit produce structured failure.

- [ ] **Step 6: Record provenance and commit**

```powershell
git add client/src/simulation/ngspice-adapter.ts client/src/simulation/ngspice-adapter.test.ts client/src/simulation/contracts.ts tests/spice-trust-boundary.test.ts docs/2026-08-28-circuit-simulator-modernization/04-progress.md docs/2026-08-28-circuit-simulator-modernization/05-verification.md
git commit -m "feat: wrap the qualified ngspice runtime"
```

### Task 11: Validate Vectors and Persist a Coherent RunRecord State Machine

**Behavior:** 只有结构、哈希、单位、轴、向量和外层来源全部一致的成功结果才能形成 `SimulationSnapshot`；failed/cancelled/timeout 永远没有空快照，遗留 running 记录可一致恢复。

**Files:**
- Create: `client/src/simulation/result-parser.ts`
- Create: `client/src/simulation/result-parser.test.ts`
- Create: `client/src/simulation/run-record.ts`
- Create: `client/src/simulation/run-record.test.ts`
- Create: `client/src/simulation/run-record-schema.ts`
- Create: `client/src/simulation/run-record-schema.test.ts`
- Create: `tests/browser/run-storage.spec.ts`
- Modify: `client/src/storage/indexeddb.ts`
- Modify: `client/src/features/project-library/ProjectLibrary.tsx`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`

**Interfaces:**
- `parseAdapterResult(input: { run: SimulationRunRequest; adapterResult: AdapterResult; engine: EngineMetadata; startedAt: string; finishedAt: string }): Promise<DomainResult<SimulationSnapshot>>` binds raw engine vectors only through `run.compiled.vectorPlan`.
- `parseRunRecord(input): Promise<DomainResult<RunRecord>>` is the only storage/import boundary for runs; zod parses structure first, then Web Crypto checks provenance asynchronously.
- `createRunningRunRecord`, `createCompletedRunCandidate`, `finishRunSuccess`, `finishRunFailure`, `finishRunCancelled`, `finishRunTimeout`, `recoverInterruptedRun` and `checkRunFreshness` are pure transitions. `CompletedRunCandidate` has a validated snapshot but is never persisted or exposed to UI; only `finishRunSuccess(candidate, initialEvaluation)` creates a true success.
- Storage adds `createRunningRun`, `finishRun`, `appendAssertionEvaluation`, `loadRun`, `listRuns`, `recoverInterruptedRuns` and `pruneRuns(projectId, protectedRunIds, keep = 20)`, each returning `DomainResult`. Full runs remain wrapped; `localAttempt/storageVersion/immutableBaseHash` are local storage metadata and never enter `.fluxrun` or `RunRecord`.
- `ProjectLibrary` owns the one project-delete confirmation UI. Cancel closes it without calling storage; confirm calls `deleteProject(projectId)` exactly once, waits for transaction completion before removing the row, and keeps the project visible with diagnostics on failure. It never implements or calls a second cascade path.

```ts
export interface RunSummary {
  runId: RunId;
  projectId: ProjectId;
  localAttempt: number;
  startedAt: string;
  analysisId: AnalysisId;
  status: RunRecord["status"];
  cornerKey: string;
}

export interface StoredRunEnvelope {
  envelopeVersion: 1;
  storageVersion: number;
  localAttempt: number;
  immutableBaseHash: string;
  record: RunRecord;
  listKey: readonly [ProjectId, number, string, AnalysisId, RunRecord["status"], string, RunId];
}

export async function createRunningRun(
  run: Extract<RunRecord, { status: "running" }>,
): Promise<DomainResult<StoredRunEnvelope>>;
export async function finishRun(
  candidate: Exclude<RunRecord, { status: "running" }>,
): Promise<DomainResult<StoredRunEnvelope>>;
```

- [ ] **Step 1: Write failing vector and cross-record consistency tests**

```ts
import { expect, it } from "vitest";
import { parseAdapterResult } from "./result-parser";
import { parseRunRecord } from "./run-record-schema";

it("rejects a successful-looking adapter vector containing NaN", async () => {
  const result = await parseAdapterResult(adapterFixture({ real: new Float64Array([0, Number.NaN]) }));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.diagnostics[0].code).toBe("RESULT_NON_FINITE");
});

it("rejects a success wrapper whose snapshot belongs to another run", async () => {
  const value = successfulRunFixture();
  value.snapshot.runId = "different-run";
  const result = await parseRunRecord(value);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.diagnostics[0].code).toBe("RUN_SNAPSHOT_MISMATCH");
});
```

- [ ] **Step 2: Run all three focused files and verify RED**

```powershell
pnpm exec vitest run client/src/simulation/result-parser.test.ts client/src/simulation/run-record.test.ts client/src/simulation/run-record-schema.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Parse axes and vectors with deterministic IDs**

Map each requested source vector by exact name from the captured `vectorPlan`, recompute its canonical `vectorPlanHash`, and require exactly one adapter vector for every sorted unique name in `requestedRawVectors`; allow no duplicate or extra raw vector. Fan one raw vector out to separate deterministic ResultVectors for every referencing probe/projection. DC-op alone synthesizes `index=[0]` because ngspice has no index vector. Require non-empty equal-length arrays. Axes and all non-`db20` projections must be finite; `db20` alone may contain negative infinity for an exact zero magnitude, but never `NaN` or positive infinity, and it is stored without clamping. Axes must be strictly increasing except a valid descending DC sweep; for that case reverse the raw axis and every bound result vector together before ID generation/storage. Duplicate or non-monotonic axes fail.

While materializing, count stored points and `snapshotTransferBytes = Σ(unique axis buffers) + Σ(each concrete ResultVector buffer)`; duplicate probes and five AC projections each count even when the adapter supplied one raw complex vector. Enforce points, 16 MiB single-buffer and 64 MiB snapshot limits before constructing the `completed` event/transfer list; emit `RESOURCE_SNAPSHOT_TRANSFER` with no partial snapshot when exceeded. Transfer each actual `ArrayBuffer` exactly once. Generate complete IDs from the approved canonical SHA-256 formulas, units from analysis/projection semantics, and transferable `Float64Array` values. A nonzero exit, malformed complex pair or partial projection returns failure, not a partial snapshot. Add same-node/two-probe, raw→five-AC-projection exact-limit/one-byte-over, descending-sweep and zero-response AC fixtures proving raw accounting cannot understate final transfer, alignment remains exact and `-Infinity` is preserved.

- [ ] **Step 4: Implement terminal transitions and freshness**

Every transition accepts only a matching `status: "running"` record and returns one terminal record with the same immutable request provenance. Repeated or mismatched terminal transitions return a diagnostic and no second record. `recoverInterruptedRun` produces `failed` with code `RUN_INTERRUPTED`. `checkRunFreshness` requires the current `appBuildId`, then recompiles the current project/analysis/corner through Tasks 7–9 and compares `projectId + electricalRevision + analysisHash + netlistHash + vectorPlan + sorted model hashes + engine(name/version/resultTransport/moduleSha256/wasmSha256/engineBuildId) + corner definition/applied override hashes`. It never trusts revision equality as a proxy for compiler output. `projectRevision` remains audit metadata and is not itself a freshness key, so layout-only changes inside the same app build remain fresh; any app upgrade conservatively makes old runs historical, covering compiler, result projection and assertion-evaluator changes even when the engine ID did not change.

- [ ] **Step 5: Add the strict RunRecord schema and cross-field refinements**

Use zod discriminated unions for all five statuses. Every record validates the captured `analysis`, canonical ordered `vectorPlan/vectorPlanHash`, requested assertions filtered to `enabled && analysisId === run.analysisId` and sorted by ID, their set hash, bounded `inputBundle` and hashes; recompute netlist/model hashes from the actual LF sources. `inputBundle.sourceMap` line keys/ranges must lie within that exact netlist and component/endpoint values must belong to the captured project facts; `.fluxrun full` carries it unchanged. `preflightDiagnostics` preserves every non-blocking schema/model/graph/ERC/compile/resource diagnostic with an explicit phase, while result/engine warnings live only in `snapshot.diagnostics`; a blocking preflight diagnostic makes a RunRecord invalid. A success refinement requires wrapper and snapshot equality for app build, run/project IDs, revisions, full analysis, analysis ID/hash, netlist hash, vector plan/hash, model manifest, engine metadata and timestamps; it requires axes/vectors one-to-one with that plan, recomputes all vector/axis IDs and validates typed-array contents including the sole `db20 = -Infinity` exception. The first assertion evaluation must contain definitions identical to `requestedAssertions`, its hash must equal `requestedAssertionSetHash`, and its `projectRevision` must equal the run revision. Every evaluation's `runId/electricalRevision` must equal its parent run; later evaluation `projectRevision` may be higher after assertion-only edits but never lower than the run revision. Every child `AssertionResult` must repeat exactly its parent evaluation's `runId/assertionSetHash/projectRevision/electricalRevision`, and results must remain one-to-one with definitions. A non-success status rejects any `snapshot` key. Failed engine logs obey the 1 MiB UTF-8 limit. Later assertion evaluations must reference the same run, contain only same-analysis sorted definitions and have unique `assertionSetHash`.

`immutableBaseHash` has one formula: `SHA-256(canonicalJson(runRecordBaseFields(record)))`, where the picker contains every exact `RunRecordBase` field from design §7.4 and no status-specific key. Envelope parsing recomputes it, derives `listKey` from the record plus local attempt, and cross-checks both; it never treats a copied envelope hash as proof without recomputation outside the transaction.

The “belongs to captured project facts” check is creation-time only, while the project is available. On standalone storage/file load, validate sourceMap safe IDs/pins, line bounds and both bidirectional mappings internally; do not claim to verify against a historical project that may no longer exist.

- [ ] **Step 6: Add atomic IndexedDB run operations**

Create a `runSequences` store keyed by project ID with tiny `{ envelopeVersion, projectId, nextAttempt, storageVersion }` values. `nextAttempt` starts at 1 and both it and `storageVersion` must be positive safe integers; allocation assigns the current value then increments by exactly one, and `Number.MAX_SAFE_INTEGER` fails `STORAGE_RUN_SEQUENCE_EXHAUSTED` before either store changes. After validating/hashing the running candidate outside any transaction, `createRunningRun` opens one short `readwrite` transaction over `projects`, `runSequences`, and `runs`: query the projects `[projectId,revision,electricalRevision]` index with `openKeyCursor` to prove the request is still current without cloning the project; read/increment the small sequence; derive `localAttempt/listKey/immutableBaseHash`; and `add` the run envelope. It never calls projects `get/put`, so starting a run cannot rewrite a 15 MiB project or erase a concurrent save. Add exact 1→2 and exhaustion tests plus an interleaving browser test where rev2 save and run allocation overlap: both succeed in serialized IDB order, project content remains rev2, the sequence increments once and no counter is lost.

`finishRun` and `appendAssertionEvaluation` use the same two-phase CAS. First read one raw current envelope in a readonly transaction and let it complete. Outside all transactions, await `parseRunRecord`, canonical/Web Crypto hashes, transition/evaluation construction and full candidate validation. Then open a short `readwrite`, reread current and synchronously require the previously validated `storageVersion`, `localAttempt`, `immutableBaseHash`, run ID and status before one `put`; no async function, crypto or schema refinement runs while the transaction is active. A finish CAS miss returns `STORAGE_RUN_CONFLICT`, never writes an old candidate. For concurrent append of the same deterministic evaluation ID, a CAS miss may perform one new readonly load/async validation: if the stored evaluation has the exact canonical payload, return idempotent success; same ID with different payload is corruption, and any other version change is conflict. It never blindly retries a write. `loadRun` likewise completes readonly `get` before async parse. This exact structure must be exercised in a real browser; fake IndexedDB alone cannot approve it because it can hide `TransactionInactiveError`.

The `runs` store has compound `[projectId,localAttempt,startedAt,analysisId,status,cornerKey,runId]` and status indexes. `listRuns` uses only the project index's `openKeyCursor` to create `RunSummary`; no object-store `get/getAll` may clone result payload. A near-64-MiB valid success envelope test instruments those methods and proves history renders from keys with zero calls, then opening that run performs one load/full validation. `pruneRuns` deletes smallest `localAttempt` complete terminal envelopes only, never running or caller-protected/selected/evidence-referenced IDs. If protected evidence keeps the project above 20, retain it and return `RUN_RETENTION_BLOCKED`.

Because runs now exist, extend Task 6 `deleteProject` in this task: one confirmed `projects+runSequences+runs` transaction deletes the project and sequence, then walks the run project index with `openKeyCursor` and deletes by primary key without cloning any RunRecord. Wire the `ProjectLibrary` confirmation described above to this API. In `run-storage.spec.ts`, seed one target project/sequence with two runs plus an unrelated project: cancelling the visible confirmation calls no delete API and preserves every row; confirming through the same UI removes exactly the target's three-store rows; then reseed and monkeypatch the native object-store `delete` to throw on the second target-run deletion, require the UI to report failure and the transaction to abort, restore the prototype in `finally` and prove every target row remains. Task 17 extends and reruns this same atomicity proof with its now-defined evidence/navigation indexes; it must not introduce a second deletion path.

Startup recovery obtains running run IDs through the status index's `openKeyCursor`, reads/validates each after the cursor transaction completes, and attempts `navigator.locks.request('fluxlab-run:'+runId, { mode:'exclusive', ifAvailable:true })`. Only while holding an available lock may it build `RUN_INTERRUPTED` and perform the two-phase CAS; an unavailable lock means another tab still owns the run and leaves it unchanged with an `RUN_ACTIVE_IN_OTHER_TAB` summary. Add a two-page Chromium test: page A holds a long run lock, page B cannot recover it; after force-closing A, page B acquires the orphan lock and writes exactly one interrupted terminal. Invalid rows are reported without hiding valid runs.

- [ ] **Step 7: Run state, corruption, and transaction tests**

```powershell
pnpm exec vitest run client/src/simulation/result-parser.test.ts client/src/simulation/run-record.test.ts client/src/simulation/run-record-schema.test.ts
pnpm build
pnpm exec playwright test tests/browser/run-storage.spec.ts --project=chromium
```

Expected: finite coherent success passes; wrong ID/unit/axis/length/hash/time fails; failed/cancelled/timeout with a snapshot fails; raw-vs-snapshot limits, async validation, lazy large-run lists, save/run interleaving, cross-tab ownership, recovery and duplicate terminal/evaluation attempts are deterministic; project deletion proves cancel/no-write, exact successful three-store cascade and injected-delete atomic rollback while preserving an unrelated project.

- [ ] **Step 8: Commit the evidence model**

```powershell
git add client/src/simulation/result-parser.ts client/src/simulation/result-parser.test.ts client/src/simulation/run-record.ts client/src/simulation/run-record.test.ts client/src/simulation/run-record-schema.ts client/src/simulation/run-record-schema.test.ts client/src/storage/indexeddb.ts client/src/features/project-library/ProjectLibrary.tsx tests/browser/run-storage.spec.ts docs/2026-08-28-circuit-simulator-modernization/04-progress.md
git commit -m "feat: validate and persist traceable run records"
```

### Task 12: Evaluate Measurements and the Captured Assertion Set

**Behavior:** 受控测量只读取一个完整 `SuccessfulRunRecord`；按下 Run 时捕获的 enabled assertions 在成功数值写入前完成确定性求值，配置错误与设计未达标保持不同状态。

**Files:**
- Create: `client/src/simulation/measurements.ts`
- Create: `client/src/simulation/measurements.test.ts`
- Modify: `client/src/simulation/run-record.ts`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`

**Interfaces:**
- `evaluateMeasurement(run, expression): DomainResult<QuantityValue>`.
- `selectEnabledAssertions(assertions, analysisId)` filters `enabled && analysisId` and sorts by ID. `computeAssertionDefinitionHash(definition)` is the full lowercase `SHA-256(canonicalJson(definition))`; `computeAssertionSetHash(assertions, analysisId)` is the full lowercase `SHA-256(canonicalJson(selectEnabledAssertions(...)))`, including the canonical `[]` empty-set hash. These are the only formulas used by project commands, RunRecord loading, evaluation and gates.
- `evaluateCapturedAssertionSet(candidate): Promise<DomainResult<AssertionEvaluation>>` is the internal initial-success path and reads only the immutable `CompletedRunCandidate.requestedAssertions` captured by the controller.
- `evaluateAssertionSet(input): Promise<DomainResult<AssertionEvaluation>>` handles later reevaluation from a true `SuccessfulRunRecord`.
- `withAssertionEvaluation(run, evaluation): DomainResult<SuccessfulRunRecord>` preserves the immutable snapshot and deduplicates the deterministic evaluation ID; the IndexedDB operation remains `appendAssertionEvaluation`.

- [ ] **Step 1: Write failing interpolation, bandwidth, and error-state tests**

```ts
import { describe, expect, it } from "vitest";
import { evaluateMeasurement } from "./measurements";

describe("run-bound measurements", () => {
  it("interpolates valueAt but never clamps outside the axis", () => {
    const run = transientRunFixture({ time: [0, 1, 2], volts: [0, 2, 4] });
    expect(evaluateMeasurement(run, {
      function: "valueAt",
      vectorId: run.snapshot.vectors[0].id,
      at: { value: 0.5, unit: "s" },
    })).toMatchObject({ ok: true, value: { value: 1, unit: "V" } });
    const outside = evaluateMeasurement(run, {
      function: "valueAt",
      vectorId: run.snapshot.vectors[0].id,
      at: { value: -1, unit: "s" },
    });
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.diagnostics[0].code).toBe("MEAS_OUT_OF_RANGE");
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

```powershell
pnpm exec vitest run client/src/simulation/measurements.test.ts
```

Expected: FAIL because the measurement module does not exist.

- [ ] **Step 3: Implement the five measurement functions exactly**

`valueAt` uses exact match or linear interpolation and rejects outside the closed axis. `min/max/mean` use all finite values. `crossingTime` requires a seconds axis and same-unit threshold, scans forward for the first strict-side→reach/cross edge, linearly interpolates, and rejects a flat-on-threshold segment. `bandwidth3dB` requires AC, positive Hz, db20, two points and the first downward crossing from the first-point baseline by exactly `3.01029995664 dB`; interpolate in Hz for lin and `log10(Hz)` for dec/oct. Reject an initial rise above 0.1 dB, missing crossing, empty/bad axis or incompatible units.

- [ ] **Step 4: Implement comparison and deterministic IDs**

```ts
export async function evaluateAssertionSet(input: {
  run: SuccessfulRunRecord;
  assertions: AssertionDefinition[];
  projectRevision: number;
  electricalRevision: number;
  evaluatedAt: string;
}): Promise<DomainResult<AssertionEvaluation>>;
```

The initial completion path is separate, so it never fabricates a success with no initial evidence:

```ts
export async function evaluateCapturedAssertionSet(input: {
  candidate: CompletedRunCandidate;
  evaluatedAt: string;
}): Promise<DomainResult<AssertionEvaluation>>;
```

Implement literal `lt/lte/gt/gte`, inclusive `between`, and `near` with `abs(actual-expected) <= max(absoluteTolerance, relativeTolerance * abs(expected))`. `near` requires at least one positive tolerance; expected zero requires an absolute tolerance; relative tolerance is `0..1`. A normal false comparison is `failed`; invalid units, vector, axis, non-finite measured value (including stored `db20 = -Infinity`) or expression yields an `ok: true` complete evaluation whose affected result is `status: "error"`, so valid numerical success remains a success and Task 16 blocks its gate. `bandwidth3dB` likewise reports a precondition error if its baseline/crossing segment includes negative infinity and never clamps it. Reserve `ok: false` for a corrupt candidate/run or an internal condition that prevents constructing a complete one-result-per-definition evaluation. The captured path must reject any candidate whose captured definition analysis IDs/hash do not match its analysis and `requestedAssertionSetHash`; it accepts no caller-supplied assertion list. Later `evaluateAssertionSet` must require `input.electricalRevision === input.run.electricalRevision` and reject a mismatch instead of stamping a current revision onto old numbers. Store the exact enabled definitions sorted by ID in `AssertionEvaluation.definitions`, compute single/set hashes only by the interface formulas, generate assertion-result/evaluation IDs with the exact design SHA-256 formulas, and require results one-to-one with those definitions; never use random IDs.

- [ ] **Step 5: Cover every semantic branch and captured-set behavior**

Add focused cases for exact/interpolated/out-of-range valueAt; min/max/mean; rising/falling/no crossing; lin/dec/oct 3 dB; every comparator; zero/tolerance/unit errors; disabled assertion exclusion; definition-order independence; and duplicate append. Prove the captured path cannot be overridden by an external array, a forged captured hash fails, a mismatched electrical revision fails, a changed assertion for the same analysis changes the set hash without changing the run snapshot, and changing an assertion for another analysis leaves this run's set hash/evaluation unchanged.

```powershell
pnpm exec vitest run client/src/simulation/measurements.test.ts client/src/simulation/run-record.test.ts
```

Expected: all branches pass; `failed` and `error` are distinguishable; snapshot bytes and vector IDs stay unchanged after an appended evaluation.

- [ ] **Step 6: Commit the measurement boundary**

```powershell
git add client/src/simulation/measurements.ts client/src/simulation/measurements.test.ts client/src/simulation/run-record.ts docs/2026-08-28-circuit-simulator-modernization/04-progress.md
git commit -m "feat: evaluate run-bound measurements and assertions"
```

## Phase 4 — Run One Engine and Expose the First Honest Product Slice

### Task 13: Own Worker Generation, Cancellation, Timeout, and Atomic Completion

**Behavior:** 页面只有一个仿真入口；它按 schema→model trust→graph/ERC→compiler→resource estimate→running record→Worker→result/assertions→terminal record 执行，旧 Worker 事件绝不覆盖新运行。

**Files:**
- Create: `client/src/app/build-info.ts`
- Create: `client/src/simulation/simulator.worker.ts`
- Create: `client/src/simulation/simulation-controller.ts`
- Create: `client/src/simulation/simulation-controller.test.ts`
- Create: `scripts/resolve-build-identity.mjs`
- Create: `tests/release/build-identity-mode.test.mjs`
- Modify: `client/src/storage/indexeddb.ts`
- Modify: `vite.config.ts`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- `resolveBuildIdentity(root, env)` is the single Vite-side purpose boundary. Default/`verification` recursively hashes regular files under `client/` and `vendor/ngspice/` plus `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `tsconfig.json` and `tsconfig.node.json`; it sorts slash-normalized relative paths and feeds for each `UTF8(path) + NUL + UTF8(decimal byte length) + NUL + bytes + NUL` into one SHA-256. It returns `appBuildId = verify-<64 lowercase hex>` and `nonReleaseBuild: true`, rejects symlinks, and changes when one input byte changes. `pwa-fixture` and `release` are the only other purposes; Task 20/23 close their exact rules. The app ID is never the engine build ID.
- `SimulationController.run(input): Promise<RunRecord | SimulationNotStarted>` is the sole product run entry.
- `SimulationController.cancel(reason): Promise<RunRecord | null>` and `dispose()` terminate the active generation.
- Progress listeners receive typed `SimulationWorkerEvent`; no React state crosses into the Worker.

- [ ] **Step 1: Write the deterministic late-event race test**

```ts
import { expect, it } from "vitest";
import { SimulationController } from "./simulation-controller";

it("ignores A.completed after A is cancelled and B starts", async () => {
  const harness = createControllerHarness();
  const pendingA = harness.controller.run(runInput("A"));
  harness.workers[0].emitReady();
  await harness.controller.cancel("user");
  const pendingB = harness.controller.run(runInput("B"));
  harness.workers[1].emitReady();
  harness.workers[0].emitCompleted(snapshotFor("A"));
  harness.workers[1].emitCompleted(snapshotFor("B"));
  await expect(pendingA).resolves.toMatchObject({ runId: "A", status: "cancelled" });
  await expect(pendingB).resolves.toMatchObject({ runId: "B", status: "success" });
});
```

- [ ] **Step 2: Run the focused controller test and verify RED**

```powershell
pnpm exec vitest run client/src/simulation/simulation-controller.test.ts
```

Expected: FAIL because controller/Worker modules do not exist.

- [ ] **Step 3: Implement a side-effect-free preflight**

```ts
export type SimulationNotStarted = {
  status: "not-started";
  diagnostics: Diagnostic[];
};

export interface SimulationRunInput {
  project: CircuitProjectV2;
  analysisId: AnalysisId;
  corner?: { definition: CornerDefinition; ordinal: number; total: number };
}

export class SimulationController {
  constructor(options: SimulationControllerOptions);
  run(input: SimulationRunInput): Promise<RunRecord | SimulationNotStarted>;
  cancel(reason: "user" | "project-changed"): Promise<RunRecord | null>;
  dispose(): Promise<void>;
}
```

Before controller work, implement and test the build-purpose resolver, inject its identity/`nonReleaseBuild` constant into HTML/main/Worker, and make ordinary `pnpm build` use verification mode. The Node test proves same bytes with different directory enumeration order give one ID, a one-byte input change changes it, a symlink/unknown purpose fails, and verification output can never satisfy the release predicate. This is why all pre-Task-23 `pnpm build` commands remain executable before their changes are committed.

Only one `run` may own the controller. A second call while any run tuple or terminalization claim is active returns `not-started/RUN_ALREADY_ACTIVE` with zero Worker/storage side effects. After side-effect-free preflight chooses a new run ID, `run` acquires the exclusive Web Lock `fluxlab-run:<runId>` before `createRunningRun` and holds it across Worker ownership and terminal IndexedDB completion. A lock collision or unavailable qualified API returns `not-started/RUN_LOCK_UNAVAILABLE`; it creates no running row or Worker. `dispose()` is idempotent: when active it claims the tuple exactly like `cancel("project-changed")`, immediately detaches/terminates the synchronous WASM Worker, starts and awaits the one terminal IndexedDB transaction, releases the run lock, then resolves; when idle it only releases resources. Double cancel/dispose returns the already settled/null result and never writes another terminal state or releases another owner's lock.

Preflight parses the raw project, validates all models, resolves analysis, computes the normalized analysis hash, and captures only `enabled && assertion.analysisId === analysis.id` assertions sorted by ID plus their set hash. It passes the raw project/analysis/optional corner once to Task 8 `compileNetlist`, which alone applies the corner and runs graph/ERC; then it estimates resources from that exact result. Any blocker returns `not-started`; it creates no Worker and no RunRecord. Capture the full analysis, exact compiled netlist/model sources/sourceMap/vector plan, engine request and `requestedAssertions` before writing `running`; completion evaluates that immutable capture, never the then-current project.

- [ ] **Step 4: Implement the exact initialization and run correlations**

Create one Worker generation at a time. Initialization matches `{appBuildId, workerGeneration, requestId}`; a run matches `{appBuildId, workerGeneration, requestId, runId}`. The Worker rejects mismatched app build, fixed result transport/module/WASM/engine fingerprint, `run.corner !== compiled.appliedCorner`, or model list/manifest mismatch before FS write. It owns one `NgspiceRuntimeAdapter`, passes only `compiled.requestedRawVectors` (already sorted/unique) plus runtime limits, transfers the Task 11 validated snapshot buffers, and never re-derives names, implements a queue or soft cancellation.

- [ ] **Step 5: Make terminal ordering atomic**

Terminal ownership is a synchronous compare-and-swap on the active tuple before any asynchronous parse/evaluation/storage work. If a completed event claims first, cancel returns null and the claimed path alone may create the success; if cancel/timeout/dispose claims first, completed is ignored. On success: claim, parse Task 11 snapshot, create a non-persisted `CompletedRunCandidate`, call Task 12's captured evaluator—which reads only the candidate's immutable `requestedAssertions`—call `finishRunSuccess(candidate, evaluation)`, then persist the fully valid success once. Every success has exactly one initial `AssertionEvaluation`; when zero assertions were captured, its definitions/results are empty and its hash is the canonical empty-set hash. What is forbidden is an absent/empty `assertionEvaluations` array, not a numerical run with no enabled assertions; Task 16 blocks its delivery gate with `GATE_NO_ENABLED_ASSERTIONS`. Assertion `status: error` still belongs to a numerical success; the later gate blocks it. Initialization failure and any in-run `RESOURCE_LIMIT` claim, increment generation, detach and terminate that Worker before persisting failure; they never reuse possibly partial engine state. A normal convergence/run failure may retain the Worker only when the qualified adapter's `finally` cleanup completed successfully; cleanup failure also discards the generation. Timeout/cancel likewise claim first, increment generation, detach listeners, terminate the Worker, then atomically persist the terminal state and create the next Worker lazily. The controller releases its Web Lock only after the winning terminal transaction completes and no old Worker can emit; if persistence fails it still terminates the Worker, reports the dirty recovery state, and releases only after the failure path is settled. Resolve each caller promise once. Duplicate, late or mismatched events have no UI/storage effect.

- [ ] **Step 6: Cover every lifecycle state without arbitrary sleeps**

Use fake Workers, fake timers, a fake lock manager and deferred parse/IDB promises to prove: preflight blockers, `RUN_ALREADY_ACTIVE` and lock failure create zero extra Workers/records; the lock is acquired before running persistence and released only after terminal completion; initialization failure is legal without `verifiedEngine` and discards its generation; success includes input/evaluation evidence; normal adapter failure with proven cleanup, resource failure, cleanup failure, user cancel, project-change cancel and timeout have correct terminal/reuse semantics; resource failure→new generation→divider success; completed-claims→cancel and cancel-claims→completed each produce exactly the winning terminal; duplicate completed/double cancel fail closed; dispose active waits for terminal persistence, dispose idle is idempotent; A→cancel→B→late A is ignored; Task 11's two-page test proves live-owner recovery is skipped and released orphan recovery writes `RUN_INTERRUPTED`; cancellation returns to runnable state within the measured 500 ms product bound.

```powershell
node --test tests/release/build-identity-mode.test.mjs
pnpm exec vitest run client/src/simulation/simulation-controller.test.ts client/src/simulation/run-record.test.ts client/src/simulation/measurements.test.ts
pnpm build
pnpm exec playwright test tests/browser/ngspice-qualification.spec.ts --project=chromium --project=firefox --project=webkit
```

Expected: focused state tests pass, static build includes one hashed Worker, and all three real engine projects remain qualified.

- [ ] **Step 7: Record lifecycle evidence and commit**

```powershell
git add client/src/app/build-info.ts client/src/simulation/simulator.worker.ts client/src/simulation/simulation-controller.ts client/src/simulation/simulation-controller.test.ts client/src/storage/indexeddb.ts scripts/resolve-build-identity.mjs tests/release/build-identity-mode.test.mjs vite.config.ts docs/2026-08-28-circuit-simulator-modernization/04-progress.md docs/2026-08-28-circuit-simulator-modernization/05-verification.md
git commit -m "feat: run generation-safe ngspice workers"
```

### Task 14: Deliver a Real DC Operating-Point Workspace Slice

**Behavior:** 用户在统一工作台编辑真实分压/并联/多支路拓扑、运行 ngspice DC op、看到数值与完整来源；改变电气事实立即把旧结果标为历史，断线/理想源短路等 ERC 阻断时不会启动新 Worker。

**Files:**
- Create: `client/src/features/analysis/RunControls.tsx`
- Create: `client/src/features/analysis/RunHistory.tsx`
- Create: `client/src/features/analysis/ProvenanceInspector.tsx`
- Create: `client/src/features/analysis/DiagnosticsPanel.tsx`
- Create: `client/src/features/editor/ComponentPalette.tsx`
- Create: `tests/browser/divider-run.spec.ts`
- Modify: `client/src/app/ProjectWorkspace.tsx`
- Modify: `client/src/features/editor/SchematicCanvas.tsx`
- Modify: `client/src/features/editor/PropertiesPanel.tsx`
- Modify: `client/src/index.css`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- `RunControls` receives project, selected `analysisId`, controller status and typed callbacks; it never receives an adapter.
- `RunHistory` receives `RunRecord[]`; only `status: success` can be selected for numerical display.
- `ProvenanceInspector` renders app/engine build, project/electrical revisions, analysis/netlist/vector-plan/model hashes, corner and run timestamps from one record, and offers read-only expansion of the exact `inputBundle.netlist`, model source/hash, source map, vector plan, phased preflight warnings and bounded engine log. It never turns recorded text into an executable editor.
- `DiagnosticsPanel` groups schema/ERC/compiler/engine/assertion diagnostics without renaming their stable codes.
- `ComponentPalette` exposes supported v1 devices and dispatches the same `component/add` command as every other editor path; wiring uses the normal endpoint command, so acceptance tests never mutate IndexedDB/project JSON behind the UI.

- [ ] **Step 1: Write the failing browser journey against the production build**

```ts
import { expect, test } from "@playwright/test";

test("runs a real divider and never reuses it after an electrical change", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建分压项目" }).click();
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("vout-value")).toHaveText("6.000000 V");
  await expect(page.getByTestId("run-status")).toHaveText("成功 · 当前");
  await expect(page.getByText(/ngspice .* SHA-256/)).toBeVisible();

  await page.getByRole("button", { name: "选择 R2" }).click();
  await page.getByLabel("电阻（Ω）").fill("3000");
  await page.getByRole("button", { name: "应用参数" }).click();
  await expect(page.getByTestId("run-status")).toHaveText("成功 · 历史结果");
  await expect(page.getByTestId("vout-current-value")).toHaveText("尚无当前结果");
});
```

- [ ] **Step 2: Build and verify the browser test is RED**

```powershell
pnpm build
pnpm exec playwright test tests/browser/divider-run.spec.ts --project=chromium
```

Expected: FAIL because the workbench has no product run controls/result projection.

- [ ] **Step 3: Wire the controller into one workspace owner**

`ProjectWorkspace` creates one controller for its lifetime, calls `recoverInterruptedRuns` on load, cancels with `project-changed` before committing an electrical edit, and disposes on unmount. Keep progress and selected run ID in view state; project and run records remain in IndexedDB. Disable Run while save/preflight/run is active; Cancel is real only while running. Do not copy voltage into React project state.

- [ ] **Step 4: Project the operating-point record and provenance**

Show Vout, requested branch currents/power and logs only from a selected `SuccessfulRunRecord`. Recompute freshness against the current project and engine before labeling it current. Historical records remain selectable with a visible stale reason, but never populate a “current result” or pass badge. The inspector hashes the displayed exact netlist/model bytes and proves they equal the record hashes; engine line diagnostics navigate through the captured sourceMap to the then-current component/endpoint even if the live project later changes. A pre-run compile preview is separately labeled “未执行” and can never masquerade as RunRecord evidence. The Run button shows blocking schema/ERC/compiler diagnostics before engine creation.

- [ ] **Step 5: Add the ERC no-run and corrupt-result journeys**

Extend the browser spec: record the initial run count, remove the ground wire, press Run, assert `ERC_NO_GROUND` and unchanged run count; restore, rerun and get a new success. Inject a corrupted stored successful record with mismatched snapshot run ID, reload, and assert `RUN_SNAPSHOT_MISMATCH` while the valid project/run remains usable. Reuse Task 2's context-wide recorder: only GET/HEAD requests to the exact same-origin documents and build-manifest assets, including the qualified Worker (with bundled glue), WASM, manifest and Service Worker, are legal; every cross-origin request, non-GET/HEAD request, `/api` request or unknown same-origin path fails. Do not ban `fetch` itself because verified engine initialization necessarily fetches its same-origin WASM.

Through `ComponentPalette` and canvas wiring commands, add R3 = 2 kΩ in parallel with R2. Rerun and assert Vout `4.5 V ±1 µV`, R1 current `4.5 mA` and R2/R3 currents `2.25 mA` from the new run ID; the 6 V record remains historical and is never reused. Disconnect one R3 endpoint and prove `ERC_FLOATING_REQUIRED_PIN` starts zero new Workers. Restore it, then directly wire the 9 V source terminals together and prove `ERC_VOLTAGE_SOURCE_SHORT` starts zero Workers; remove the short and prove the multi-branch circuit succeeds again. Task 7/8 fixtures cover the same parallel, singleton-disconnect and ideal-source-short graphs deterministically.

Expand provenance for the newest run and assert displayed netlist/model/vector-plan hashes recompute to the record, the exact R1/R2/R3 lines are present, and one synthetic engine line diagnostic links through the stored sourceMap. Edit the live project afterward and prove the historical inspector still shows the captured input rather than recompiling it.

- [ ] **Step 6: Verify real behavior, then affected regressions**

```powershell
pnpm build
pnpm exec playwright test tests/browser/divider-run.spec.ts --project=chromium
pnpm exec vitest run client/src/lib/circuit-solver.test.ts client/src/simulation/simulation-controller.test.ts
```

Expected: ngspice Vout is `6 V ±1 µV`, then the edited parallel load is `4.5 V ±1 µV` with three traceable branch currents; provenance is visible; edit→stale, disconnect/short→zero new Worker and restore→new success are proven in the browser. The legacy divider formula remains only as a comparison fixture until Task 19.

- [ ] **Step 7: Update evidence and commit the vertical slice**

```powershell
git add client/src/app/ProjectWorkspace.tsx client/src/features/analysis client/src/features/editor client/src/index.css tests/browser/divider-run.spec.ts tests/fixtures/circuits/projects.ts docs/2026-08-28-circuit-simulator-modernization/04-progress.md docs/2026-08-28-circuit-simulator-modernization/05-verification.md
git commit -m "feat: run traceable dc operating points in the workspace"
```

### Task 15: Add DC Sweep, Transient, AC, Instruments, and Run Comparison

**Behavior:** 同一项目可配置四类分析并安全管理当前项目的 `.model/.subckt`；示波器、Bode、表格和比较只投影成功运行记录，并保留每个向量的探针、轴、单位和来源。

**Files:**
- Create: `client/src/features/analysis/AnalysisPanel.tsx`
- Create: `client/src/features/analysis/ProbePanel.tsx`
- Create: `client/src/features/models/ModelPanel.tsx`
- Create: `client/src/features/instruments/ResultDock.tsx`
- Create: `client/src/features/instruments/Oscilloscope.tsx`
- Create: `client/src/features/instruments/BodePlot.tsx`
- Create: `client/src/features/instruments/ResultTable.tsx`
- Create: `client/src/features/instruments/RunComparison.tsx`
- Create: `tests/browser/analysis-and-instruments.spec.ts`
- Modify: `client/src/app/ProjectWorkspace.tsx`
- Modify: `client/src/domain/project/templates.ts`
- Modify: `tests/fixtures/circuits/projects.ts`
- Modify: `client/src/features/analysis/RunHistory.tsx`
- Modify: `client/src/features/editor/PropertiesPanel.tsx`
- Modify: `client/src/index.css`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- `AnalysisPanel` edits only the exact `AnalysisDefinition` unions through project commands and shows estimator results before Run.
- `ProbePanel` resolves selectable endpoints/components through Task 7 and derives branch-current/device-power options only with Task 1's shared `parseQualifiedVectorManifest` plus `listQualifiedFamilies`; it shows an option only when `(quantity, component family, selected analysis)` exists in the matrix, dispatches normal `probe/upsert/remove` commands and prevents ambiguous branch-current choices.
- `ModelPanel` accepts pasted text or a local `.model/.lib/.cir` file, previews only Task 4 `opaque-model` output, and dispatches `model/upsert/remove` only after exact source/hash/interface validation; it never writes a project while preview contains a blocker.
- `PropertiesPanel` lists only compatible validated `modelRef`/subcircuit interfaces for D/Q/M/S/X and persists the exact selected subcircuit name/pin order through normal component commands.
- Every instrument prop is `run: SuccessfulRunRecord`; comparison is `left/right: SuccessfulRunRecord`. No instrument accepts `number[]` or a bare snapshot.
- Native SVG renders axes/paths; tables remain the accessible numerical alternative. No chart dependency is added.

- [ ] **Step 1: Write three failing engine-backed browser journeys**

The fixed cases are: diode DC sweep with model hash and monotonically rising current; 5 V/10 kΩ/100 µF RC transient with `V(1τ)=3.1606 V ±0.5%` and `V(5τ)=4.9663 V ±0.5%`; one-pole RC AC with db20/phase vectors and −3 dB cutoff within 1%. Each test opens a real template/project, runs through `SimulationController`, selects its successful RunRecord and inspects table plus SVG accessible description.

```powershell
pnpm build
pnpm exec playwright test tests/browser/analysis-and-instruments.spec.ts --project=chromium
```

Expected: RED because analysis/instrument UI does not exist.

- [ ] **Step 2: Implement exact analysis editors without free-form SPICE**

Provide numeric controls for DC source/start/stop/step, transient start/stop/step/max-step and AC scale/start/stop/point count. Parse engineering prefixes only at the input boundary and store finite SI numbers. The V/I property editor distinguishes “explicit DC” from “waveform-derived operating point”: new/user-created sources default to checked explicit 0; the checkbox may be cleared only when a transient waveform exists, producing absent `dcV/dcA` and visible explanatory text, while removing the last DC/AC/transient fact is rejected. Show predicted points/bytes from Task 9. Invalid direction, range, integer or resource limits produces a diagnostic and cannot dispatch a project command. Add the fixed diode-sweep and low-pass-AC fixture/template variants, including the diode model, source AC magnitude, analysis and probes; do not hide test-only analysis facts in the page.

`ProbePanel` adds node-voltage, differential-voltage, supported branch-current and device-power probes with stable generated IDs. It uses graph endpoints rather than free-form strings and surfaces `PROBE_AMBIGUOUS_BRANCH_CURRENT` for Q/M/X. For current/power it asks the shared matrix for the selected analysis and filters components by the returned families; no UI-local R/C/L/V/I/D/S or R/D allowlist is permitted. An absent tuple is not rendered as a selectable option. A forged/stale draft still goes through Task 8 compilation/domain validation and performs zero project or IndexedDB writes when the tuple is absent. AC or X power is visibly unsupported with `PROBE_UNSUPPORTED_DEVICE_POWER`, and Bode inputs are voltage/current only.

`ModelPanel` is the expert path for adding or replacing models in the current project without editing JSON. Read local bytes with the browser File API, enforce the Task 4/model/project size limits before preview, parse once, show normalized declarations/interfaces/hash/license note, and require explicit “采用模型”. A successful adoption dispatches one `model/upsert`; replacement remains blocked while existing component references are incompatible. A dangerous continuation such as `.model ...` followed by `+ .shell ...`, metadata/source drift or incompatible replacement produces diagnostics and zero command/IndexedDB writes. Add browser coverage that adopts a safe diode model, binds D1 in `PropertiesPanel`, runs it, then proves a dangerous model leaves project revision/model count unchanged.

- [ ] **Step 3: Render vectors with native SVG and accessible tables**

`Oscilloscope` accepts time/sweep axes; `BodePlot` pairs explicit db20 and phase vectors on a Hz axis; `ResultTable` offers axis plus selected vector columns. The table uses native pagination with a fixed maximum of 200 rows per page, O(1) page-count math and an O(page-size × visible-columns) slice; it never maps the full typed arrays into React nodes or adds a virtualization package. Accessible Previous/Next/page controls announce the absolute row range. An exact zero AC response is stored/displayed as `−∞ dB`; the SVG may clip it to the visible floor only for drawing and must label that point `−∞`, while tables never replace it with a finite floor. Downsample only SVG display pixels with a documented min/max bucket projection; measurements/export always use full stored arrays. Include `<title>/<desc>`, keyboard-selectable series, units and a table fallback. Do not derive authoritative RC/AC data in the UI.

- [ ] **Step 4: Compare two immutable runs honestly**

Allow selecting two successful records for the same analysis kind. Display revision, engine/model/corner differences before overlaying compatible units/axes; interpolate only for visual comparison and label it as display interpolation. Historical/stale records remain marked and never drive current verification. Corrupt or failed records cannot be selected as numerical sides.

- [ ] **Step 5: Prove probes and cancellation**

Add browser assertions that node voltage, differential voltage, an unambiguous branch current and device power all show the selected `runId`; an ambiguous Q/M/X branch-current probe is blocked. The test starts a verification fixture from the same parsed manifest with the independent-current-source tuple removed: the I-source current option must be absent from `ProbePanel`; submitting the equivalent forged draft through the production command boundary returns the unsupported diagnostic, leaves project revision/probe count unchanged and causes zero IndexedDB writes. This fixture changes only the injected parsed matrix for the test and is never a release asset. During the RC run click Cancel, assert terminal `cancelled`, no waveform, and Run enabled again within 500 ms; rerun to success.

- [ ] **Step 6: Verify analyses, result parser, and browser behavior**

```powershell
pnpm exec vitest run client/src/simulation/compile-netlist.test.ts client/src/simulation/result-parser.test.ts client/src/simulation/resource-estimator.test.ts
pnpm build
pnpm exec playwright test tests/browser/analysis-and-instruments.spec.ts --project=chromium
```

Expected: numerical tolerances pass, axis/vector provenance is exact, cancel has no partial snapshot, and all instrument values trace to a selected success record.

- [ ] **Step 7: Commit the four-analysis product slice**

```powershell
git add client/src/features/analysis client/src/features/models client/src/features/instruments client/src/features/editor/PropertiesPanel.tsx client/src/app/ProjectWorkspace.tsx client/src/domain/project/templates.ts tests/fixtures/circuits/projects.ts client/src/index.css tests/browser/analysis-and-instruments.spec.ts docs/2026-08-28-circuit-simulator-modernization/04-progress.md docs/2026-08-28-circuit-simulator-modernization/05-verification.md
git commit -m "feat: add traceable analyses instruments and comparisons"
```

### Task 16: Plan Corners and Gate Only Complete Current Evidence

**Behavior:** nominal 与每个启用角点顺序运行并各自留下独立记录；交付状态只有在当前分析、引擎、模型、断言和所有角点证据完整时才可能通过。

**Files:**
- Create: `client/src/simulation/verification.ts`
- Create: `client/src/simulation/verification.test.ts`
- Create: `client/src/features/verification/VerificationPanel.tsx`
- Create: `tests/browser/verification-gates.spec.ts`
- Modify: `client/src/simulation/simulation-controller.ts`
- Modify: `client/src/app/ProjectWorkspace.tsx`
- Modify: `client/src/storage/indexeddb.ts`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- `type PlannedRun = Readonly<SimulationRunInput>` from Task 13; each plan therefore carries the original `project`, one `analysisId`, and at most one `{ definition, ordinal, total }` corner input accepted directly by `controller.run`.
- `planAnalysisRuns(project, analysisId): DomainResult<PlannedRun[]>` returns `{ project, analysisId }` nominal first, then the same unmodified project plus enabled corner definitions by stable ID; it never applies overrides or creates a derived project.
- `runAnalysisSeries(controller, runs): Promise<SeriesRunResult>` passes each `PlannedRun` unchanged to `controller.run` serially; the result is `{ status: "completed" | "stopped"; records: RunRecord[]; diagnostics: Diagnostic[] }`, and unstarted entries create no fake record.
- `reevaluateAssertions(project, run): Promise<DomainResult<SuccessfulRunRecord>>` appends one transaction without ngspice.
- `validateAssertionDraft(project, draft): Promise<DomainResult<AssertionDefinition>>` and `validateCornerDraft(project, draft): Promise<DomainResult<CornerDefinition>>` are the only form-to-domain boundaries; invalid drafts dispatch no project command.
- `buildDeliveryGateInput(project, analysis, engine, runs, erc): Promise<DomainResult<DeliveryGateInput>>` computes the current analysis/assertion/model/corner hashes with Web Crypto.
- `evaluateDeliveryGate(input: DeliveryGateInput): DeliveryGateResult` is synchronous over the already computed evidence key and returns `passed | failed | blocked`, diagnostics and exact evidence run IDs.

- [ ] **Step 1: Write the failing missing-corner gate test**

```ts
import { expect, it } from "vitest";
import { evaluateDeliveryGate } from "./verification";

it("blocks when nominal passes but an enabled corner is missing", () => {
  const result = evaluateDeliveryGate(gateFixture({ nominal: passingRun(), corners: [] }));
  expect(result.status).toBe("blocked");
  expect(result.diagnostics[0].code).toBe("GATE_MISSING_CORNER_RUN");
});
```

- [ ] **Step 2: Run focused verification tests and verify RED**

```powershell
pnpm exec vitest run client/src/simulation/verification.test.ts
```

Expected: FAIL because verification planning/gate module does not exist.

- [ ] **Step 3: Implement stable series planning and cancellation semantics**

Create exactly one nominal `SimulationRunInput` and one for each enabled corner sorted by `CornerId`; ordinal/total describe that fixed corner list. The planner validates references but does not mutate values. Pass each input unchanged through the same controller; only the controller's Task 13 preflight invokes Task 8 once to apply its optional corner before graph/compile. Cancel terminates the current record and stops the loop; unstarted plans remain absent. Never copy nominal data into a corner or pre-apply then apply an override again. A corner definition failure returns `not-started` diagnostics and blocks the series.

- [ ] **Step 4: Implement the full three-state gate**

The async builder validates and precomputes the exact current evidence key; the synchronous evaluator never reimplements SHA-256. It runs the same current-app preflight/compile for nominal and every enabled corner and supplies the resulting `netlistHash/vectorPlan` to `checkRunFreshness`. For each nominal/corner evidence slot, join each parsed record to its validated `StoredRunEnvelope` summary and select the greatest project-scoped `localAttempt`; `startedAt` is display metadata only. A newer failed/cancelled/timeout/corrupt attempt blocks the slot and the builder must not search backward for an older success. Require no blocking schema/ERC/migration diagnostic; at least one enabled assertion for the target analysis; exact current `appBuildId`, project ID/electrical revision, analysis/netlist/vector-plan/model/engine/corner hashes; one fresh successful newest attempt for nominal and each enabled corner; and an `AssertionEvaluation` matching the current hash of enabled definitions for that target `analysisId` on every selected run. Empty assertions return `GATE_NO_ENABLED_ASSERTIONS` and blocked. Complete evidence with any normal assertion failure is `failed`. Missing/failed/cancelled/timeout/stale/corrupt run, assertion error/hash mismatch or blocker is `blocked`. Only complete and all-passed is `passed`; assertions belonging to another analysis do not enter this gate. Unit tests always exercise builder→evaluator, including identical timestamps, a clock rollback, changed assertion hash, changed current app build, changed compiler output with an unchanged electrical revision, and success→greater-localAttempt failure/cancel→blocked→newest success recovery. Export/import never carries the local counter; Task 18 adoption assigns a new one.

- [ ] **Step 5: Reevaluate changed assertions without rerunning numbers**

When only assertions change, load a still-fresh success record, evaluate Task 12 against the new set, append transactionally and update the gate. Record the run count before/after in a test; it must not change. An altered analysis, probe, model, corner or electrical revision requires a new engine run.

- [ ] **Step 6: Implement real assertion and corner CRUD in VerificationPanel**

Assertion creation/editing uses only selectors derived from the chosen analysis and its deterministic vector plan: function, vector, at/threshold/edge, comparator, expected/min/max/tolerances and units. Unit choices are constrained by the selected axis/vector dimension; no free-form unit or vector ID field exists. Corner creation/editing starts from a concrete component, then offers only its applicable `CornerParameterPath` values or compatible model replacements; subcircuit override names come from its validated interface. “采用” first calls the draft validator and dispatches exactly one `assertion/upsert` or `corner/upsert`; delete dispatches the corresponding remove command after confirmation. An invalid imported/forged draft shows diagnostics and performs zero reducer, revision, save-lane or IndexedDB writes. The panel also exposes enabled toggles and clearly marks assertion edits as reevaluable without ngspice while corner edits require a new run.

- [ ] **Step 7: Prove CRUD and all gate states in the browser**

Through visible controls, the browser spec creates, edits and deletes an assertion and low/high resistor corners, then recreates the required set, runs nominal+corners, and asserts three distinct run IDs/corner hashes. Before adoption it injects an invalid assertion unit and forged corner path, recording project revision, save-lane calls and raw stored revision before/after; all remain byte-for-byte unchanged. It exercises passed, a normal between failure, an invalid-unit evaluation error, missing corner, cancel and stale project. After a passing slot, create a greater-`localAttempt` failed/cancelled attempt with the same timestamp and a clock-rollback timestamp and prove the gate blocks instead of reusing the old pass; a still greater successful attempt restores it. It then changes only tolerance, presses “重新评估断言”, observes unchanged numerical run count and a new assertion-evaluation hash.

```powershell
pnpm exec vitest run client/src/simulation/verification.test.ts client/src/simulation/measurements.test.ts client/src/simulation/run-record.test.ts
pnpm build
pnpm exec playwright test tests/browser/verification-gates.spec.ts --project=chromium
```

Expected: gate states match the exact evidence matrix; no default or hard-coded pass exists.

- [ ] **Step 8: Commit evidence-bound verification**

```powershell
git add client/src/simulation/verification.ts client/src/simulation/verification.test.ts client/src/simulation/simulation-controller.ts client/src/features/verification client/src/app/ProjectWorkspace.tsx client/src/storage/indexeddb.ts tests/browser/verification-gates.spec.ts docs/2026-08-28-circuit-simulator-modernization/04-progress.md docs/2026-08-28-circuit-simulator-modernization/05-verification.md
git commit -m "feat: gate nominal and corner run evidence"
```

## Phase 5 — Teach, Exchange, and Retire the Toy Product

### Task 17: Add Guided Learning on the Same Project and Evidence Stores

**Behavior:** foundation/intermediate/engineering 只是同一工作台的引导层；预测、真实编辑、真实运行、断言与 checkpoint 形成可追踪学习证据，展开工作台不复制项目。

**Files:**
- Create: `client/src/features/learning/contracts.ts`
- Create: `client/src/features/learning/lessons.ts`
- Create: `client/src/features/learning/lessons.test.ts`
- Create: `client/src/features/learning/LessonCatalog.tsx`
- Create: `client/src/features/learning/LessonOverlay.tsx`
- Create: `client/src/features/learning/evidence.ts`
- Create: `tests/browser/learning-flow.spec.ts`
- Modify: `client/src/app/routes.tsx`
- Modify: `client/src/app/ProjectWorkspace.tsx`
- Modify: `client/src/domain/project/templates.ts`
- Modify: `client/src/features/project-library/ProjectLibrary.tsx`
- Modify: `client/src/storage/indexeddb.ts`
- Modify: `client/src/storage/indexeddb.test.ts`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- `LessonDefinition.templateKey` uses the exact design union; it never contains a future random project ID.
- `createTemplateForKey(key, projectId, createdAt)` is the one template registry; `engineering-review` creates the validated Task 15 low-pass engineering project rather than a separate lesson-only state.
- `validateLessonDefinition(lesson, template): Diagnostic[]`, `canPerformLessonAction(step, action): boolean`, and `completeLessonStep(input): Promise<DomainResult<LearningEvidence>>`.
- `indexeddb.ts` adds the only implementations of `parseStoredLearningEvidenceEnvelope(input)`, `deriveLearningEvidenceEnvelope(evidence, storageVersion)`, `putLearningEvidence(expectedStorageVersion, evidence)`, `loadLearningEvidence(projectId, lessonId)`, `listLearningEvidenceForLesson(lessonId)` and `deleteLearningEvidence(projectId, lessonId, expectedStorageVersion)`; all return `DomainResult`, and load/list return validated envelopes so callers retain the CAS version.
- `deriveLearningEvidenceEnvelope` computes `lessonKey=[lessonId,projectId]`, `projectKey=[projectId,lessonId]` and `referencedRunIds=[...new Set(evidence.steps.map(step => step.runId))].sort()`; `parseStoredLearningEvidenceEnvelope` uses the same derivation after strict schema parsing and rejects any stored-field drift. The store uses `lessonKey` as primary key plus `lessonKey`, `projectKey` and multi-entry `referencedRunIds` indexes.
- Settings adds only `saveLessonSession(session)` and `loadLessonSession(lessonId)` over the Task 6 parser/derivers and exact `lesson-session:<lessonId>` key. They accept/return only `Extract<StoredSettingValue,{kind:"lesson-session"}>`; no generic setting API is exported. The record is navigation state, not completion evidence or a user preference.
- Task 6's `deleteProject(projectId)` remains the sole explicitly confirmed cascade transaction. Task 17 proves it atomically covers project, sequence, runs, lesson evidence and navigation records whose `projectKey` references the project; every cascade uses index `openKeyCursor`/primary-key delete rather than loading large values. Cancellation or any transaction failure writes nothing and success leaves no orphan IDs.

- [ ] **Step 1: Write failing registry, envelope, and dedicated-storage tests**

```ts
import { expect, it } from "vitest";
import { validateLessonDefinition } from "./lessons";

it("blocks a lesson that references a missing analysis or assertion", async () => {
  const diagnostics = await validateLessonDefinition(brokenLesson(), await dividerTemplate());
  expect(diagnostics.map(item => item.code)).toEqual(["LESSON_UNKNOWN_ANALYSIS", "LESSON_UNKNOWN_ASSERTION"]);
  expect(diagnostics.every(item => item.blocksRun)).toBe(true);
});
```

Add exact tests that a derived envelope has sorted-unique `referencedRunIds`; altered `lessonKey`, `projectKey` or run index fails `parseStoredLearningEvidenceEnvelope`; a lesson-session kind/key/payload mismatch fails the shared setting parser; and no exported symbol permits raw settings-store access. Extend the Task 11 real-browser deletion case after seeding target evidence, lesson-session and last-opened rows: cancel preserves all five stores; confirm removes every target-owned row but retains global `local-settings`, legacy notices and an unrelated project. The separate rollback case must fail the final `settings.projectKey` `openKeyCursor`, not another delete: wrap only that native index call, obtain its real request, abort its active transaction before the cursor completes so the request/transaction error path runs, restore the prototype in `finally`, and prove the complete target graph remains readable.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
pnpm exec vitest run client/src/features/learning/lessons.test.ts client/src/storage/indexeddb.test.ts
```

Expected: FAIL because the lesson registry/evidence modules do not exist.

- [ ] **Step 3: Implement the four fixed lessons and route ownership**

Register foundation divider, foundation LED, intermediate RC and engineering review. Validate prerequisite IDs for unknown/self/cycles and require every step's `assertionIds` to be non-empty, unique and owned by `requiredAnalysisId`. `listLearningEvidenceForLesson` bounds the `lessonKey` index; Task 6 deletion bounds `projectKey`; neither uses `getAll`. Reads finish the readonly cursor transaction before async envelope/run validation and return valid entries plus diagnostics for corrupt ones. Catalog lock state is derived across all projects only from entries that pass `parseStoredLearningEvidenceEnvelope`, contain every declared lesson step exactly once, and whose step run/assertion references still validate; a partial, duplicate-step, unknown-step, key drift or corrupt row never unlocks a prerequisite. V1 has no skip shortcut. On `/learn/:lessonId`, call `loadLessonSession(lessonId)` and require its project ID/template key to agree; if it references a valid project and matching key, reopen it, otherwise create a new template project with `crypto.randomUUID()`, save it, then call `saveLessonSession`. “重新开始” explicitly creates a new project after confirmation and atomically replaces only that lesson's mapping. Never reuse an unrelated last-opened project or invent a success snapshot.

- [ ] **Step 4: Enforce allowed actions and evidence completion**

Guided mode hides/disables actions outside the current step but uses the normal command/controller paths for allowed actions. Completion requires a non-empty prediction, exact current project revision, a fresh successful run for `requiredAnalysisId`, and passed assertion-result IDs declared by the step. `putLearningEvidence` alone calls `deriveLearningEvidenceEnvelope`; callers never supply keys or `referencedRunIds`. Its short CAS writes evidence and all derived indexes atomically. Run pruning/deletion queries the multi-entry index in the same decision path, fully parses every hit and returns `RUN_REFERENCE_EXISTS` on a valid hit or `RUN_REFERENCE_CHECK_CORRUPT` on a malformed candidate; it never trusts a caller-provided protected list alone. The user must explicitly call `deleteLearningEvidence` or export then delete it before that run can be removed.

- [ ] **Step 5: Prove the same-project journeys**

In the browser: divider predicts, runs 6 V, saves checkpoint, expands to standard/expert and keeps URL projectId/revision/run history; LED begins at 5 V/680 Ω and cannot complete near 4.4 mA, then a real change to 330 Ω yields 8–12 mA and passes; RC uses the real transient run to show the 63.2% checkpoint. Modify R2 after a completed divider step and prove the old run becomes historical before a new run can satisfy the next step. Run the five-store project-deletion cancel/success/final-settings-cursor-failure cases from Step 1 in the same real Chromium spec, restoring the cursor monkeypatch in `finally`.

- [ ] **Step 6: Verify evidence, storage, and no business network**

```powershell
pnpm exec vitest run client/src/features/learning/lessons.test.ts client/src/storage/indexeddb.test.ts client/src/simulation/measurements.test.ts
pnpm build
pnpm exec playwright test tests/browser/learning-flow.spec.ts --project=chromium
```

Expected: lesson evidence contains lesson/step/project/run/prediction/assertion IDs/timestamp; a completed prerequisite in another project unlocks the next lesson, while partial/corrupt/unknown-step evidence does not; projectId never changes on view-mode expansion; deletion cancellation is a no-op, confirmed deletion removes only the target graph across five stores, a failed final settings cursor rolls everything back and reports a diagnostic, and no LocalStorage completion string or network upload is used.

- [ ] **Step 7: Commit the shared learning layer**

```powershell
git add client/src/features/learning client/src/app/routes.tsx client/src/app/ProjectWorkspace.tsx client/src/domain/project/templates.ts client/src/features/project-library/ProjectLibrary.tsx client/src/storage/indexeddb.ts client/src/storage/indexeddb.test.ts tests/browser/learning-flow.spec.ts docs/2026-08-28-circuit-simulator-modernization/04-progress.md docs/2026-08-28-circuit-simulator-modernization/05-verification.md
git commit -m "feat: add evidence-backed learning to the shared workspace"
```

### Task 18: Import, Preview, Migrate, and Export Projects, Runs, CIR, and CSV

**Behavior:** 四种文件路线共享 schema、SPICE parser、hash 与大小限制；任何导入先显示候选摘要并由用户明确采用，旧项目和危险文本不能半写入当前项目。

**Files:**
- Create: `client/src/storage/project-files.ts`
- Create: `client/src/storage/project-files.test.ts`
- Create: `client/src/features/project-library/ImportProjectDialog.tsx`
- Create: `client/src/features/project-library/LegacyMigrationCard.tsx`
- Create: `client/src/features/analysis/ExportMenu.tsx`
- Create: `tests/fixtures/imports/malformed.json`
- Create: `tests/fixtures/imports/oversized.fluxproj.json`
- Create: `tests/fixtures/imports/cir-equivalence.cir`
- Create: `tests/fixtures/imports/cir-no-analysis.cir`
- Create: `tests/fixtures/imports/cir-multiple-analyses.cir`
- Create: `tests/fixtures/imports/cir-self-contained-subckt.cir`
- Create: `tests/browser/project-files.spec.ts`
- Modify: `client/src/features/project-library/ProjectLibrary.tsx`
- Modify: `client/src/app/ProjectWorkspace.tsx`
- Modify: `client/src/storage/indexeddb.ts`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- `parseFluxProject(text): Promise<DomainResult<ProjectImportPreview>>`, `serializeFluxProject(project): Promise<DomainResult<string>>`.
- `type TerminalRunRecord = Exclude<RunRecord, { status: "running" }>` and `type FluxRunVectorMode = "full" | "omitted"`; `parseFluxRun(text): Promise<DomainResult<RunImportPreview>>`, `serializeFluxRun(run: TerminalRunRecord, vectorMode: FluxRunVectorMode): Promise<DomainResult<string>>`. The runtime boundary still rejects a cast/foreign running value with `RUN_EXPORT_NOT_TERMINAL`.
- `parseCirProject(text, metadata): Promise<DomainResult<ProjectImportPreview>>`, `serializeCir(project, analysisId): Promise<DomainResult<string>>`.
- `serializeVectorsCsv(run, vectorIds): DomainResult<string>`.
- `encodeImportedSpiceNode(rawNode): Promise<DomainResult<string | null>>` returns `null` only for raw token `0`; it implements the design §9.2 safe-label algorithm.
- `adoptProjectPreview(preview, current, adoptedAt): Promise<DomainResult<CircuitProjectV2>>` creates a new ID by default; explicit overwrite preserves current ID and increments revisions monotonically.
- `adoptRunPreview(preview, currentProject): Promise<DomainResult<RunRecord>>` accepts only a full authoritative envelope, an existing matching project ID and a non-conflicting original run ID; it uses IndexedDB `add`, never overwrite.

- [ ] **Step 1: Write failing trust-boundary and round-trip tests**

```ts
import { expect, it } from "vitest";
import { parseFluxProject, serializeFluxRun } from "./project-files";

it("rejects a model that hides shell in a continuation", async () => {
  const result = await parseFluxProject(fluxProjectWithModel(".model D D(IS=1e-12)\n+ .shell bad"));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.diagnostics[0].location).toMatchObject({ line: 1, endLine: 2 });
});

it("cannot serialize a failed run as successful evidence", async () => {
  const result = await serializeFluxRun(failedRunFixture(), "full");
  expect(result.ok && JSON.parse(result.value).run.status).toBe("failed");
});
```

- [ ] **Step 2: Run focused file tests and verify RED**

```powershell
pnpm exec vitest run client/src/storage/project-files.test.ts client/src/domain/project/migrate-v1.test.ts
```

Expected: FAIL because the file codec does not exist.

- [ ] **Step 3: Implement size-first candidate parsing**

Before reading a browser File, enforce `File.size`; after decoding, measure UTF-8 bytes before JSON parse. `.fluxproj` uses the 15 MiB project limit and `.fluxrun` uses a hard 134,217,728-byte text ceiling, sized for at most 64 MiB of base64 snapshot bytes plus the bounded input bundle and JSON overhead; exceeding it is rejected before `JSON.parse` or base64 allocation. Parse version, Task 3 schema and Task 4 normalized model text.

`.cir` calls Task 4 once in `editable-circuit` mode, then consumes only its discriminated element fields, `scope`, `declarationBlocks` and structured analyses. It must never split, regex, tokenize or reinterpret `statement.text`. Only `scope.kind="top-level"` elements become fixed-grid components/wires. Each top-level `.model` declaration block becomes one exact `spice-model` definition. Every complete `.subckt/.ends` block becomes one `spice-subckt` ModelDefinition using its canonical block source/interface; its internal elements/models/parameters remain opaque and never become canvas components or top-level nodes. A block with non-empty external model/subcircuit dependencies fails `CIR_SUBCKT_EXTERNAL_REFERENCE` at the recorded range rather than duplicating definitions and invoking last-definition-wins. Only top-level X instances bind that bundle/interface.

Map D/Q omitted area to 1; a top-level Q with `substrateNode` fails `CIR_BJT_SUBSTRATE_UNSUPPORTED` because the v1 BJT domain has only c/b/e pins—never discard the fourth node. M must already contain explicit positive L/W and maps omitted multiplicity to 1. For V/I, an empty or AC-only source with no explicit DC maps to explicit 0; if PULSE/SIN/PWL exists without DC, preserve absent `dcV/dcA` so Task 8 omits the DC token and ngspice uses waveform time-zero. Include PULSE(initial≠0) regression coverage. Map zero analysis directives to `analyses: []` with a blocking-before-run preview notice; map every top-level analysis directive in source order to a distinct deterministic ID containing ordinal+canonical hash, including duplicates, and resolve each `.dc` source refdes exactly. Never select only the first directive or ask one product run to execute multiple directives.

For nodes, raw `0` alone gets a ground component. Uppercase the remaining raw token; preserve it only when it matches the project-label regex, is not `GND`, and does not start `SPICE_`; otherwise emit `SPICE_` plus the full lowercase SHA-256 of its canonical UTF-8 bytes. Keep a raw→label preview map and reject any canonical/hash collision. Build one deterministic endpoint chain per mapped node. Because the v1 schematic schema stores labels on wires, a non-ground node appearing at only one endpoint cannot be represented without losing its identity; reject the whole candidate with `CIR_SINGLETON_NODE_UNREPRESENTABLE` and its node/physical line instead of silently dropping it. Because user `.save` is forbidden, import creates no guessed probes: preview lists “0 probes” and requires Task 15 `ProbePanel` before Run. Add AST-only tests that alter misleading `statement.text` while preserving typed fields and prove mapping cannot depend on text.

Define a versioned `.fluxrun` envelope with `format: "fluxrun"`, `formatVersion: 1`, and `vectorMode: "full" | "omitted"` only. Full typed arrays use `{ encoding: "f64-le-base64"; length: number; data: string }`; validate base64 characters, decoded byte length exactly `length * 8`, endianness and all byte/point/snapshot ceilings before allocation, then await Task 11 `parseRunRecord`. Reject `status: "running"` on import with `RUN_IMPORT_NOT_TERMINAL` before preview/adoption even if the generic run schema can parse it. An omitted success envelope decodes only to `kind: "reference-only"`, never passes `parseRunRecord`, enters the runs store or drives a gate. Failed/cancelled/timeout records have no vectors and remain their original terminal status. No third/partial-vector mode exists and no parser writes IndexedDB.

- [ ] **Step 4: Implement deterministic exports**

Canonical `.fluxproj` excludes runs. Full `.fluxrun` includes terminal status, immutable input bundle, assertion history and lossless f64-le arrays; omitted mode emits a reference-only envelope that states it is not a `RunRecord`. Test running import/export rejection, an unknown third vector-mode rejection, just-below/above 128 MiB, truncated, wrong-length and malformed base64. Editable `.cir` is not the internal execution netlist: emit a constant safe title; put optional project title/provenance only on comment lines after stripping CR/LF, NUL and all control characters and prefixing every emitted line with `*`; emit supported top-level elements and each selected analysis, inline already validated referenced `.model/.subckt` blocks once, omit compiler-owned `.include/.options/output` directives, and emit one final `.end`, so Task 4 can import it again. V/I explicit DC, empty/AC-only zero, transient-only absent DC, PULSE/SIN/PWL, D/Q area, M L/W/M, X and all four analyses must serialize→Task 4 AST→project round-trip without another parser. CSV uses RFC 4180 quoting, LF, explicit axis/vector IDs/units and round-trip decimal values; the sole non-finite result exception is written literally as `-Infinity` only for a `db20` vector and is never parsed as zero or a finite floor. Generate Blob downloads locally; do not call an API.

- [ ] **Step 5: Adopt candidates without revision rollback**

The dialog shows version, project/title, counts, models/hashes, analyses, warnings, discarded evidence and blockers before enabling Adopt. Default project adoption generates a new project ID with revisions `1/1`. Explicit same-project overwrite compares current/candidate electrical content, uses current `revision + 1`, and uses `electricalRevision + 1` only when electrical content differs. Save the fully validated candidate in one transaction. Never dispatch dozens of UI commands or expose the removed `replace-from-import` action.

For runs, only a full envelope that passes Task 11, references an existing same-ID project and has a new run ID may be adopted with `add`; never change its run ID because every provenance hash depends on it. Adoption uses the same `runSequences+runs+project revisionKey` allocator as `createRunningRun` to assign a new local `localAttempt`; imported files never supply or preserve that counter. A full imported success is historical unless its complete freshness key independently matches the current project/engine, at which point it may participate in the gate as this newly adopted attempt. Foreign-project and omitted envelopes remain downloadable/reference previews only and cannot be adopted or overwrite a record.

- [ ] **Step 6: Expose v1 and LocalStorage migration honestly**

Check only the three known project keys `circuit-simulator:active-document`, `circuit-simulator:rc-charge` and `circuit-simulator:led-lab`, showing a separate preview card for divider, RC and LED data; never scan or clear all LocalStorage. Read the exact old progress key `circuit-simulator:learning-progress` only to list it as discarded evidence; never import it as lesson completion. Do not parse/adopt until clicked. Adopting the old RC candidate preserves p/n wiring and unconnected cp/cn; it remains ERC-blocked after reload until the user rewires it. Each source key has its own separate confirmed Clear action enabled only after that candidate saves successfully as v2; progress has its own explicit discard/clear confirmation.

- [ ] **Step 7: Verify all routes in a real browser**

The browser spec round-trips v2 project, successful and failed run, safe `.cir` and selected CSV vectors; rejects malformed/unknown/oversized input, an unknown third vector mode and `.control/.shell/.include` including continuation bypass; previews then adopts v1 divider/LED/RC; proves no partial project after failure and no business network request. It also runs the fixed equivalence suite in the real browser: execute the original safe fixture through the qualified direct adapter, import the same bytes, add explicit probes, compile/run each imported analysis through `SimulationController`, and compare axes/vectors within the fixed tolerances. Cover numeric/GND-as-nonzero node encoding, zero/multiple analyses, PULSE(initial≠0) without DC, D/Q area default, M L/W/M default and a self-contained subcircuit whose internals never appear on the canvas. Use browser File/Download APIs rather than calling codec functions through the page.

```powershell
pnpm exec vitest run client/src/storage/project-files.test.ts client/src/domain/project/migrate-v1.test.ts client/src/simulation/run-record-schema.test.ts
pnpm build
pnpm exec playwright test tests/browser/project-files.spec.ts --project=chromium
```

Expected: all formats preserve declared semantics/status; imported failures never become success; dangerous text never reaches storage/Worker; RC migration remains a repairable candidate.

- [ ] **Step 8: Commit the complete file boundary**

```powershell
git add client/src/storage/project-files.ts client/src/storage/project-files.test.ts client/src/features/project-library client/src/features/analysis/ExportMenu.tsx client/src/app/ProjectWorkspace.tsx client/src/storage/indexeddb.ts tests/fixtures/imports tests/browser/project-files.spec.ts docs/2026-08-28-circuit-simulator-modernization/04-progress.md docs/2026-08-28-circuit-simulator-modernization/05-verification.md
git commit -m "feat: import migrate and export trusted circuit evidence"
```

### Task 19: Redirect Legacy Routes and Delete Every Competing Solver

**Behavior:** 旧链接只把用户带到已验收的新课程/当前工作台；五个演示页面、三套生产公式求解器和硬编码门禁不再进入源码依赖图或构建产物。

**Files:**
- Create: `client/src/app/LegacyRedirect.tsx`
- Create: `tests/fixtures/circuits/analytic-baselines.ts`
- Create: `tests/browser/legacy-routes.spec.ts`
- Modify: `client/src/app/routes.tsx`
- Modify: `client/src/app/ProjectWorkspace.tsx`
- Modify: `client/src/features/project-library/ProjectLibrary.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/storage/indexeddb.ts`
- Modify: `client/src/storage/indexeddb.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Delete: `client/src/pages/Home.tsx`
- Delete: `client/src/pages/DividerLab.tsx`
- Delete: `client/src/pages/LEDLab.tsx`
- Delete: `client/src/pages/EngineeringStudio.tsx`
- Delete: `client/src/pages/EngineeringOps.tsx`
- Delete: `client/src/components/CircuitCanvas.tsx`
- Delete: `client/src/components/LEDCanvas.tsx`
- Delete: `client/src/components/RCChargeCanvas.tsx`
- Delete: `client/src/components/Oscilloscope.tsx`
- Delete: `client/src/lib/circuit-model.ts`
- Delete: `client/src/lib/circuit-model.test.ts`
- Delete: `client/src/lib/circuit-solver.ts`
- Delete: `client/src/lib/circuit-solver.test.ts`
- Delete: `client/src/lib/led-solver.ts`
- Delete: `client/src/lib/led-solver.test.ts`
- Delete: `client/src/lib/rc-charge-solver.ts`
- Delete: `client/src/lib/rc-charge-solver.test.ts`
- Delete: `client/src/lib/engineering-core.ts`
- Delete: `client/src/lib/engineering-core.test.ts`
- Delete: `client/src/lib/engineering-ops.ts`
- Delete: `client/src/lib/engineering-ops.test.ts`
- Delete: `client/src/lib/experiment-export.ts`
- Delete: `client/src/lib/experiment-export.test.ts`
- Delete: `client/src/lib/time-microscope.ts`
- Delete: `client/src/lib/time-microscope.test.ts`
- Modify: `client/src/index.css`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- `LegacyRedirect` maps `/divider`→`/learn/foundation-divider` and `/led`→`/learn/foundation-led` with replace navigation.
- `indexeddb.ts` adds only `saveLastOpenedProject(projectId)`, `loadLastOpenedProject()`, `acknowledgeLegacyNotice(path)` and `hasAcknowledgedLegacyNotice(path)`; all reuse Task 6's setting parser/derivers and fixed `last-opened-project` / `legacy-notice:<path>` keys. No caller reads or writes the raw settings store.
- `/engineering` and `/engineering/ops` use `loadLastOpenedProject()`; a valid project opens `/project/:id?panel=analysis|verification`, otherwise `/` shows “请先选择项目”.
- `analytic-baselines.ts` exports only divider/RC reference functions for tests; no `client/src/**` file may import it. Fixed-drop LED has no compatibility baseline.

- [ ] **Step 1: Add failing direct-navigation tests for every old URL**

The browser test starts from a fresh profile and a profile with a valid last-opened project. It directly navigates then reloads each old URL. Divider/LED retain the new lesson project mapping; engineering routes select the correct panel for a valid project and return to the library without creating a default project when missing. Each redirect shows one persisted migration notice, then suppresses it on the next visit. In `indexeddb.test.ts`, prove the four dedicated APIs emit only the fixed keys, reject a wrong kind/key/projectKey through the shared parser, and expose no generic raw-setting accessor.

```powershell
pnpm exec vitest run client/src/storage/indexeddb.test.ts
pnpm build
pnpm exec playwright test tests/browser/legacy-routes.spec.ts --project=chromium
```

Expected: RED because the dedicated navigation APIs are absent and old pages still own the routes.

- [ ] **Step 2: Implement deterministic redirects and current-project ownership**

Whenever a validated workspace opens, call `saveLastOpenedProject(projectId)`; `LegacyRedirect` calls `loadLastOpenedProject()` and validates the returned ID through `loadProject`, never trusting a raw string. Migration copy calls only `hasAcknowledgedLegacyNotice(path)` and `acknowledgeLegacyNotice(path)` for the four schema-enumerated paths. Keep redirects for exactly one release cycle and document their planned removal version; they contain no simulation logic. Task 6's sole `deleteProject` transaction uses the settings `projectKey` index to remove matching last-opened/lesson-session pointers without touching global preferences or notice acknowledgements.

- [ ] **Step 3: Move only analytical baselines into test fixtures**

Copy the 9 V/1 kΩ/2 kΩ divider and 5 V/10 kΩ/100 µF RC formula into `tests/fixtures/circuits/analytic-baselines.ts`. Update ngspice regression tests to import them as expected-value generators. Do not move LED fixed-drop, engineering demo data, parser subsets, queue delays or gate booleans.

- [ ] **Step 4: Delete old callers, implementations, tests, and now-unused dependencies**

Delete the listed pages/components/libs only after Tasks 14–18 browser tests pass. Delete their Home/Divider/LED/Engineering/Ops selectors, keyframes, variables and responsive overrides from `client/src/index.css`; retain a selector only when a surviving component has an exact reference. Remove dependencies used solely by them (including Recharts/framer-motion if no surviving import) and refresh the frozen lockfile. Keep `client/src/lib/utils.ts`, `ErrorBoundary` and `ThemeContext` only if the new app still imports them.

- [ ] **Step 5: Prove there is one numerical backend and one route tree**

```powershell
rg -n "solveVoltageDivider|solveRCCharge|solveLEDSeries|solveShockleyDiode|simulateRCNumerical|lowPassAC|engineeringGate|parseSpiceSubset|EngineeringOps|EngineeringStudio|DividerLab|LEDLab" client/src
rg -n "home-|divider-|led-|engineering-|ops-|time-microscope|shockley" client/src/index.css
pnpm check
pnpm test
pnpm build
pnpm exec playwright test tests/browser/divider-run.spec.ts tests/browser/analysis-and-instruments.spec.ts tests/browser/learning-flow.spec.ts tests/browser/legacy-routes.spec.ts --project=chromium
```

Expected: both `rg` commands return no production/legacy-style match; checks/build/browser replacements pass; built JS/CSS contains neither hard-coded “4/4 gates passed” copy, old solver symbols nor orphaned legacy selectors.

- [ ] **Step 6: Record deletion and commit the cutover**

```powershell
git add -A
git commit -m "refactor: retire legacy pages and calculation backends"
```

## Phase 6 — Make the Static Product Offline, Deployable, and Releasable

### Task 20: Add Offline Installation and Prove Atomic V1-to-V2 Updates

**Behavior:** 首次在线安装完成后，用户可断网重开并运行 RC；新发布完整下载后保持 waiting，所有旧标签关闭前仍使用同一 V1 app/Worker/WASM，绝不热拼成混合版本。

**Files:**
- Create: `client/src/app/register-service-worker.ts`
- Create: `client/src/app/OfflineStatus.tsx`
- Create: `client/public/icons/fluxlab.svg`
- Create: `scripts/build-pwa-fixtures.mjs`
- Create: `tests/browser/support/versioned-static-server.mjs`
- Create: `tests/browser/support/versioned-static-server.d.mts`
- Create: `tests/browser/offline-update.spec.ts`
- Modify: `client/src/main.tsx`
- Modify: `client/src/App.tsx`
- Modify: `vite.config.ts`
- Modify: `scripts/resolve-build-identity.mjs`
- Modify: `tests/release/build-identity-mode.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.gitignore`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- Vite PWA uses `generateSW`, prompt registration, `injectRegister: false`, `skipWaiting: false`, `clientsClaim: false` and a root scope.
- `registerFluxlabServiceWorker()` is the only registration point and exposes `installing | offline-ready | update-waiting | error` to `OfflineStatus`.
- Cache names contain both `appBuildId` and `engineBuildId`; projects/runs/evidence remain only in IndexedDB.
- The test-only static server serves immutable V1/V2 directories and switches the active release through an in-process method, not an application HTTP endpoint.
- `versioned-static-server.d.mts` declares the exact ESM options and returned URL/switch/close surface and is included by the repository's strict TypeScript check; the `.mjs` helper is not an implicit-`any` escape hatch.
- Task 13's `resolveBuildIdentity` owns the added `pwa-fixture` branch: it accepts only `APP_BUILD_ID=pwa-v1|pwa-v2`, sets `nonReleaseBuild: true` and `nonReleaseFixture: true`, and rejects an unknown ID, a non-ignored output, `dist/public`, or any release predicate. No second identity resolver is added to the fixture script.

- [ ] **Step 1: Write the failing offline and two-version tests**

The first test loads a built release online, waits for visible “离线可用”, creates an RC project, closes the page, sets the browser context offline, reopens within 10 s and completes the real transient run. The second holds two V1 tabs, switches the test server to V2, calls `registration.update()`, asserts V2 is waiting while both tabs and their Worker/WASM report V1 IDs, closes one then both, goes offline, and reopens to a wholly V2 app/Worker with the same engine ID when the engine did not change.

- [ ] **Step 2: Build the two fixtures and verify RED**

Extend `scripts/resolve-build-identity.mjs` and its existing negative test before calling the builder. `scripts/build-pwa-fixtures.mjs` uses Node `child_process` and `fs/promises` to build the same source twice with the explicit `BUILD_PURPOSE=pwa-fixture` and `APP_BUILD_ID=pwa-v1|pwa-v2`. The resolver—not the builder—accepts only those two IDs, emits only to the exact ignored `tests/.artifacts/pwa-v1|pwa-v2` destinations, returns both non-release markers and rejects an unknown/missing ID, a path outside that directory, `dist/public`, a release predicate or a fixture ID under another purpose. The builder writes the same prominent `nonReleaseFixture: true` marker and never touches `dist/public`. The default path remains Task 13 verification mode; Task 23 alone invokes release mode with a clean commit-derived ID. Add `/tests/.artifacts/` to `.gitignore` and assert `git status --short -- tests/.artifacts` returns no line. It changes only a visible build label, never engine metadata.

```powershell
node --test tests/release/build-identity-mode.test.mjs
node scripts/build-pwa-fixtures.mjs
pnpm exec playwright test tests/browser/offline-update.spec.ts --project=chromium
```

Expected: identity-mode tests pass for the two fixture IDs and all negative cases; the browser test is RED because no Service Worker/offline state exists.

- [ ] **Step 3: Configure one explicit Service Worker registration**

Add `vite-plugin-pwa`; generate the manifest with the local SVG icon and no remote URL. Precache content-hashed app shell/routes, the simulation Worker containing the build-verified module glue, separate WASM, bundled models, lessons and manifest. Compute Workbox `maximumFileSizeToCacheInBytes` as the larger of the actual Task 1 Worker/WASM byte lengths plus 65,536 bytes—large enough for those audited assets, not unlimited. Set `navigateFallback: "/index.html"` and a denylist for requests ending `.js`, `.mjs`, `.wasm`, `.css`, `.json`, images/fonts or `/assets/`, so only navigations fall back and a missing engine asset is a real failure. Disable injected/auto registration; call `registerFluxlabServiceWorker` once from `main.tsx`. After build, inspect the generated precache entries and fail unless the exact hashed Worker and WASM, every bundled model/lesson and manifest are present and no standalone ngspice glue MJS is emitted. The engine is absent from eager main-page JS and may download in the background during SW installation; show “正在准备离线仿真” until all required assets are cached.

- [ ] **Step 4: Enforce build handshakes and waiting behavior**

The page embeds `appBuildId`; every Worker message matches it; engine metadata matches the cached `engineBuildId/hash`. Never call `skipWaiting` from a live page. When an update waits, display “保存并关闭所有 FLUXLAB 标签页后重新打开”; do not offer a hot-reload button. Old caches are deleted only in the new worker's activation after no old clients remain.

- [ ] **Step 5: Prove failed install preserves V1 and Cache Storage excludes user data**

Add a V2-broken fixture whose required WASM request returns 404. Assert install fails, V1 remains active/offline-capable and no mixed V2 UI appears. Inspect Cache Storage keys/requests: they may contain only release assets, never project IDs, `.fluxproj`, RunRecord JSON, IndexedDB exports or lesson evidence.

- [ ] **Step 6: Run production-build offline evidence**

```powershell
node scripts/build-pwa-fixtures.mjs
pnpm exec playwright test tests/browser/offline-update.spec.ts --project=chromium
```

Expected: first-install offline RC succeeds; V1→V2 is atomic; failed V2 install leaves V1 intact; cache/user-data separation passes. Dev server evidence is not accepted.

- [ ] **Step 7: Record exact cache/build evidence and commit**

```powershell
git add client/src/app/register-service-worker.ts client/src/app/OfflineStatus.tsx client/public/icons/fluxlab.svg client/src/main.tsx client/src/App.tsx vite.config.ts package.json pnpm-lock.yaml .gitignore scripts/build-pwa-fixtures.mjs scripts/resolve-build-identity.mjs tests/release/build-identity-mode.test.mjs tests/browser/support/versioned-static-server.mjs tests/browser/support/versioned-static-server.d.mts tests/browser/offline-update.spec.ts docs/2026-08-28-circuit-simulator-modernization/04-progress.md docs/2026-08-28-circuit-simulator-modernization/05-verification.md
git commit -m "feat: install and update the offline simulator atomically"
```

### Task 21: Define and Verify the Real Static-Host Contract

**Behavior:** 删除 Express 后，正式主机仍能直接打开/刷新漂亮路径，缺失 JS/WASM 返回真实 404，安全头、MIME 与缓存策略支持 Worker/PWA，而不是依赖 Vite preview 的宽松行为。

**Files:**
- Create: `docs/DEPLOYMENT.md`
- Create: `scripts/verify-static-host.mjs`
- Create: `tests/release/static-host.test.mjs`
- Create: `tests/browser/release-smoke.spec.ts`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `playwright.config.ts`
- Modify: `tests/browser/support/versioned-static-server.mjs`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- V1 supports root-path deployment only. A future subpath requires one explicit design change covering Vite base, wouter base, SW scope and asset URLs.
- Navigation requests for `/`, `/project/*`, `/learn/*`, `/settings` and legacy routes rewrite to `index.html`; asset requests never rewrite.
- `verifyStaticHost(baseUrl, expectedRelease?): Promise<HostVerificationReport>` has two fail-closed modes and uses standard `fetch` with redacted query values. With no `expectedRelease` (Task 21 contract-only), it discovers actual build assets from the local Vite manifest/index, checks routes/MIME/cache/security/404 and does **not** request or require `release-manifest.json`, which is not created until Task 23. With `expectedRelease` (Task 23 release mode), it fetches `release-manifest.json` using `cache: "no-store"` plus a random cache-busting query, requires `Cache-Control: no-cache`, compares its raw bytes and SHA-256 to the supplied local file, then compares remote release source/app ID, `engineBuildId/resultTransport/moduleSha256/wasmSha256` plus every sorted `deliveryFiles` path/size/SHA-256; a missing manifest, self-consistent older deployment, omitted file or byte drift fails. All asset requests use no-store.
- Playwright never chooses a host merely because a URL variable exists. `FLUXLAB_PLAYWRIGHT_TARGET` is exactly `local-rc | release-host`; local mode starts the strict server and rejects any remaining `FLUXLAB_RELEASE_BASE_URL` or `FLUXLAB_EXPECTED_MANIFEST`, while release mode requires both, requires HTTPS, and is reserved for Task 23 external evidence. Pre/post runners sanitize their child environment before selecting local mode.
- Production evidence uses required `FLUXLAB_RELEASE_BASE_URL`; absence means the external-host gate remains blocked, not passed by localhost.

- [ ] **Step 1: Write failing server-contract tests**

```js
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startVersionedStaticServer } from "../browser/support/versioned-static-server.mjs";

test("rewrites navigation but returns a real 404 for a missing module", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-host-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<!doctype html><title>fixture</title>");
  await writeFile(join(root, "assets", "app-12345678.js"), "export {};");
  const server = await startVersionedStaticServer({ root });
  try {
    const route = await fetch(`${server.url}/learn/foundation-divider`, { headers: { accept: "text/html" } });
    const missing = await fetch(`${server.url}/assets/missing.js`);
    assert.equal(route.status, 200);
    assert.match(route.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(missing.status, 404);
    assert.doesNotMatch(missing.headers.get("content-type") ?? "", /text\/html/);
  } finally {
    await server.close();
    await rm(root, { recursive: true });
  }
});
```

- [ ] **Step 2: Run the contract test and verify RED**

```powershell
node --test tests/release/static-host.test.mjs
```

Expected: FAIL until the test server and host rules distinguish navigations from assets.

- [ ] **Step 3: Implement the exact route, MIME, cache, and security contract**

Document and emulate:

```text
navigation Accept:text/html -> /index.html
missing .js/.css/.mjs/.wasm/image -> 404 (never index.html)
/index.html, /sw.js, /manifest.webmanifest, /release-manifest.json -> Cache-Control: no-cache
/assets/<content-hash>.*, hashed Worker/WASM -> Cache-Control: public,max-age=31536000,immutable
.wasm -> application/wasm; .mjs/.js/sw.js -> text/javascript
```

Production requires HTTPS plus `Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a Permissions Policy disabling camera/microphone/geolocation. Do not add COOP/COEP because the qualified engine is single-threaded.

- [ ] **Step 4: Verify local contract and the actual release host separately**

`verify-static-host.mjs` contract-only mode checks status/content-type/cache/security for all official routes, assets discovered from the current build, Worker and WASM, then probes missing `.js` and `.wasm`; it neither expects nor synthesizes a release manifest. It requires HTTPS except `127.0.0.1/localhost`. Separately add fixture coverage for release mode `--expected-manifest <path>` proving a missing or raw-byte-different manifest, an older but otherwise healthy host, an omitted unclassified delivery file and one tampered delivery file all fail. The Playwright smoke directly opens and reloads all official/legacy routes against the selected base and performs one divider run.

```powershell
$env:FLUXLAB_PLAYWRIGHT_TARGET = "local-rc"
Remove-Item Env:FLUXLAB_RELEASE_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:FLUXLAB_EXPECTED_MANIFEST -ErrorAction SilentlyContinue
node --test tests/release/static-host.test.mjs
node scripts/verify-static-host.mjs --root dist/public
pnpm exec playwright test tests/browser/release-smoke.spec.ts --project=chromium
```

`--root` starts and closes the standard-library test server internally, so no orphan preview process is assumed. Direct local invocation clears external inputs as shown; `playwright.config.ts` itself still rejects conflicting values so a caller cannot silently pick a stale host. In `release-host` mode it omits local `webServer` only after validating the operator URL and expected local manifest. `FLUXLAB_RELEASE_BASE_URL` is an operator input, not a value for an agent to invent or commit. Expected: the local contract passes. Task 21 must not mark the production host verified because Tasks 22–23 still change product/release files; the authoritative remote check occurs only after Task 23 builds and deploys that exact final release candidate.

- [ ] **Step 5: Record host evidence without credentials and commit**

Record the local contract and fixture mismatch evidence. Production hostname, app/engine build IDs, asset hashes and timestamp remain `Pending` until Task 23; do not record signed query parameters or deploy tokens.

```powershell
git add docs/DEPLOYMENT.md README.md scripts/verify-static-host.mjs tests/release/static-host.test.mjs tests/browser/release-smoke.spec.ts tests/browser/support/versioned-static-server.mjs playwright.config.ts package.json docs/2026-08-28-circuit-simulator-modernization/04-progress.md docs/2026-08-28-circuit-simulator-modernization/05-verification.md
git commit -m "docs: define and verify static production hosting"
```

### Task 22: Meet Responsive, Keyboard, Accessibility, Performance, and Size Gates

**Behavior:** 课程和结果在 360 px 可完成，轻量编辑在 768 px 可用，完整工作台在 1024 px 可用；键盘、动效、状态表达、500 元件编辑、取消时延和首屏体积有可重复证据。

**Files:**
- Create: `client/src/app/keyboard-shortcuts.ts`
- Modify: `client/src/app/SettingsPage.tsx`
- Create: `scripts/measure-build.mjs`
- Create: `tests/release/build-metrics.test.mjs`
- Create: `tests/fixtures/circuits/large-project.ts`
- Create: `tests/fixtures/circuits/large-result.ts`
- Create: `tests/browser/accessibility-performance.spec.ts`
- Modify: `client/src/app/ProjectWorkspace.tsx`
- Modify: `client/src/app/routes.tsx`
- Modify: `client/src/app/OfflineStatus.tsx`
- Modify: `client/src/storage/indexeddb.ts`
- Modify: `client/src/storage/indexeddb.test.ts`
- Modify: `client/src/features/editor/SchematicCanvas.tsx`
- Modify: `client/src/features/editor/PropertiesPanel.tsx`
- Modify: `client/src/features/analysis/RunControls.tsx`
- Modify: `client/src/features/analysis/DiagnosticsPanel.tsx`
- Modify: `client/src/features/instruments/ResultDock.tsx`
- Modify: `client/src/features/learning/LessonOverlay.tsx`
- Modify: `client/src/index.css`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- `handleWorkspaceShortcut(event, context): boolean` is the one keyboard mapping; it ignores editable fields except Escape.
- `measureBuild(distDir): BuildMetrics` follows Vite's emitted manifest from the project-library entry, counts the actual eager HTML/CSS/JS closure raw+gzip, and reports Worker/ngspice separately.
- `loadLocalSettings()` and `saveLocalSettings(settings)` validate exactly `LocalSettingsV1`, call Task 6's `parseStoredSettingEnvelope`/key derivers, and are the only preference APIs; no component or later task reads/writes raw settings-store values.
- Browser performance evidence records browser version, viewport, fixed runner image, observed CPU/hardware label and raw time-windowed long-task/cancel samples; retries are disabled for this gate.

- [ ] **Step 1: Write failing metric and browser acceptance tests**

The Node fixture proves the metric follows imports/CSS from the entry and does not hide bytes by renaming chunks. Add one focused `indexeddb.test.ts` case proving local preferences round-trip only under `local-settings` and a lesson-session/extra-field payload is rejected without a write. Browser tests cover 360×800 guided lesson/run/result; 768×900 selection/parameter/wire edit; 1024×768 all rails/dock; keyboard select→properties→Run→diagnostics→undo/redo; visible focus; aria-live save/run/diagnostic states; reduced motion; text/icon status independent of color; direct `/settings` open/refresh; and near-limit ResultTable pagination.

```powershell
node --test tests/release/build-metrics.test.mjs
pnpm exec vitest run client/src/storage/indexeddb.test.ts
pnpm build
pnpm exec playwright test tests/browser/accessibility-performance.spec.ts --project=chromium
```

Expected: RED while metric/interaction gates are absent.

- [ ] **Step 2: Implement responsive disclosure without duplicate state**

At 360 px show lesson/current selection/Run/result as one-column panels with the canvas optional; at 768 px show canvas plus one collapsible rail; at 1024 px show full layout. Panels read the same reducer/controller/run IDs. Use CSS media/container queries and semantic buttons/details/dialogs; do not create separate mobile project or result objects.

- [ ] **Step 3: Implement the real SettingsPage and validated preferences**

Extend Task 6's already functional read-only `/settings` page; keep direct navigation/reload and replace its truthful pre-engine/pre-SW states with the real Task 13/20 providers. Show the exact current `appBuildId`, engine version/build ID, fixed result transport, module SHA-256 and WASM SHA-256; online/offline, active/waiting Service Worker and offline-ready states; and `navigator.storage.estimate()` usage/quota plus `navigator.storage.persisted()` status. Unsupported/error results are explicit text, not zero or success. If a “请求持久存储” button is shown, it must call `navigator.storage.persist()` and refresh the displayed result; otherwise omit it.

The only user-editable preference record is `LocalSettingsV1 { schemaVersion:1; theme:"system"|"light"|"dark"; reducedMotion:"system"|"reduce"; defaultView:"guided"|"standard"|"expert" }`. `loadLocalSettings`/`saveLocalSettings` derive the fixed `local-settings` key, wrap/parse through the existing strict `StoredSettingEnvelope` implementation and accept only this exact payload; they do not duplicate its schema or call a generic settings API. Task 17/19's separately discriminated navigation records are not preferences and never appear as controls. Apply theme and default view to the shared app state; `reducedMotion="system"` follows the media query and `reduce` forces less motion, never forces animation against an OS reduce request. Reload must preserve all three choices. Do not render notification, cloud, sync, account, calibration or any other control without implemented behavior.

- [ ] **Step 4: Implement keyboard and accessible status rules**

Support Tab/Shift+Tab, Enter/Space activation, Escape cancel/close, arrow selection, Alt+Arrow layout nudge, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo, and Ctrl/Cmd+Enter Run. Maintain focus after mutation/dialog close; diagnostics link to the component/field; save/run/diagnostic updates use non-interruptive `aria-live`. Every passed/failed/blocked/stale/running state includes text/icon. Under `prefers-reduced-motion: reduce`, remove nonessential transitions and animated wave traces.

- [ ] **Step 5: Measure editing, table, and cancellation ceilings**

Load the deterministic 500-component fixture and wait for the product's explicit ready/idle marker. First assert `PerformanceObserver.supportedEntryTypes` contains `longtask`; absence blocks the gate instead of producing a false zero. Attach a non-buffered observer, mark the exact interaction window, perform 20 keyboard selections and 20 pointer drags, disconnect it, and consider only entries overlapping that window, so navigation and initial rendering do not contaminate the edit ceiling. Assert instrumented interaction samples exist and no observed task exceeds 50 ms on the recorded fixed CI runner image/CPU label.

Separately seed and fully validate a success record with 999,999 axis points plus one 999,999-point vector (1,999,998 stored points, each buffer below 16 MiB), wait until loading/validation is complete, then start a fresh non-buffered long-task window. Open `ResultTable`, move first→middle→last page, change visible columns and return; assert at most 200 body rows at every step, correct absolute row ranges/values, at least one instrumented interaction sample and no task over 50 ms. The measurement excludes seeding/loading but includes React rendering and each page action. Start the fixed long transient, cancel, and measure from click to enabled Run state ≤500 ms. Store raw samples and window bounds in Playwright attachments; do not replace measurement with a unit-test mock or make retries hide a failure.

- [ ] **Step 6: Implement the build metric with Node standard libraries**

Enable Vite manifest output. From `index.html` and the manifest entry, traverse only static imports and linked CSS; sum file bytes and `zlib.gzipSync` bytes. Report eager JS alone, total initial HTML/CSS/eager JS, whole-dist categories and the simulation Worker (including verified ngspice glue)/WASM raw/gzip/cache bytes separately. Assert exact first-modernization gates: total raw ≤827,000 B, total gzip ≤220,000 B, eager JS raw ≤402,000 B, eager JS gzip ≤114,000 B, and debug collector 0 B. SW background precache does not count as eager JS but is separately visible.

- [ ] **Step 7: Run settings/accessibility/performance/size evidence**

```powershell
node --test tests/release/build-metrics.test.mjs
pnpm exec vitest run client/src/storage/indexeddb.test.ts
pnpm build
node scripts/measure-build.mjs dist/public
pnpm exec playwright test tests/browser/accessibility-performance.spec.ts --project=chromium
```

Expected: settings direct-open/refresh and real platform values pass; all three viewports complete their journeys; keyboard/status/reduced-motion checks pass; 500-component, near-limit paginated table and cancel samples meet ceilings; size output records B0 and current values without claiming dependency deletion caused bundle savings it did not cause.

- [ ] **Step 8: Commit measured UX, settings, and performance**

```powershell
git add client/src/app client/src/features client/src/storage/indexeddb.ts client/src/storage/indexeddb.test.ts client/src/index.css vite.config.ts package.json scripts/measure-build.mjs tests/release/build-metrics.test.mjs tests/fixtures/circuits/large-project.ts tests/fixtures/circuits/large-result.ts tests/browser/accessibility-performance.spec.ts docs/2026-08-28-circuit-simulator-modernization/04-progress.md docs/2026-08-28-circuit-simulator-modernization/05-verification.md
git commit -m "perf: meet responsive accessible workspace gates"
```

### Task 23: Lock Dependencies, CI, Release Evidence, and Human Validation

**Behavior:** 先提交全部实现，再从该干净 `releaseSourceCommit` 构建唯一 RC；固定门禁为同一 commit/app build 写结构化证据，源码包与静态产物分别扫描，同一静态目录被部署并按本地 manifest 核对；AI 只生成研究协议，学习成功率必须由真实参与者的脱敏证据决定。

**Files:**
- Create: `scripts/verify-dependencies.mjs`
- Create: `scripts/verify-build-identity.mjs`
- Create: `scripts/verify-audit-report.mjs`
- Create: `scripts/create-license-inventory.mjs`
- Create: `scripts/run-release-gates.mjs`
- Create: `scripts/create-release-manifest.mjs`
- Create: `scripts/create-study-instance.mjs`
- Create: `tests/release/dependencies.test.mjs`
- Create: `tests/release/build-identity.test.mjs`
- Create: `tests/release/audit-report.test.mjs`
- Create: `tests/release/license-inventory.test.mjs`
- Create: `tests/release/release-gates.test.mjs`
- Create: `tests/release/release-manifest.test.mjs`
- Create: `tests/release/study-protocol.test.mjs`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `SECURITY.md`
- Create: `docs/2026-08-28-circuit-simulator-modernization/06-user-study-protocol.md`
- Modify: `.github/workflows/quality.yml`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.node-version`
- Modify: `README.md`
- Modify: `vite.config.ts`
- Modify: `playwright.config.ts`
- Modify: `scripts/resolve-build-identity.mjs`
- Modify: `scripts/verify-static-host.mjs`
- Modify: `tests/browser/release-smoke.spec.ts`
- Modify: `tests/release/build-identity-mode.test.mjs`
- Modify: `tests/release/static-host.test.mjs`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/04-progress.md`
- Modify: `docs/2026-08-28-circuit-simulator-modernization/05-verification.md`

**Interfaces:**
- Runtime dependency allowlist is exactly 8 packages: `react`, `react-dom`, `wouter`, `lucide-react`, `sonner`, `zod`, `clsx`, `tailwind-merge`.
- Dev allowlist is exactly 12 packages: `@tailwindcss/vite`, `@types/node`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `@playwright/test`, `prettier`, `tailwindcss`, `typescript`, `vite`, `vite-plugin-pwa`, `vitest`.
- Toolchain is exactly Node `24.15.0`, pnpm `10.4.1`; CI actions are pinned by full commit SHA.
- `BUILD_PURPOSE` is exactly `verification | pwa-fixture | release`. The default verification behavior remains Task 13's source-tree hash plus `nonReleaseBuild: true`. Fixture mode accepts only `pwa-v1|pwa-v2`, emits outside `dist/public` with `nonReleaseFixture: true`. Release mode alone requires `APP_BUILD_ID = git-<40 lowercase releaseSourceCommit hex>`, `HEAD === releaseSourceCommit` and a clean worktree immediately before Vite emits; release identity/manifest checks reject both non-release markers.
- `releaseRunId` is a fresh 32-lowercase-hex UUID for one execution, unrelated to product identity. Its run root is the previously nonexistent ignored directory `tests/.artifacts/release/runs/<releaseRunId>/`; reuse or any pre-existing file is a hard failure.
- `GateEvidenceV1` contains `gateId`, `phase: "pre-manifest" | "post-manifest" | "external"`, `releaseRunId`, exact argv, status/exit code, `releaseSourceCommit`, `appBuildId`, `engineBuildId`, fixed result transport/module/WASM hashes, Node/pnpm/tool/browser versions, UTC start/finish, redacted summary and artifact hashes. The post tree report additionally carries the complete before/after inventories and equal tree hashes; both external reports carry the local/remote raw-manifest SHA-256, normalized base URL and immutable provider release ID. Evidence lives only under that run root's `evidence/<phase>/`.
- `FLUXLAB_PLAYWRIGHT_TARGET` is exactly `local-rc | release-host`. Pre/post phases force `local-rc` in a sanitized child environment with `FLUXLAB_RELEASE_BASE_URL` and `FLUXLAB_EXPECTED_MANIFEST` removed; external forces `release-host` and injects both from validated CLI arguments. Missing, unknown or conflicting values fail instead of falling back based on an ambient URL.
- `runReleaseGates(options)` owns fixed, test-asserted command/gate-ID lists. `phase=pre-manifest` atomically creates the new run root and runs build/test/archive/history/unpacked-source/pre-manifest gates. `phase=post-manifest` requires the same root identity sentinel plus a newly created manifest, refuses any existing post report, scans the final dist including that manifest and runs local expected-manifest host verification. `phase=external` reuses that identity/root after deployment, verifies the remote static tree and real-browser divider journey, and atomically writes exactly `remote-static-host.json` and `remote-browser-smoke.json`. Every phase checks `HEAD`, source commit and full worktree cleanliness at entry; pre checks again immediately before the release Vite build; pre/post check again after their final gate. It streams output, writes one atomic JSON report per gate and never infers success from a terminal transcript.
- `create-release-manifest.mjs` exports the one Node-standard-library tree implementation used by manifest creation and the release runner. `enumerateReleaseTree(root, excludedPaths)` returns slash-normalized, path-sorted `{ path, size, sha256 }` entries, rejects traversal, duplicates, symlinks and non-regular entries, and does not follow links. `hashReleaseTree(entries)` is exactly `SHA-256(UTF-8(JSON.stringify(entries)))` over those fixed-order fields; no second tree algorithm is allowed.
- `createReleaseManifest({ distDir, evidenceDir, sourceArchive, releaseRunId })` writes exactly `dist/public/release-manifest.json`. It requires the exact pre-manifest gate-ID set once each and rejects a missing/duplicate/failed report, different run ID, wrong source/app/engine/transport build, stale timestamp, absent license inventory or unmatched asset. It calls `enumerateReleaseTree(distDir, ["release-manifest.json"])` and emits the returned complete `deliveryFiles`; that self-exclusion is the only exclusion. It also emits release run/source commit/archive SHA-256, app/engine IDs including transport/module/WASM hashes and dependency/license/metric summaries. It does not hash itself. Final-dist scan/tree and local expected-manifest evidence are necessarily post-manifest GateEvidence bound to the same run ID.
- `createStudyInstance({ template, localManifest, remoteStaticEvidence, remoteBrowserEvidence, providerReleaseId, output })` runs only after remote verification. It requires both external reports exactly once and `passed`; their releaseRunId/source/app/engine/transport/module/WASM identity, local and remote raw-manifest SHA-256, normalized base URL and provider release ID must all equal one another and the supplied local inputs. It then freezes that exact identity plus scripts/viewports/defaults/timing, consent/exclusion rules and data-custody fields before recruitment. The committed protocol is a versioned rule/template and never attempts to contain its own future commit SHA.
- `verify-static-host.mjs <base> --expected-manifest <local-path>` fetches remote manifest/assets and compares identity plus bytes to the local RC; checking only that the remote host is self-consistent is insufficient.

- [ ] **Step 1: Write failing allowlist and release-manifest tests**

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyDependencies } from "../../scripts/verify-dependencies.mjs";

test("allows only the approved direct dependency surface", async () => {
  const result = await verifyDependencies("package.json");
  assert.deepEqual(result.unexpectedRuntime, []);
  assert.deepEqual(result.unexpectedDev, []);
  assert.equal(result.runtimeCount, 8);
  assert.equal(result.devCount, 12);
});
```

Add tests proving dependency verification rejects any root `optionalDependencies`, `bundledDependencies`, `bundleDependencies`, pnpm patch/override, direct URL/git/file/workspace specifier, unexpected package and root install/preinstall/postinstall/prepare script that downloads or executes remote code. Add manifest fixtures for missing, failed, duplicate and mismatched gate reports, mixed/replayed `releaseRunId`, wrong app/source/transport commit, an omitted/extra/changed delivery file, a symlink and a passing complete set. Include an otherwise unclassified file under `dist/public` and prove it is listed; change manifest metadata without changing parsed identity and prove raw-byte verification fails. Prove the runner refuses an existing run root even for the same source commit; rejects dirty/mismatched HEAD at every prescribed checkpoint; prevents an ambient release URL from affecting local phases; rejects an unknown/conflicting Playwright target; and fails when a scan callback changes one byte or the manifest. Add a build fixture proving HTML/main/Worker/SW all carry the same release app ID and the vendor manifest's engine ID/transport/module/WASM hashes, while verification/fixture markers are rejected. Add external fixtures proving remote manifest drift between static and browser checks fails and both external reports bind the same RC, base URL and provider release ID. Add study-instance tests proving the committed template has no RC identity, either missing/unequal external report is rejected, and a valid post-deploy instance freezes both manifest hashes before recruitment.

- [ ] **Step 2: Run release tests and verify RED before final shrink**

```powershell
node --test tests/release/*.test.mjs
```

Expected: RED while old direct packages and release/evidence tools remain.

- [ ] **Step 3: Remove every dependency outside the exact allowlists and inventory licenses**

Replace any last use with React/platform/CSS already planned; do not add substitutes. Regenerate `pnpm-lock.yaml` once under Node 24.15.0/pnpm 10.4.1, then prove a second frozen install leaves it byte-identical. `verifyDependencies` checks every root dependency section/specifier and package script, not just counts. `create-license-inventory.mjs --notices <path> --json <path>` uses pinned pnpm package metadata plus `vendor/ngspice/LICENSES`, emits deterministic notices/JSON to exactly those validated paths, and fails for an unknown/missing license or package/version drift. Task 23 implementation writes tracked `THIRD_PARTY_NOTICES.md` plus a temporary test JSON; the release runner alone writes `dist/public/third-party-licenses.json` after the sole RC build. Verify vendored ngspice files are real bytes, not Git LFS pointer text, and match `SHA256SUMS`.

- [ ] **Step 4: Pin the CI workflow and order gates by value**

Use these immutable action commits verified on 2026-08-28:

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
- uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
- uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
- uses: gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7 # v2, gitleaks v8.30.1 baseline
```

Use one clean `ubuntu-24.04` quality job so all evidence remains on one checkout and build identity; set `fetch-depth: 0`, `node-version-file: .node-version`, pnpm `10.4.1`, environment `BUILD_PURPOSE: release`, `RELEASE_SOURCE_COMMIT: ${{ github.sha }}`, `APP_BUILD_ID: git-${{ github.sha }}` and `FLUXLAB_PLAYWRIGHT_TARGET: local-rc`. Generate a fresh releaseRunId per job and fail if its run root exists. A fresh runner executes `pnpm exec playwright install --with-deps chromium firefox webkit`. Install gitleaks CLI v8.30.1 from its official release only after verifying the platform asset SHA-256 recorded in `SECURITY.md`; the pinned gitleaks action runs a separate full-history defense-in-depth gate. Cache package downloads only; never cache `node_modules`, `dist`, evidence, PWA fixtures or browser/user data. Changed-behavior failure stops later regression/robustness commands, and the performance spec has zero retries.

- [ ] **Step 5: Define the exact scripts and browser matrix**

`package.json` contains these fixed scripts; no glob of all Playwright specs is multiplied blindly across all browsers:

```json
{
  "test": "vitest run",
  "test:release": "node --test tests/release/*.test.mjs",
  "test:browser:qualification": "playwright test tests/browser/ngspice-qualification.spec.ts --project=chromium --project=firefox --project=webkit",
  "test:browser:core": "playwright test tests/browser/divider-run.spec.ts tests/browser/analysis-and-instruments.spec.ts tests/browser/verification-gates.spec.ts tests/browser/project-files.spec.ts --project=chromium --project=firefox --project=webkit",
  "test:browser:chromium": "playwright test tests/browser/no-business-network.spec.ts tests/browser/project-persistence.spec.ts tests/browser/run-storage.spec.ts tests/browser/learning-flow.spec.ts tests/browser/legacy-routes.spec.ts tests/browser/release-smoke.spec.ts tests/browser/accessibility-performance.spec.ts --project=chromium",
  "test:browser:offline": "playwright test tests/browser/offline-update.spec.ts --project=chromium",
  "test:browser": "pnpm test:browser:qualification && pnpm test:browser:core && pnpm test:browser:chromium",
  "pwa:fixtures": "node scripts/build-pwa-fixtures.mjs",
  "release:gates": "node scripts/run-release-gates.mjs"
}
```

The exact matrix is:

| Suite | Chromium | Firefox | WebKit | Prerequisite |
|---|---:|---:|---:|---|
| ngspice qualification | yes | yes | yes | final production build |
| divider, four analyses/instruments, verification gates, project files | yes | yes | yes | final production build |
| cleanup/network, project/run persistence, learning, legacy routes, release smoke | yes | no | no | final production build |
| PWA first install/V1→V2/broken update | yes | no | no | build V1/V2 fixtures first |
| settings/accessibility, 360/768/1024, 500-component and near-limit result-table performance | yes | no | no | final production build; fixed runner; no retries |

`run-release-gates.mjs` must hard-code and unit-test this order. Pre-manifest phase: clean HEAD/worktree gate; frozen install/lock diff; `pnpm check`; `pnpm test`; `node --test tests/release/*.test.mjs`; PWA fixture build plus Chromium offline; a second clean gate immediately before building the final RC with `BUILD_PURPOSE=release`; build-identity and license checks; three-browser qualification; three-browser core; Chromium-only suite; production audit/hygiene; full-history and unpacked-source gitleaks; source archive/hash; build metrics; contract-only local static-host check; final clean gate. Pre/post child processes are forced to `FLUXLAB_PLAYWRIGHT_TARGET=local-rc` with the two named remote variables removed. Then create the release manifest once. Post-manifest phase: clean entry; call the shared tree functions over the final `dist/public` including its manifest, run gitleaks `--no-git`, recompute and require identical inventories and `H_before === H_after`; local static-host release mode using that exact manifest; final clean gate. External phase: clean entry, require provider release ID, force `release-host`, recheck the local final-tree inventory/hash from post evidence, verify remote static files, then run the identity-bound browser smoke. Fixture builds write only ignored artifact directories; the sole `dist/public` release build is the commit-derived RC and release identity rejects either non-release marker.

- [ ] **Step 6: Emit decision-grade security, archive, and gate evidence**

Run `pnpm audit --prod --json` through the evidence runner. `high/critical` count must be zero. Every moderate/low item, if any, must have a direct dependency path, available fixed version, owner, expiry/review date and explicit acceptance reason in `SECURITY.md`; `verify-audit-report.mjs` rejects an unadjudicated item. History cleanup/credential rotation remains separate owner evidence.

From the clean release SHA, create `<releaseRunRoot>/fluxlab-source-<sha>.tar` with `git archive`, extract it to the previously nonexistent `<releaseRunRoot>/unpacked-source`, and run gitleaks v8.30.1 with `--no-git --redact` against that unpacked source. Independently run full-history gitleaks against the checkout. After `release-manifest.json` is created, the post-manifest phase calls `enumerateReleaseTree(distDir, [])` and `hashReleaseTree` before the scan, runs `--no-git --redact`, repeats both calls and requires the two inventories plus `H_before/H_after` to be identical; because the exclusion set is empty, this tree includes the manifest. Both inventories and hashes enter its GateEvidence. Scanning the pre-manifest dist is not accepted as the final-output scan, and a scanner/test that mutates release bytes fails. Never scan only the Git checkout and infer that archives/build output are clean. Record the source tar SHA-256, final dist tree hash, scanner version, releaseRunId and zero findings in separate `GateEvidenceV1` reports; reports contain no matched secret values. Add `/tests/.artifacts/` to `.gitignore` and assert `git status --short -- tests/.artifacts` is empty. The ignored location is not cleanliness evidence: the runner must create a new run root with an atomic exclusive mkdir and refuse any existing path/files.

The evidence runner performs the equivalent of these commands with validated absolute child paths and JSON report outputs:

```powershell
if (Test-Path -LiteralPath $releaseRunRoot) { throw "Release run root already exists" }
New-Item -ItemType Directory -Path $releaseRunRoot | Out-Null
git archive --format=tar --output "$releaseRunRoot/fluxlab-source-$releaseSourceCommit.tar" $releaseSourceCommit
New-Item -ItemType Directory -Path "$releaseRunRoot/unpacked-source" | Out-Null
tar -xf "$releaseRunRoot/fluxlab-source-$releaseSourceCommit.tar" -C "$releaseRunRoot/unpacked-source"
Get-FileHash -Algorithm SHA256 "$releaseRunRoot/fluxlab-source-$releaseSourceCommit.tar"
gitleaks detect --source . --redact
gitleaks detect --no-git --source "$releaseRunRoot/unpacked-source" --redact
```

- [ ] **Step 7: Make build identity and manifest fail closed**

`vite.config.ts` delegates all three purposes to Task 13's resolver; release mode alone requires a commit-derived `APP_BUILD_ID` and clean matching HEAD, while verification/fixture outputs retain their rejection markers. `verify-build-identity.mjs` follows the emitted Vite/Workbox manifests and proves `appBuildId = git-<releaseSourceCommit>` across HTML/main, simulation Worker, Service Worker/cache names and visible build metadata; it proves `engineBuildId/resultTransport/moduleSha256/wasmSha256` match the immutable vendor manifest, neither ID is a non-release/default placeholder and neither marker exists. `create-release-manifest.mjs` consumes only `<releaseRunRoot>/evidence/pre-manifest`, requires every fixed pre gate exactly once with the same releaseRunId/identity/command set, enumerates the complete symlink-free `deliveryFiles`, hashes actual release bytes, and writes the public no-secret manifest once. The post-manifest runner then proves scanning did not mutate those final bytes and validates the local host against the same manifest. A report copied from another run, pre-existing path, missing browser, non-release build or older/dirty commit fails.

- [ ] **Step 8: Commit the human-study protocol template without an identity cycle**

`06-user-study-protocol.md` is a versioned template/rule set, not an RC instance: it defines the exact required identity fields and tasks but contains no guessed future commit, local manifest hash or remote hash. It fixes scripts, viewport/defaults, timing start/stop, consent, exclusion rules and data-custody requirements. Twenty FLUXLAB-new participants perform divider, LED and lesson→workspace tasks; five SPICE-experienced participants perform the fixed engineering import task. Only predeclared technical invalidity—such as browser/device failure before a task can be attempted or unusable consented recording—may exclude a session, and every exclusion is logged and replaced; task failure, help, wrong result and timeout are never excluded. Researchers time locally and, with consent, record screens; users explicitly export run evidence. The template requires the raw-data custodian, exact people/roles with access, retention duration and deletion date. The product gains no analytics, upload endpoint or hidden identifier. Raw recordings/identity remain outside Git; a later evidence-only commit stores only aggregate counts/times/help/errors, exclusions/replacements, template/instance hashes, RC identities, run-evidence hashes and a non-sensitive custody reference.

- [ ] **Step 9: Apply the exact human thresholds and refuse synthetic success**

Record divider ≥17/20 within 8 min, LED ≥18/20 within 6 min with a real parameter change, lesson→workspace ≥16/20 within 10 min, engineering import ≥4/5 within 20 min, and ≥30 percentage-point pre/post improvement on both fixed concepts. An AI or automated browser cannot count as a participant. If people/evidence are unavailable, mark the human gate `Pending` and do not claim the learning/GA acceptance metric passed; automated RC quality may still be reported separately.

- [ ] **Step 10: Verify Task 23 behavior, then commit implementation before any RC build**

```powershell
corepack pnpm install --frozen-lockfile
pnpm check
pnpm test
node --test tests/release/*.test.mjs
node scripts/verify-dependencies.mjs package.json
$licenseCheckPath = Join-Path $env:TEMP "fluxlab-third-party-licenses-task23.json"
node scripts/create-license-inventory.mjs --notices THIRD_PARTY_NOTICES.md --json $licenseCheckPath
if ($LASTEXITCODE -ne 0) { throw "License inventory failed" }
Remove-Item -LiteralPath $licenseCheckPath -Force
git add .github/workflows/quality.yml .gitignore package.json pnpm-lock.yaml .node-version README.md SECURITY.md THIRD_PARTY_NOTICES.md vite.config.ts playwright.config.ts scripts tests/release tests/browser/release-smoke.spec.ts docs/2026-08-28-circuit-simulator-modernization
git commit -m "build: lock the reproducible simulator release pipeline"
```

This commit contains the complete Task 23 implementation and versioned protocol template, but no RC-specific study instance, generated RC build/manifest, participant raw data, secret, deploy token, `node_modules`, browser binary, evidence JSON or PWA fixture. Build-identity and study-instance behavior are exercised with release test fixtures; the first production build happens only after this commit in Step 11.

- [ ] **Step 11: Build and test the sole RC from the clean committed SHA**

Start only with no tracked or untracked source changes. Capture `releaseSourceCommit` after Step 10's commit, derive the one app ID from it, and let the fixed runner create every report and the release manifest:

```powershell
$dirty = git status --porcelain=v1 --untracked-files=all
if ($dirty) { throw "Release checkout is not clean" }
$releaseSourceCommit = (git rev-parse HEAD).Trim().ToLowerInvariant()
if ($releaseSourceCommit -notmatch '^[0-9a-f]{40}$') { throw "Invalid release source commit" }
$env:RELEASE_SOURCE_COMMIT = $releaseSourceCommit
$env:APP_BUILD_ID = "git-$releaseSourceCommit"
$env:BUILD_PURPOSE = "release"
$env:FLUXLAB_PLAYWRIGHT_TARGET = "local-rc"
$releaseRunId = ([guid]::NewGuid().ToString("N")).ToLowerInvariant()
$releaseRunRoot = Join-Path (Resolve-Path -LiteralPath ".").Path "tests/.artifacts/release/runs/$releaseRunId"
if (Test-Path -LiteralPath $releaseRunRoot) { throw "Release run root already exists" }
$env:RELEASE_RUN_ID = $releaseRunId
corepack pnpm install --frozen-lockfile
git diff --exit-code -- pnpm-lock.yaml
pnpm exec playwright install --with-deps chromium firefox webkit
node scripts/run-release-gates.mjs --phase pre-manifest --release-run-id $releaseRunId --run-root $releaseRunRoot --source-commit $releaseSourceCommit --app-build-id $env:APP_BUILD_ID
node scripts/create-release-manifest.mjs --release-run-id $releaseRunId --dist dist/public --evidence "$releaseRunRoot/evidence/pre-manifest" --source-archive "$releaseRunRoot/fluxlab-source-$releaseSourceCommit.tar" --output dist/public/release-manifest.json
node scripts/run-release-gates.mjs --phase post-manifest --release-run-id $releaseRunId --run-root $releaseRunRoot --source-commit $releaseSourceCommit --app-build-id $env:APP_BUILD_ID --expected-manifest dist/public/release-manifest.json
$headAfterGates = (git rev-parse HEAD).Trim().ToLowerInvariant()
$dirtyAfterGates = git status --porcelain=v1 --untracked-files=all
if ($headAfterGates -ne $releaseSourceCommit -or $dirtyAfterGates) { throw "Release gates changed source state" }
```

Expected: the run root did not exist before this invocation; all fixed gate reports are `passed` for the same releaseRunId and exact identity; repeated HEAD/worktree checks remain clean; production audit has zero high/critical and every lower finding is adjudicated; source archive, unpacked source and immutable final-dist scans are zero; source archive SHA and the complete symlink-free delivery inventory are recorded; all three browsers pass ngspice/core; Chromium-only offline/performance pass; HTML/Worker/SW/manifest IDs match. Any failure leaves no approved manifest. Do not commit generated evidence or build output.

- [ ] **Step 12: Deploy those bytes once, verify the remote is the same RC, then record human/owner gates**

Use the operator-provided, documented static-host command to upload the existing `dist/public` **without rebuilding**. The executing AI must not invent credentials, a hostname or a deploy command. Record the immutable provider release ID outside secrets, then run against the same Step 11 `$releaseRunId/$releaseRunRoot`:

```powershell
if (-not $env:FLUXLAB_RELEASE_BASE_URL) { throw "FLUXLAB_RELEASE_BASE_URL is required" }
if (-not $env:FLUXLAB_PROVIDER_RELEASE_ID) { throw "FLUXLAB_PROVIDER_RELEASE_ID is required" }
if (-not $env:FLUXLAB_STUDY_CUSTODY_JSON) { throw "FLUXLAB_STUDY_CUSTODY_JSON is required before recruitment" }
$env:FLUXLAB_PLAYWRIGHT_TARGET = "release-host"
node scripts/run-release-gates.mjs --phase external --release-run-id $releaseRunId --run-root $releaseRunRoot --source-commit $releaseSourceCommit --app-build-id $env:APP_BUILD_ID --expected-manifest dist/public/release-manifest.json --base-url $env:FLUXLAB_RELEASE_BASE_URL --provider-release-id $env:FLUXLAB_PROVIDER_RELEASE_ID
node scripts/create-study-instance.mjs --template docs/2026-08-28-circuit-simulator-modernization/06-user-study-protocol.md --local-manifest dist/public/release-manifest.json --remote-static-evidence "$releaseRunRoot/evidence/external/remote-static-host.json" --remote-browser-evidence "$releaseRunRoot/evidence/external/remote-browser-smoke.json" --provider-release-id $env:FLUXLAB_PROVIDER_RELEASE_ID --custody $env:FLUXLAB_STUDY_CUSTODY_JSON --output "$releaseRunRoot/study/protocol-instance.json"
```

Expected: external entry first rechecks clean HEAD and the unchanged post-manifest local tree. Remote manifest `releaseRunId/releaseSourceCommit/appBuildId/engineBuildId/resultTransport/moduleSha256/wasmSha256` and every `deliveryFiles` byte equal the local RC. `remote-static-host.json` proves headers/routes/404/MIME and identity; `remote-browser-smoke.json` comes from one fresh context that hashes the remote manifest before and after the run, requires both hashes equal the local manifest, checks visible page app identity plus Worker engine metadata, and runs the 9 V / 1 kΩ / 2 kΩ divider to `6 V ±1 µV`. An absent smoke, site swap, older self-consistent host, provider-side rebuild or one-byte asset drift fails. The study instance must be newly created, require both exactly-once passed reports, include equal local/remote manifest hashes and the exact RC identity, validate the operator-supplied custody/access/retention/deletion fields, and have its own SHA-256 recorded before any participant is recruited. Conduct the human study only against that frozen instance/URL. Credential rotation, remote Git history, old ZIP/source archives and historical release-asset cleanup remain named owner gates with redacted evidence; a clean current RC cannot prove them.

After automated, remote, human and owner evidence is known, update `04-progress.md`/`05-verification.md` and commit a redacted protocol-instance summary plus aggregate study result in a later **evidence-only** commit. It records template/instance hashes and exact RC identity, not raw recordings, identities or custody secrets. That commit may contain no product, dependency, build or test change and does not change the already built `releaseSourceCommit/appBuildId`; if product bytes change, discard the RC and restart Step 10 rather than relabeling it.

## Dependency and Gate Order

```text
T1 engine qualification ───────────────────────────────────────────────┐
T2 cleanup/toolchain ────────────────┐                                 │
T3 contracts → T4 SPICE parser → T5 templates/migration               │
T3/T4/T5 → T6 commands/storage → T7 graph/ERC                         │
T4/T7 → T8 compiler → T9 estimator → T10 adapter                      │
T3/T8/T10 → T11 runs/vectors → T12 measurements/assertions            │
T1/T6/T7/T8/T9/T10/T11/T12 → T13 controller                           │
T13 → T14 DC slice → T15 analyses/instruments → T16 gates             │
T5/T6/T14/T15/T16 → T17 learning                                     │
T4/T5/T6/T11/T15/T17 → T18 files/migration UI                         │
T14–T18 accepted → T19 legacy retirement                              │
T19 → T20 PWA → T21 deployment → T22 UX/performance → T23 release ───┘
```

T1 is a hard stop: no qualifying runtime means no Tasks 8–23. T19 deletion is a hard replacement gate: old implementations remain only until their corresponding new browser journeys pass. T21 proves only the local hosting contract; authoritative production-host, credential/history and human evidence are Task 23 operator/participant gates and remain explicitly blocked rather than guessed.

## Requirement-to-Task Traceability

| Requirement | Implemented by | Required evidence |
|---|---|---|
| R1 unified real simulation | T1, T7–T15, T19 | four ngspice fixtures in three browsers; divider/RC/diode/AC product runs; zero legacy solver symbols |
| R2 beginner-to-engineer continuity | T6, T14–T17 | one project ID across guided/standard/expert; prediction→edit→run→assertion→checkpoint browser journeys |
| R3 traceable results | T8, T10–T15, T18 | coherent RunRecord schema, immutable input bundle, vector provenance, inspector and lossless full export |
| R4 evidence-bound verification | T12, T13, T16 | passed/failed/error, stale, missing corner, cancel/timeout and assertion-only reevaluation tests |
| R5 one SPICE trust boundary | T4, T5, T8, T10, T18 | all-source `.control/.shell/.include` and continuation rejection before storage/FS |
| R6 offline/no hidden network | T2, T13–T20 | context-wide network allowlist, offline RC, V1/V2 atomic update, Cache Storage inspection |
| R7 credential/release hygiene | T2, T23 | rotation/remote cleanup evidence; source tar SHA-256; full-history, unpacked-archive and immutable final-dist scans zero; raw remote manifest plus complete delivery-byte equality |
| R8 safe persistence/migration | T3–T6, T11, T17–T18 | corrupt IDB recovery, atomic revisions, v1 candidates, file size/hash/schema and retention tests |
| R9 change-scoped verification | every task, finalized T23 | RED→GREEN focused checks, affected regressions, robustness, then clean CI/release sequence |
| R10 smaller maintainable product | T2, T19, T22–T23 | 8+12 direct dependencies, measured size gates, static-only output and deleted duplicate pages/solvers |

## Final Release Evidence Sequence

Run this only after every task-specific RED/GREEN cycle is complete **and Task 23 implementation has already been committed**. This is the condensed operator form of Task 23 Steps 11–12; the fixed runner expands to the exact Node/Playwright/security matrix defined there.

```powershell
$dirty = git status --porcelain=v1 --untracked-files=all
if ($dirty) { throw "Release checkout is not clean" }
$releaseSourceCommit = (git rev-parse HEAD).Trim().ToLowerInvariant()
if ($releaseSourceCommit -notmatch '^[0-9a-f]{40}$') { throw "Invalid release source commit" }
$env:RELEASE_SOURCE_COMMIT = $releaseSourceCommit
$env:APP_BUILD_ID = "git-$releaseSourceCommit"
$env:BUILD_PURPOSE = "release"
$env:FLUXLAB_PLAYWRIGHT_TARGET = "local-rc"
$releaseRunId = ([guid]::NewGuid().ToString("N")).ToLowerInvariant()
$releaseRunRoot = Join-Path (Resolve-Path -LiteralPath ".").Path "tests/.artifacts/release/runs/$releaseRunId"
if (Test-Path -LiteralPath $releaseRunRoot) { throw "Release run root already exists" }
$env:RELEASE_RUN_ID = $releaseRunId
corepack pnpm install --frozen-lockfile
git diff --exit-code -- pnpm-lock.yaml
pnpm exec playwright install --with-deps chromium firefox webkit
node scripts/run-release-gates.mjs --phase pre-manifest --release-run-id $releaseRunId --run-root $releaseRunRoot --source-commit $releaseSourceCommit --app-build-id $env:APP_BUILD_ID
node scripts/create-release-manifest.mjs --release-run-id $releaseRunId --dist dist/public --evidence "$releaseRunRoot/evidence/pre-manifest" --source-archive "$releaseRunRoot/fluxlab-source-$releaseSourceCommit.tar" --output dist/public/release-manifest.json
node scripts/run-release-gates.mjs --phase post-manifest --release-run-id $releaseRunId --run-root $releaseRunRoot --source-commit $releaseSourceCommit --app-build-id $env:APP_BUILD_ID --expected-manifest dist/public/release-manifest.json
$headAfterGates = (git rev-parse HEAD).Trim().ToLowerInvariant()
$dirtyAfterGates = git status --porcelain=v1 --untracked-files=all
if ($headAfterGates -ne $releaseSourceCommit -or $dirtyAfterGates) { throw "Release gates changed source state" }
if (-not $env:FLUXLAB_RELEASE_BASE_URL) { throw "Deploy the existing dist/public without rebuilding, then set FLUXLAB_RELEASE_BASE_URL" }
if (-not $env:FLUXLAB_PROVIDER_RELEASE_ID) { throw "FLUXLAB_PROVIDER_RELEASE_ID is required" }
if (-not $env:FLUXLAB_STUDY_CUSTODY_JSON) { throw "FLUXLAB_STUDY_CUSTODY_JSON is required before recruitment" }
$env:FLUXLAB_PLAYWRIGHT_TARGET = "release-host"
node scripts/run-release-gates.mjs --phase external --release-run-id $releaseRunId --run-root $releaseRunRoot --source-commit $releaseSourceCommit --app-build-id $env:APP_BUILD_ID --expected-manifest dist/public/release-manifest.json --base-url $env:FLUXLAB_RELEASE_BASE_URL --provider-release-id $env:FLUXLAB_PROVIDER_RELEASE_ID
node scripts/create-study-instance.mjs --template docs/2026-08-28-circuit-simulator-modernization/06-user-study-protocol.md --local-manifest dist/public/release-manifest.json --remote-static-evidence "$releaseRunRoot/evidence/external/remote-static-host.json" --remote-browser-evidence "$releaseRunRoot/evidence/external/remote-browser-smoke.json" --provider-release-id $env:FLUXLAB_PROVIDER_RELEASE_ID --custody $env:FLUXLAB_STUDY_CUSTODY_JSON --output "$releaseRunRoot/study/protocol-instance.json"
```

Expected automated result: all commands exit 0; the fresh run root, repeated clean-source gates, archive/unpacked source/final-dist immutable scan, exact dependency/license/audit/size/browser/offline/local-host gates pass for one `releaseRunId/releaseSourceCommit/appBuildId`; the deployed host's complete delivery bytes and pre/post-smoke manifest hashes equal the local manifest; and a matching study instance is frozen before recruitment. `05-verification.md` links results only in a later evidence-only commit. Human learning metrics and authoritative credential/history cleanup remain separately named gates with real evidence; neither may be inferred from automated output.

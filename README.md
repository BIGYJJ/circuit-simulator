# FLUXLAB 可信电路仿真工作台

本地优先的单页静态应用：一个项目、一个 ngspice-46 WASM 引擎、一份可追溯运行记录。页面不自算权威电气结果；仿真只从同源、固定哈希的 Worker 加载。

## 当前能力

| 能力 | 实现 |
|---|---|
| 统一工作台 | `/` 项目库，`/project/:id` 原理图/分析/运行/仪器/验证 |
| 课程 | `/learn/:lessonId` 打开或创建模板项目后进入 guided 视图 |
| 引擎 | 合格 `@o.z/ngspice-wasm` / ngspice-46，结果传输 `binary-rawfile` |
| 证据 | 版本化 `.fluxproj` / `.fluxrun`、CIR/CSV 导出、IndexedDB 工作区 |
| 离线 | 安装完成后可断网重开并运行；V1→V2 更新保持 waiting，关尽标签后才切换 |

旧地址 `/divider`、`/led`、`/engineering`、`/engineering/ops` 只重定向一个发布周期，计划于下一正式版本移除。

## 本地命令

工具链固定为 Node `24.15.0`、pnpm `10.4.1`。直接依赖面固定为 runtime 8 + dev 12，见 `scripts/verify-dependencies.mjs`。

| 命令 | 用途 |
|---|---|
| `corepack pnpm dev` | 开发服务器 `127.0.0.1:3000` |
| `corepack pnpm check` | TypeScript |
| `corepack pnpm test` | Vitest |
| `corepack pnpm test:release` | 发布脚本/身份/主机/依赖单测 |
| `corepack pnpm build` | 默认 verification 构建到 `dist/public` |
| `corepack pnpm test:browser:qualification` | 三浏览器引擎资格 |
| `corepack pnpm test:browser:core` | 三浏览器核心旅程 |
| `corepack pnpm test:browser:chromium` | Chromium 回归/发布冒烟/无障碍 |
| `corepack pnpm test:browser:offline` | Chromium PWA 离线更新 |
| `corepack pnpm release:gates` | 固定三相发布门禁 |
| `node scripts/verify-static-host.mjs --root dist/public` | 静态主机契约 |

发布候选必须从干净 commit 以 `BUILD_PURPOSE=release` 构建一次，并由运维提供 `FLUXLAB_RELEASE_BASE_URL`。人体学习协议模板见 `docs/2026-08-28-circuit-simulator-modernization/06-user-study-protocol.md`；成功率不得由自动化伪造。

生产部署见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。子路径部署不在 V1 范围。

> 此工具用于学习与设计探索。仿真读数不能替代元器件数据手册、硬件测量或安全验证。

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

| 命令 | 用途 |
|---|---|
| `corepack pnpm dev` | 开发服务器 `127.0.0.1:3000` |
| `corepack pnpm check` | TypeScript |
| `corepack pnpm test` | Vitest |
| `corepack pnpm build` | 验证构建到 `dist/public` |
| `corepack pnpm exec playwright test` | 浏览器门禁（本地严格静态主机，不是 Vite preview） |
| `node scripts/verify-static-host.mjs --root dist/public` | 静态主机契约 |

生产部署见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。子路径部署不在 V1 范围。

> 此工具用于学习与设计探索。仿真读数不能替代元器件数据手册、硬件测量或安全验证。

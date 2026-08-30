# FLUXLAB 人体学习协议（模板）

protocolVersion: 2026-08-28-user-study-v1

这是版本化规则/模板，不是某次 RC 的实例。不得在本文填写 `releaseSourceCommit`、`appBuildId`、`releaseRunId`、本地/远端 manifest SHA-256 或主机名。正式招募前必须由 `create-study-instance.mjs` 在远端静态核对与浏览器 smoke 都 `passed` 之后冻结实例。

## 必须冻结的身份字段

实例必须包含且彼此相等：

- `protocolVersion`
- `releaseRunId`
- `releaseSourceCommit`
- `appBuildId`
- `engineBuildId`
- `resultTransport`
- `moduleSha256`
- `wasmSha256`
- 本地与远端 `release-manifest.json` 原始字节 SHA-256
- 规范化后的研究用 base URL
- 不可变的提供商 release ID

缺少任一侧外部报告、报告不是 `passed`、身份字段不一致或 manifest 哈希不相等时，不得生成实例，也不得招募。

## 固定脚本与视口

默认桌面视口 1280×800。允许的浏览器：当前 Chromium、Firefox 或 WebKit 稳定版。任务开始前确认离线缓存已就绪或在线可加载同一 RC。

| 队列 | 人数 | 任务 | 时限 | 通过标准 |
|---|---:|---|---|---|
| FLUXLAB 新用户 | 20 | 分压器：从库页新建 9V 分压器，运行 DC 工作点，读出 Vout | 8 min | ≥17/20 得到 6.000000 V |
| FLUXLAB 新用户 | 20 | LED：在课程中改真实参数后再次运行，电流进入目标窗口 | 6 min | ≥18/20 且发生真实参数修改 |
| FLUXLAB 新用户 | 20 | 课程→工作台：完成检查点后展开同一项目工作台 | 10 min | ≥16/20 保持同一 projectId |
| 有 SPICE 经验 | 5 | 工程导入：导入给定网表/项目并跑通一次可追溯运行 | 20 min | ≥4/5 |

概念题：两道固定题（分压比、RC 时间常数）在任务前/后各测一次，要求两题都至少提升 30 个百分点。AI 或自动浏览器不得计为参与者。

## 计时、帮助与排除

研究者在本地计时：任务开始为参与者第一次看到任务说明，结束为参与者提交导出的运行证据或明确放弃。经同意可录屏。参与者必须显式导出运行证据；产品不上传、不埋点、不生成隐藏标识。

只有预先声明的技术无效可以排除并补招：任务开始前浏览器/设备失败，或经同意的录制完全不可用。任务失败、求助、错误结果和超时一律计入，不得排除。每次排除必须记录原因并替换为新的合格参与者。

## 同意、数据保管与删除

招募前必须有操作员提供的保管 JSON，字段至少包括：

- `custodian`：原始数据保管人
- `roles`：可访问原始记录的具体人名与角色
- `retentionDays`：保留天数
- `deletionDate`：删除日期

原始录屏与身份材料不得进入 Git。后续证据提交只允许写：聚合人数/用时/帮助/错误、排除与替换、模板/实例哈希、RC 身份、运行证据哈希，以及非敏感保管引用。

## 阈值与 Pending

若人员或证据不可得，人体门禁记为 Pending，不得把学习/GA 接受指标写成已通过。自动化 RC 质量可以单独报告。

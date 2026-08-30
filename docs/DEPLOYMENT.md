# FLUXLAB 静态主机契约（V1）

V1 只支持站点根路径部署。子路径需要一次覆盖 Vite `base`、wouter base、Service Worker `scope` 和全部资源 URL 的显式设计变更。

## 导航与资源

| 请求 | 行为 |
|---|---|
| `Accept: text/html` 访问 `/`、`/project/*`、`/learn/*`、`/settings`、`/divider`、`/led`、`/engineering`、`/engineering/ops` | 回写 `index.html` |
| 缺失的 `.js` / `.mjs` / `.css` / `.wasm` / 图片 | **真实 404**，不得回写 HTML |
| `/index.html`、`/sw.js`、`/manifest.webmanifest`、`/release-manifest.json` | `Cache-Control: no-cache` |
| `/assets/<content-hash>.*`、带内容哈希的 Worker/WASM | `Cache-Control: public,max-age=31536000,immutable` |
| `.wasm` | `Content-Type: application/wasm` |
| `.mjs` / `.js` / `sw.js` | `Content-Type: text/javascript` |

## 安全头

生产必须 HTTPS，并发送：

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

不要加 COOP/COEP：合格引擎是单线程。

## 校验

```powershell
node scripts/verify-static-host.mjs --root dist/public
```

契约模式只核对路由/MIME/缓存/安全头/404，不要求 `release-manifest.json`（该文件由 Task 23 生成）。发布模式：

```powershell
node scripts/verify-static-host.mjs $env:FLUXLAB_RELEASE_BASE_URL --expected-manifest dist/public/release-manifest.json
```

`FLUXLAB_RELEASE_BASE_URL` 是运维输入，不能由代理编造或提交。

## 本地预览不是生产证据

`vite preview` 的 SPA fallback 不能证明任意主机已正确配置。本地验收使用 `tests/browser/support/versioned-static-server.mjs` 模拟的严格主机。

旧 pretty path 重定向只保留一个发布周期，计划于下一正式版本移除。

import { useEffect, useState } from "react";
import { APP_BUILD_ID, ENGINE_BUILD_ID } from "./build-info";
import {
  subscribeFluxlabServiceWorker,
  type FluxlabServiceWorkerStatus,
} from "./register-service-worker";

function statusText(status: FluxlabServiceWorkerStatus) {
  if (status === "installing") return "正在准备离线仿真";
  if (status === "offline-ready") return "离线可用";
  if (status === "update-waiting") return "保存并关闭所有 FLUXLAB 标签页后重新打开";
  return "离线安装失败";
}

export default function OfflineStatus() {
  const [status, setStatus] = useState<FluxlabServiceWorkerStatus>("installing");

  useEffect(() => subscribeFluxlabServiceWorker(setStatus), []);

  return (
    <p className="offline-status" data-testid="offline-status" data-status={status} aria-live="polite">
      <span data-testid="app-build-id">{APP_BUILD_ID}</span>
      <span data-testid="engine-build-id">{ENGINE_BUILD_ID}</span>
      <span data-testid="sw-status">{statusText(status)}</span>
    </p>
  );
}

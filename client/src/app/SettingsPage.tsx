import { useEffect, useState } from "react";
import { Link } from "wouter";
import { usePreferences } from "../contexts/ThemeContext";
import {
  APP_BUILD_ID,
  ENGINE_BUILD_ID,
  ENGINE_VERSION,
  MODULE_SHA256,
  RESULT_TRANSPORT,
  WASM_SHA256,
} from "./build-info";
import { getFluxlabServiceWorkerRegistration, subscribeFluxlabServiceWorker } from "./register-service-worker";

interface StorageReport {
  estimate: string;
  persisted: string;
  canPersist: boolean;
}

export default function SettingsPage() {
  const { settings, updateSettings } = usePreferences();
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [swStatus, setSwStatus] = useState("unsupported");
  const [swActive, setSwActive] = useState("unsupported");
  const [swWaiting, setSwWaiting] = useState("unsupported");
  const [storage, setStorage] = useState<StorageReport>({ estimate: "正在读取…", persisted: "正在读取…", canPersist: false });

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setSwStatus("unsupported");
      return;
    }
    return subscribeFluxlabServiceWorker(status => {
      const texts = {
        installing: "正在准备离线仿真",
        "offline-ready": "离线可用",
        "update-waiting": "保存并关闭所有 FLUXLAB 标签页后重新打开",
        error: "离线安装失败",
      };
      setSwStatus(texts[status]);
      const registration = getFluxlabServiceWorkerRegistration() ?? navigator.serviceWorker.controller;
      void navigator.serviceWorker.getRegistration().then(current => {
        setSwActive(current?.active ? "active" : "none");
        setSwWaiting(current?.waiting ? "waiting" : "none");
      });
      void registration;
    });
  }, []);

  useEffect(() => {
    const storageApi = navigator.storage;
    if (!storageApi) {
      setStorage({ estimate: "unsupported", persisted: "unsupported", canPersist: false });
      return;
    }
    void (async () => {
      const next: StorageReport = {
        estimate: "unsupported",
        persisted: "unsupported",
        canPersist: typeof storageApi.persist === "function",
      };
      if (typeof storageApi.estimate === "function") {
        try {
          const estimate = await storageApi.estimate();
          next.estimate = `usage=${estimate.usage ?? "unknown"} quota=${estimate.quota ?? "unknown"}`;
        } catch (error) {
          next.estimate = error instanceof Error ? error.message : "estimate failed";
        }
      }
      if (typeof storageApi.persisted === "function") {
        try {
          next.persisted = String(await storageApi.persisted());
        } catch (error) {
          next.persisted = error instanceof Error ? error.message : "persisted failed";
        }
      }
      setStorage(next);
    })();
  }, []);

  async function requestPersist() {
    if (!navigator.storage?.persist) return;
    try {
      const persisted = await navigator.storage.persist();
      setStorage(current => ({ ...current, persisted: String(persisted) }));
    } catch (error) {
      setStorage(current => ({ ...current, persisted: error instanceof Error ? error.message : "persist failed" }));
    }
  }

  return (
    <main className="settings-page">
      <p>
        <Link href="/">项目库</Link>
      </p>
      <h1>设置</h1>
      <dl>
        <div>
          <dt>构建身份</dt>
          <dd data-testid="settings-app-build-id">{APP_BUILD_ID}</dd>
        </div>
        <div>
          <dt>引擎版本</dt>
          <dd data-testid="settings-engine-version">{ENGINE_VERSION || "unavailable"}</dd>
        </div>
        <div>
          <dt>引擎构建</dt>
          <dd data-testid="settings-engine-build-id">{ENGINE_BUILD_ID || "unavailable"}</dd>
        </div>
        <div>
          <dt>结果传输</dt>
          <dd data-testid="settings-result-transport">{RESULT_TRANSPORT}</dd>
        </div>
        <div>
          <dt>模块 SHA-256</dt>
          <dd data-testid="settings-module-sha256">{MODULE_SHA256}</dd>
        </div>
        <div>
          <dt>WASM SHA-256</dt>
          <dd data-testid="settings-wasm-sha256">{WASM_SHA256}</dd>
        </div>
        <div>
          <dt>在线状态</dt>
          <dd data-testid="settings-online">{online ? "online" : "offline"}</dd>
        </div>
        <div>
          <dt>Service Worker</dt>
          <dd data-testid="settings-sw-status">{swStatus}</dd>
          <dd data-testid="settings-sw-active">{swActive}</dd>
          <dd data-testid="settings-sw-waiting">{swWaiting}</dd>
        </div>
        <div>
          <dt>navigator.storage.estimate()</dt>
          <dd data-testid="settings-storage-estimate">{storage.estimate}</dd>
        </div>
        <div>
          <dt>navigator.storage.persisted()</dt>
          <dd data-testid="settings-storage-persisted">{storage.persisted}</dd>
        </div>
      </dl>
      {storage.canPersist ? (
        <button type="button" data-testid="settings-persist" onClick={() => void requestPersist()}>
          请求持久存储
        </button>
      ) : null}
      <form className="settings-prefs">
        <label>
          主题
          <select aria-label="主题" data-testid="settings-theme" value={settings.theme} onChange={event => void updateSettings({ theme: event.target.value as typeof settings.theme })}>
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
        <label>
          减少动效
          <select
            aria-label="减少动效"
            data-testid="settings-motion"
            value={settings.reducedMotion}
            onChange={event => void updateSettings({ reducedMotion: event.target.value as typeof settings.reducedMotion })}
          >
            <option value="system">跟随系统</option>
            <option value="reduce">减少</option>
          </select>
        </label>
        <label>
          默认视图
          <select
            aria-label="默认视图"
            data-testid="settings-default-view"
            value={settings.defaultView}
            onChange={event => void updateSettings({ defaultView: event.target.value as typeof settings.defaultView })}
          >
            <option value="guided">引导</option>
            <option value="standard">标准</option>
            <option value="expert">专家</option>
          </select>
        </label>
      </form>
    </main>
  );
}

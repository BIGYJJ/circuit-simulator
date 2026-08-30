import { useEffect, useState } from "react";
import { Link } from "wouter";

interface StorageReport {
  estimate: string;
  persisted: string;
}

export default function SettingsPage() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [storage, setStorage] = useState<StorageReport>({ estimate: "正在读取…", persisted: "正在读取…" });

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
    const storageApi = navigator.storage;
    if (!storageApi) {
      setStorage({ estimate: "unsupported", persisted: "unsupported" });
      return;
    }
    void (async () => {
      const next: StorageReport = { estimate: "unsupported", persisted: "unsupported" };
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

  return (
    <main className="settings-page">
      <p>
        <Link href="/">项目库</Link>
      </p>
      <h1>设置</h1>
      <dl>
        <div>
          <dt>构建身份</dt>
          <dd>verification / nonReleaseBuild（Task 23 之前不是发布候选）</dd>
        </div>
        <div>
          <dt>在线状态</dt>
          <dd>{online ? "online" : "offline"}</dd>
        </div>
        <div>
          <dt>navigator.storage.estimate()</dt>
          <dd>{storage.estimate}</dd>
        </div>
        <div>
          <dt>navigator.storage.persisted()</dt>
          <dd>{storage.persisted}</dd>
        </div>
        <div>
          <dt>引擎元数据</dt>
          <dd>unavailable（仿真 Worker 尚未接入）</dd>
        </div>
        <div>
          <dt>Service Worker</dt>
          <dd>not installed</dd>
        </div>
      </dl>
    </main>
  );
}

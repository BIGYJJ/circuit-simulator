import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { openOrCreateLessonProject } from "../features/learning/lessons";
import {
  acknowledgeLegacyNotice,
  hasAcknowledgedLegacyNotice,
  loadLastOpenedProject,
  loadProject,
  type LegacyNoticeValue,
} from "../storage/indexeddb";

export type LegacyPath = LegacyNoticeValue["path"];

const NOTICE_SESSION_KEY = "fluxlab-legacy-notice";

function isLegacyPath(value: string | null): value is LegacyPath {
  return value === "/divider" || value === "/led" || value === "/engineering" || value === "/engineering/ops";
}

export function peekLegacyNoticeSession(): LegacyPath | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(NOTICE_SESSION_KEY);
  return isLegacyPath(raw) ? raw : null;
}

export function LegacyMigrationNotice({ path }: { path: LegacyPath | null }) {
  if (!path) return null;
  return (
    <p data-testid="legacy-notice" role="status">
      旧地址 {path} 已迁到统一工作台。本重定向只保留一个发布周期，计划于下一正式版本移除。
    </p>
  );
}

function lessonFor(path: LegacyPath) {
  if (path === "/divider") return "foundation-divider";
  if (path === "/led") return "foundation-led";
  return null;
}

export default function LegacyRedirect({ path }: { path: LegacyPath }) {
  const [, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const acked = await hasAcknowledgedLegacyNotice(path);
      if (cancelled) return;
      if (!acked.ok) {
        setError(acked.diagnostics[0]?.code ?? "LEGACY_NOTICE_FAILED");
        return;
      }
      if (!acked.value) {
        sessionStorage.setItem(NOTICE_SESSION_KEY, path);
        const written = await acknowledgeLegacyNotice(path);
        if (!written.ok) {
          setError(written.diagnostics[0]?.code ?? "LEGACY_NOTICE_FAILED");
          return;
        }
      } else {
        sessionStorage.removeItem(NOTICE_SESSION_KEY);
      }
      const lessonId = lessonFor(path);
      if (lessonId) {
        const opened = await openOrCreateLessonProject(lessonId);
        if (cancelled) return;
        if (!opened.ok) {
          setError(opened.diagnostics[0]?.code ?? "LESSON_UNKNOWN");
          return;
        }
        navigate(`/project/${opened.value.projectId}?lesson=${lessonId}&view=guided`, { replace: true });
        return;
      }
      const last = await loadLastOpenedProject();
      if (cancelled) return;
      if (!last.ok) {
        setError(last.diagnostics[0]?.code ?? "STORAGE_INVALID_SETTING");
        return;
      }
      const loaded = last.value ? await loadProject(last.value.projectId) : { ok: true as const, value: null, diagnostics: [] };
      if (cancelled) return;
      if (!loaded.ok) {
        setError(loaded.diagnostics[0]?.code ?? "STORAGE_READ_FAILED");
        return;
      }
      if (loaded.value) {
        const panel = path === "/engineering/ops" ? "verification" : "analysis";
        navigate(`/project/${loaded.value.id}?panel=${panel}`, { replace: true });
        return;
      }
      navigate("/?needProject=1", { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, path]);

  if (error) {
    return (
      <main className="workspace-error">
        <p data-testid="legacy-redirect-error">{error}</p>
      </main>
    );
  }
  return <main className="workspace-error">正在转到统一工作台…</main>;
}

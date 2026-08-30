import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { openOrCreateLessonProject } from "../features/learning/lessons";
import {
  acknowledgeLegacyNotice,
  hasAcknowledgedLegacyNotice,
  loadLastOpenedProject,
  loadProject,
} from "../storage/indexeddb";
import { LEGACY_NOTICE_SESSION_KEY, type LegacyPath } from "./legacy-notice";

export type { LegacyPath } from "./legacy-notice";
export { LegacyMigrationNotice, peekLegacyNoticeSession } from "./legacy-notice";

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
        sessionStorage.setItem(LEGACY_NOTICE_SESSION_KEY, path);
        const written = await acknowledgeLegacyNotice(path);
        if (!written.ok) {
          setError(written.diagnostics[0]?.code ?? "LEGACY_NOTICE_FAILED");
          return;
        }
      } else {
        sessionStorage.removeItem(LEGACY_NOTICE_SESSION_KEY);
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

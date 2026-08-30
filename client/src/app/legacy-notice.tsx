export type LegacyPath = "/divider" | "/led" | "/engineering" | "/engineering/ops";

export const LEGACY_NOTICE_SESSION_KEY = "fluxlab-legacy-notice";

function isLegacyPath(value: string | null): value is LegacyPath {
  return value === "/divider" || value === "/led" || value === "/engineering" || value === "/engineering/ops";
}

export function peekLegacyNoticeSession(): LegacyPath | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(LEGACY_NOTICE_SESSION_KEY);
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

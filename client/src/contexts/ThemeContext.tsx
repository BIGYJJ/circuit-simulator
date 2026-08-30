import React, { createContext, useContext, useEffect, useState } from "react";
import type { LocalSettingsV1 } from "../storage/indexeddb";

export const DEFAULT_LOCAL_SETTINGS: LocalSettingsV1 = {
  schemaVersion: 1,
  theme: "system",
  reducedMotion: "system",
  defaultView: "standard",
};

interface PreferencesContextType {
  settings: LocalSettingsV1;
  resolvedTheme: "light" | "dark";
  updateSettings: (patch: Partial<Omit<LocalSettingsV1, "schemaVersion">>) => Promise<void>;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

function systemTheme(): "light" | "dark" {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyDocumentSettings(settings: LocalSettingsV1) {
  const theme = settings.theme === "system" ? systemTheme() : settings.theme;
  const reduce =
    settings.reducedMotion === "reduce" ||
    (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.reducedMotion = reduce ? "reduce" : "no-preference";
  return theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<LocalSettingsV1>(DEFAULT_LOCAL_SETTINGS);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    let cancelled = false;
    void import("../storage/indexeddb").then(({ loadLocalSettings }) => {
      void loadLocalSettings().then(result => {
        if (cancelled || !result.ok || !result.value) return;
        setSettings(result.value);
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setResolvedTheme(applyDocumentSettings(settings));
    const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setResolvedTheme(applyDocumentSettings(settings));
    themeQuery.addEventListener("change", sync);
    motionQuery.addEventListener("change", sync);
    return () => {
      themeQuery.removeEventListener("change", sync);
      motionQuery.removeEventListener("change", sync);
    };
  }, [settings]);

  async function updateSettings(patch: Partial<Omit<LocalSettingsV1, "schemaVersion">>) {
    const next = { ...settings, ...patch, schemaVersion: 1 as const };
    const { saveLocalSettings } = await import("../storage/indexeddb");
    const saved = await saveLocalSettings(next);
    if (saved.ok) setSettings(next);
  }

  return <PreferencesContext.Provider value={{ settings, resolvedTheme, updateSettings }}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error("usePreferences must be used within ThemeProvider");
  return context;
}

export function useTheme() {
  const { resolvedTheme } = usePreferences();
  return { theme: resolvedTheme, switchable: true };
}

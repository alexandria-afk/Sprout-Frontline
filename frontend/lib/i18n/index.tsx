"use client";

/**
 * Lightweight i18n context — no external library required.
 *
 * Usage:
 *   const { t, locale, setLocale } = useTranslation();
 *   t("nav.dashboard")   → "แดชบอร์ด"  (when locale is "th")
 *   t("button.submit")   → "ส่ง"
 *
 * Falls back to the key itself if no translation is found.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import en from "@/messages/en.json";
import th from "@/messages/th.json";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Locale = "en" | "th";

type Messages = typeof en;
const MESSAGES: Record<Locale, Messages> = { en, th: th as Messages };

interface I18nContext {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, fallback?: string) => string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolve(messages: Messages, key: string): string | undefined {
  // Supports "nav.dashboard", "button.submit", etc.
  return key.split(".").reduce<unknown>((obj, part) => {
    if (obj && typeof obj === "object") return (obj as Record<string, unknown>)[part];
    return undefined;
  }, messages) as string | undefined;
}

const STORAGE_KEY = "frontliner_locale";

// ── Context ───────────────────────────────────────────────────────────────────

const Ctx = createContext<I18nContext>({
  locale: "en",
  setLocale: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (saved && (saved === "en" || saved === "th")) {
        setLocaleState(saved);
      }
    } catch {}
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const t = useCallback(
    (key: string, fallback?: string): string => {
      const msg = MESSAGES[locale];
      const value = resolve(msg, key);
      if (value !== undefined) return value;

      // Fallback to English
      const enValue = resolve(MESSAGES.en, key);
      if (enValue !== undefined) return enValue;

      // Fallback to caller-supplied string or the key itself
      return fallback ?? key;
    },
    [locale]
  );

  return <Ctx.Provider value={{ locale, setLocale, t }}>{children}</Ctx.Provider>;
}

export function useTranslation(): I18nContext {
  return useContext(Ctx);
}

// ── Convenience re-exports ────────────────────────────────────────────────────

export type { I18nContext };

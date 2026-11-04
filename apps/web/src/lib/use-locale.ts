"use client";

import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/content/i18n";

const STORAGE_KEY = "unpeek-locale";

export function useLocale(): [Locale, (next: Locale) => void] {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "tr") {
        setLocaleState(stored);
        document.documentElement.lang = stored;
      }
    } catch {
      // storage can be blocked; the page keeps the default locale
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.documentElement.lang = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore write failures
    }
  }, []);

  return [locale, setLocale];
}

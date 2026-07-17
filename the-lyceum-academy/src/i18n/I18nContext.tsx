import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { translations, LANGUAGES, type AppLanguage } from './translations';

export type { AppLanguage };

const STORAGE_KEY = 'lyceum_lang';
const DEFAULT_LANG: AppLanguage = 'en';

// ── Auto-detect language from browser/OS ───────────────────────────────────
function autoDetectLang(): AppLanguage {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  try {
    // 1. URL param ?lang=xx
    const urlLang = new URLSearchParams(window.location.search).get('lang');
    if (urlLang) {
      const match = LANGUAGES.find(l => l.code === urlLang.toLowerCase());
      if (match) return match.code;
    }
    // 2. Saved preference
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const match = LANGUAGES.find(l => l.code === stored);
      if (match) return match.code;
    }
    // 3. Browser/OS language
    const browserLang = navigator.language || (navigator as any).userLanguage || '';
    const base = browserLang.split('-')[0].toLowerCase();
    const match = LANGUAGES.find(l => l.code === base);
    if (match) return match.code;
  } catch { /* ignore */ }
  return DEFAULT_LANG;
}

// ── Context ────────────────────────────────────────────────────────────────
interface I18nContextType {
  lang: AppLanguage;
  setLang: (lang: AppLanguage) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<AppLanguage>(() => autoDetectLang());

  const setLang = useCallback((next: AppLanguage) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.lang = next;
      // RTL support for Arabic
      document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
    } catch { /* ignore */ }
  }, []);

  // Translation function: resolves "namespace.key" with fallback to English.
  // Supports {{variable}} interpolation.
  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    const langStrings = translations[lang] || {};
    let value = (langStrings as Record<string, string>)[key]
      || (translations.en as Record<string, string>)[key]
      || key;

    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        value = value.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
      });
    }

    return value;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}

export function getLangDisplayName(code: string): string {
  return LANGUAGES.find(l => l.code === code)?.label || code;
}

export function getLangFlag(code: string): string {
  return LANGUAGES.find(l => l.code === code)?.flag || '';
}

/**
 * Read the current language directly from localStorage.
 * Use this in non-component modules (e.g. api.ts) where the React hook is unavailable.
 */
export function getCurrentLang(): AppLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const match = LANGUAGES.find(l => l.code === stored);
      if (match) return match.code;
    }
  } catch { /* ignore */ }
  return DEFAULT_LANG;
}

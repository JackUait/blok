import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { type Locale, defaultLocale, getTranslation, localeNames } from '../i18n';

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  localeNames: Record<Locale, string>;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const STORAGE_KEY = 'blok-docs-locale';

const getInitialLocale = (): Locale => {
  if (typeof window === 'undefined') {
    return defaultLocale;
  }
  
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'ru') {
    return stored;
  }
  
  const browserLang = navigator.language.split('-')[0];
  if (browserLang === 'ru') {
    return 'ru';
  }
  
  return defaultLocale;
};

interface I18nProviderProps {
  children: ReactNode;
}

export const I18nProvider = ({ children }: I18nProviderProps) => {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(STORAGE_KEY, newLocale);
    document.documentElement.lang = newLocale;
  }, []);

  // Set initial document language
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback((key: string) => {
    return getTranslation(locale, key);
  }, [locale]);

  const value: I18nContextType = useMemo(() => ({
    locale,
    setLocale,
    t,
    localeNames,
  }), [locale, setLocale, t]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = (): I18nContextType => {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
};

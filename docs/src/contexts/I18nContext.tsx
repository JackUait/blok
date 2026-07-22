import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { type Locale, defaultLocale, getTranslation, localeNames } from '../i18n';
import { DEFAULT_LOCALE, localizedPath, splitLocalePath } from '../seo/locales';

interface I18nContextType {
  locale: Locale;
  /**
   * Records a language preference. The locale itself comes from the URL, so
   * this only writes the hint the site root reads; the switch itself happens by
   * navigating to the other tree.
   */
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  localeNames: Record<Locale, string>;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const STORAGE_KEY = 'blok-docs-locale';

const readStoredLocale = (): Locale | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'en' || stored === 'ru' ? stored : null;
};

interface I18nProviderProps {
  children: ReactNode;
  /**
   * The locale the route resolved to. Optional so component tests can render the
   * provider on its own; the app always passes it down from the URL.
   */
  locale?: Locale;
}

export const I18nProvider = ({ children, locale: routeLocale }: I18nProviderProps) => {
  // Only used when nothing controls the provider (component tests). In the app
  // the URL is the single source of truth — that is what gives the Russian tree
  // an address, and hreflang something to point at.
  const [uncontrolledLocale, setUncontrolledLocale] = useState<Locale>(defaultLocale);
  const locale = routeLocale ?? uncontrolledLocale;

  const setLocale = useCallback((newLocale: Locale) => {
    localStorage.setItem(STORAGE_KEY, newLocale);
    setUncontrolledLocale(newLocale);
  }, []);

  // Keeps <html lang> correct across client-side navigation. The prerendered
  // files already carry the right value — root.tsx renders it — because this
  // effect never runs during a build.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback((key: string) => getTranslation(locale, key), [locale]);

  const value: I18nContextType = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      localeNames,
    }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextType => {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
};

/** The locale the current URL resolves to — what the app feeds `I18nProvider`. */
export const useRouteLocale = (): Locale => splitLocalePath(useLocation().pathname).locale;

/**
 * Maps the current page onto its address in another locale, so the language
 * switch can be a real `<a href>` a crawler follows rather than a click handler.
 */
export const useLocalePath = (): ((locale: Locale) => string) => {
  const { pathname } = useLocation();
  return useCallback(
    (locale: Locale) => localizedPath(splitLocalePath(pathname).path, locale),
    [pathname],
  );
};

/**
 * Maps a site-absolute internal path onto the locale tree the current URL is in.
 *
 * Every link in the app is written as the English address (`/docs/table`), and
 * the `/ru/**` routes are a second absolute route table, not a `basename` — so
 * without this, one click from `/ru/docs/table` dropped the reader into English
 * and the entire Russian subtree had no internal inbound links at all.
 *
 * Anything that is not a site-absolute path (`#anchor`, `https://…`) passes
 * through untouched, and so does a path that already names a locale tree — that
 * is what the language switches build, and re-prefixing it would produce
 * `/ru/ru/…`.
 */
export const useLocalizedHref = (): ((to: string) => string) => {
  const { pathname } = useLocation();

  return useCallback(
    (to: string) => {
      if (!to.startsWith('/') || to.startsWith('//')) return to;
      const current = splitLocalePath(pathname).locale;
      if (current === DEFAULT_LOCALE) return to;
      return splitLocalePath(to).locale === DEFAULT_LOCALE ? localizedPath(to, current) : to;
    },
    [pathname],
  );
};

/**
 * The only place a stored preference still moves anyone: a reader who once chose
 * Russian lands on `/ru` when they open the bare site root.
 *
 * It fires nowhere except `/`, so a visitor — or a crawler — that asked for a
 * specific URL is never taken off it, and a crawler's storage is empty so the
 * root is never redirected for one either. The destination is a prerendered
 * page, so this cannot land on a soft 404, and it is never `/`, so it cannot
 * loop.
 */
export const StoredLocaleRedirect = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (pathname !== '/') {
      return;
    }
    const stored = readStoredLocale();
    if (stored === null || stored === DEFAULT_LOCALE) {
      return;
    }
    navigate(localizedPath('/', stored), { replace: true });
  }, [pathname, navigate]);

  return null;
};

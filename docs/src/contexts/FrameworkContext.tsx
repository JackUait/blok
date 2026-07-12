import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router-dom';

/** The integration entry points Blok ships an adapter (or core API) for. */
export type Framework = 'vanilla' | 'react' | 'vue' | 'angular';

/** Canonical order — drives the toggle layout and the snippet maps. */
export const FRAMEWORK_IDS: Framework[] = ['vanilla', 'react', 'vue', 'angular'];

interface FrameworkContextType {
  framework: Framework;
  setFramework: (framework: Framework) => void;
}

const FrameworkContext = createContext<FrameworkContextType | undefined>(undefined);

const STORAGE_KEY = 'blok-docs-framework';
/** Query param that carries the choice in the URL, so links are shareable. */
const QUERY_KEY = 'framework';
const defaultFramework: Framework = 'vanilla';

const isFramework = (value: string | null): value is Framework =>
  value !== null && (FRAMEWORK_IDS as string[]).includes(value);

const getStoredFramework = (): Framework => {
  if (typeof window === 'undefined') {
    return defaultFramework;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return isFramework(stored) ? stored : defaultFramework;
};

interface FrameworkProviderProps {
  children: ReactNode;
}

/**
 * Holds the framework whose code examples the docs show. The choice lives in the
 * URL (`?framework=`) as the shareable source of truth, with localStorage as the
 * first-load fallback. Resolution order on mount: URL param → localStorage →
 * default. Non-default selections are mirrored into the URL (and re-applied after
 * navigating through links that drop the query string); the default stays out of
 * the URL to keep links clean.
 */
export const FrameworkProvider = ({ children }: FrameworkProviderProps) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlValue = searchParams.get(QUERY_KEY);

  // localStorage-backed fallback for when the URL carries no (valid) param.
  const [storedFramework, setStoredFramework] = useState<Framework>(getStoredFramework);

  // The URL is the source of truth; deriving (rather than mirroring into state)
  // means a shared link, back/forward, or hand-edited address bar takes effect
  // immediately, with no adopt-effect that could fight a local selection.
  const framework: Framework = isFramework(urlValue) ? urlValue : storedFramework;

  const writeParam = useCallback(
    (next: Framework) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === defaultFramework) {
            params.delete(QUERY_KEY);
          } else {
            params.set(QUERY_KEY, next);
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setFramework = useCallback(
    (next: Framework) => {
      setStoredFramework(next);
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, next);
      }
      writeParam(next);
    },
    [writeParam],
  );

  // Keep the active (non-default) framework in the URL even after navigating
  // through links that carry no query string (sidebar, search, prev/next), and
  // reflect a restored selection into the address bar on first load.
  useEffect(() => {
    if (framework === defaultFramework) return;
    if (urlValue === framework) return;
    writeParam(framework);
  }, [framework, urlValue, writeParam]);

  const value: FrameworkContextType = useMemo(
    () => ({ framework, setFramework }),
    [framework, setFramework],
  );

  return (
    <FrameworkContext.Provider value={value}>{children}</FrameworkContext.Provider>
  );
};

export const useFramework = (): FrameworkContextType => {
  const context = useContext(FrameworkContext);
  if (context === undefined) {
    throw new Error('useFramework must be used within a FrameworkProvider');
  }
  return context;
};

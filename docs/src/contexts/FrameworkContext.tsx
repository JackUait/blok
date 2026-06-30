import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

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
const defaultFramework: Framework = 'vanilla';

const isFramework = (value: string | null): value is Framework =>
  value !== null && (FRAMEWORK_IDS as string[]).includes(value);

const getInitialFramework = (): Framework => {
  if (typeof window === 'undefined') {
    return defaultFramework;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return isFramework(stored) ? stored : defaultFramework;
};

interface FrameworkProviderProps {
  children: ReactNode;
}

export const FrameworkProvider = ({ children }: FrameworkProviderProps) => {
  const [framework, setFrameworkState] = useState<Framework>(getInitialFramework);

  const setFramework = useCallback((next: Framework) => {
    setFrameworkState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

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

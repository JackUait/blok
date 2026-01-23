import { useEffect, useState } from 'react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import {
  createHighlighter,
  type Highlighter,
  type BundledLanguage,
  type SpecialLanguage,
} from 'shiki';
import { PackageManagerToggle, type PackageManager } from './PackageManagerToggle';

interface CodeBlockProps {
  code: string;
  language?: string;
  copyLabel?: string;
  showPackageManagerToggle?: boolean;
  packageName?: string;
  onPackageManagerChange?: (manager: PackageManager) => void;
}

const getInstallCommand = (packageName: string, manager: PackageManager): string => {
  switch (manager) {
    case 'yarn':
      return `yarn add ${packageName}`;
    case 'npm':
      return `npm install ${packageName}`;
    case 'bun':
      return `bun add ${packageName}`;
    default:
      return `npm install ${packageName}`;
  }
};

// Singleton highlighter instance
const highlighterState = {
  instance: null as Highlighter | null,
  initPromise: null as Promise<Highlighter> | null,
};

const getHighlighterInstance = (): Highlighter | null => highlighterState.instance;
const setHighlighterInstance = (instance: Highlighter | null): void => {
  highlighterState.instance = instance;
};
const getInitPromise = (): Promise<Highlighter> | null => highlighterState.initPromise;
const setInitPromise = (promise: Promise<Highlighter> | null): void => {
  highlighterState.initPromise = promise;
};

const supportedLangs: (BundledLanguage | SpecialLanguage)[] = [
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'bash',
  'sh',
  'json',
  'css',
  'html',
  'markdown',
  'md',
  'python',
];

// Display names for languages
const languageDisplayNames: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  jsx: 'JSX',
  bash: 'Terminal',
  sh: 'Shell',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  markdown: 'Markdown',
  md: 'Markdown',
  python: 'Python',
};

const loadLanguageIfNeeded = async (highlighter: Highlighter, lang: string): Promise<void> => {
  const langKey = lang.toLowerCase() as BundledLanguage | SpecialLanguage;
  const isLangLoaded = highlighter.getLoadedLanguages().includes(langKey);

  if (isLangLoaded) {
    return;
  }

  try {
    await highlighter.loadLanguage(langKey);
  } catch {
    // Language not available, will use plaintext
  }
};

const getHighlighter = async (lang: string): Promise<Highlighter> => {
  const highlighterInstance = getHighlighterInstance();

  if (highlighterInstance) {
    await loadLanguageIfNeeded(highlighterInstance, lang);
    return highlighterInstance;
  }

  const initPromise = getInitPromise();
  if (!initPromise) {
    // Initialize with only the languages we need
    const newInitPromise = createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: supportedLangs,
    }).then((highlighter) => {
      setHighlighterInstance(highlighter);
      return highlighter;
    });

    setInitPromise(newInitPromise);
    return newInitPromise;
  }

  return initPromise;
};

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language = 'bash',
  copyLabel = 'Copy',
  showPackageManagerToggle = false,
  packageName,
  onPackageManagerChange,
}) => {
  const { copyToClipboard } = useCopyToClipboard();
  const [copied, setCopied] = useState(false);
  const [highlightedCode, setHighlightedCode] = useState<string>('');
  const [isDark, setIsDark] = useState(false);
  const [packageManager, setPackageManager] = useState<PackageManager>('yarn');

  // Compute the display code based on package manager selection
  const displayCode = showPackageManagerToggle && packageName
    ? getInstallCommand(packageName, packageManager)
    : code;

  const handlePackageManagerChange = (manager: PackageManager) => {
    setPackageManager(manager);
    onPackageManagerChange?.(manager);
  };

  // Detect system dark mode preference for matching code content theme
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsDark(e.matches);
    };

    updateTheme(mediaQuery);
    mediaQuery.addEventListener('change', updateTheme);

    return () => {
      mediaQuery.removeEventListener('change', updateTheme);
    };
  }, []);

  // Highlight code - match theme to content background
  useEffect(() => {
    const highlight = async () => {
      try {
        const highlighter = await getHighlighter(language);
        const langKey = language.toLowerCase() as BundledLanguage | SpecialLanguage;
        const lang = highlighter.getLoadedLanguages().includes(langKey)
          ? langKey
          : 'plaintext';

        const html = highlighter.codeToHtml(displayCode, {
          lang,
          theme: isDark ? 'github-dark' : 'github-light',
        });

        setHighlightedCode(html);
      } catch {
        // Fallback to plain text if highlighting fails
        setHighlightedCode(`<pre class="shiki"><code>${escapeHtml(displayCode)}</code></pre>`);
      }
    };

    void highlight();
  }, [displayCode, language, isDark]);

  const handleCopy = async () => {
    const success = await copyToClipboard(displayCode);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const displayLanguage = languageDisplayNames[language.toLowerCase()] || language;

  return (
    <div className="code-block" data-code-block>
      <div className="code-block-header">
        <div className="code-block-controls">
          <span className="code-block-control code-block-control--red" />
          <span className="code-block-control code-block-control--yellow" />
          <span className="code-block-control code-block-control--green" />
        </div>
        <span className="code-block-language">{displayLanguage}</span>
        {showPackageManagerToggle && packageName && (
          <div className="code-block-package-toggle">
            <PackageManagerToggle onChange={handlePackageManagerChange} />
          </div>
        )}
        <button
          className={`code-copy ${copied ? 'copied' : ''}`}
          data-copy
          data-code={displayCode}
          onClick={handleCopy}
          type="button"
          aria-label={copied ? 'Copied!' : copyLabel}
        >
          {copied ? (
            <svg
              className="code-copy-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <polyline
                points="20 6 9 17 4 12"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg
              className="code-copy-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <rect
                x="9"
                y="9"
                width="13"
                height="13"
                rx="2"
                ry="2"
                strokeWidth="2"
              />
              <path
                d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>
      <div className="code-block-content">
        <div dangerouslySetInnerHTML={{ __html: highlightedCode }} />
      </div>
    </div>
  );
};

const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

import { useEffect, useRef, useState } from "react";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { useI18n } from '../../contexts/I18nContext';
import {
  createHighlighter,
  type Highlighter,
  type BundledLanguage,
  type SpecialLanguage,
} from "shiki";
import {
  PackageManagerToggle,
  type PackageManager,
} from "./PackageManagerToggle";

interface CodeBlockProps {
  code: string;
  language?: string;
  copyLabel?: string;
  showPackageManagerToggle?: boolean;
  packageName?: string;
  onPackageManagerChange?: (manager: PackageManager) => void;
  /**
   * When embedded inside a parent surface (e.g. a window frame), drop the
   * block's own border / radius / background / language label so it blends into
   * the host shell instead of drawing a second card outline. The host is
   * expected to label the block itself.
   */
  embedded?: boolean;
}

const getInstallCommand = (
  packageName: string,
  manager: PackageManager,
): string => {
  switch (manager) {
    case "yarn":
      return `yarn add ${packageName}`;
    case "npm":
      return `npm install ${packageName}`;
    case "bun":
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

const getHighlighterInstance = (): Highlighter | null =>
  highlighterState.instance;
const setHighlighterInstance = (instance: Highlighter | null): void => {
  highlighterState.instance = instance;
};
const getInitPromise = (): Promise<Highlighter> | null =>
  highlighterState.initPromise;
const setInitPromise = (promise: Promise<Highlighter> | null): void => {
  highlighterState.initPromise = promise;
};

const supportedLangs: (BundledLanguage | SpecialLanguage)[] = [
  "javascript",
  "typescript",
  "tsx",
  "jsx",
  "vue",
  "bash",
  "sh",
  "json",
  "css",
  "html",
  "markdown",
  "md",
  "python",
];

// Display names for languages
const languageDisplayNames: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  tsx: "TSX",
  jsx: "JSX",
  vue: "Vue",
  bash: "Terminal",
  sh: "Shell",
  json: "JSON",
  css: "CSS",
  html: "HTML",
  markdown: "Markdown",
  md: "Markdown",
  python: "Python",
};

const loadLanguageIfNeeded = async (
  highlighter: Highlighter,
  lang: string,
): Promise<void> => {
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
    // Using vitesse-dark for dark mode (excellent property highlighting) and one-light for light mode
    const newInitPromise = createHighlighter({
      themes: ["vitesse-dark", "one-light"],
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

// Shiki's codeToHtml emits the theme's calibrated background as an inline
// style on the <pre> (e.g. style="background-color:#121212;..."). Pull it out
// so the surrounding card can match it exactly instead of forcing a generic
// `--card` background behind the tokens (which breaks the contrast ratios the
// theme was calibrated for).
const extractBackgroundColor = (html: string): string | undefined => {
  const match = /background-color:\s*([^;"]+)/i.exec(html);
  return match?.[1];
};

// Helper to create plain text HTML fallback (matches Shiki structure)
const createPlainTextHtml = (text: string): string => {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
  // Use same structure as Shiki output - pre.shiki > code
  return `<pre class="shiki"><code>${escaped}</code></pre>`;
};

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language = "bash",
  copyLabel,
  showPackageManagerToggle = false,
  packageName,
  onPackageManagerChange,
  embedded = false,
}) => {
  const { copyToClipboard } = useCopyToClipboard();
  const { t } = useI18n();
  const actualCopyLabel = copyLabel ?? t('codeBlock.copy');
  const [copied, setCopied] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [packageManager, setPackageManager] = useState<PackageManager>("yarn");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const hasPackageManagerToggle = Boolean(showPackageManagerToggle && packageName);

  // Compute the display code based on package manager selection
  const displayCode =
    showPackageManagerToggle && packageName
      ? getInstallCommand(packageName, packageManager)
      : code;

  // Initialize with plain text fallback immediately to prevent flash of empty content
  const [highlightedCode, setHighlightedCode] = useState<string>(() => createPlainTextHtml(displayCode));

  const handlePackageManagerChange = (manager: PackageManager) => {
    setPackageManager(manager);
    onPackageManagerChange?.(manager);
  };

  // Detect dark mode from the document theme class (set by the site's theme toggle)
  useEffect(() => {
    const checkDarkMode = () => {
      // Check for dark class on html element (common pattern for theme toggles)
      const isDarkMode = document.documentElement.classList.contains("dark");
      setIsDark(isDarkMode);
    };

    // Initial check
    checkDarkMode();

    // Watch for class changes on the html element
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  // Highlight code - match theme to content background
  useEffect(() => {
    const highlight = async () => {
      try {
        const highlighter = await getHighlighter(language);
        const langKey = language.toLowerCase() as
          | BundledLanguage
          | SpecialLanguage;
        const lang = highlighter.getLoadedLanguages().includes(langKey)
          ? langKey
          : "plaintext";

        const html = highlighter.codeToHtml(displayCode, {
          lang,
          theme: isDark ? "vitesse-dark" : "one-light",
        });

        setHighlightedCode(html);
      } catch {
        // Fallback to plain text if highlighting fails
        setHighlightedCode(createPlainTextHtml(displayCode));
      }
    };

    void highlight();
  }, [displayCode, language, isDark]);

  // Track horizontal overflow to fade the scroll edges
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const updateEdges = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      setEdges({
        left: el.scrollLeft > 1,
        right: el.scrollLeft < maxScroll - 1,
      });
    };

    updateEdges();
    el.addEventListener("scroll", updateEdges, { passive: true });
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateEdges)
        : null;
    observer?.observe(el);

    return () => {
      el.removeEventListener("scroll", updateEdges);
      observer?.disconnect();
    };
  }, [highlightedCode]);

  const handleCopy = async () => {
    const success = await copyToClipboard(displayCode);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      trackEvent(ANALYTICS_EVENTS.copyCode, {
        language,
        // Only meaningful when the install-command toggle is on screen; omitted
        // (dropped by trackEvent) for plain code blocks.
        package_manager: hasPackageManagerToggle ? packageManager : undefined,
      });
    }
  };

  const displayLanguage =
    languageDisplayNames[language.toLowerCase()] || language;

  // The theme's own calibrated background — kept (not stripped to transparent)
  // so token colors retain the contrast ratios the theme was designed for.
  const codeBg = extractBackgroundColor(highlightedCode);

  return (
    <div
      className={cn(
        "code-block group relative overflow-hidden",
        !embedded && "rounded-2xl border border-border bg-card",
      )}
      data-code-block
      data-blok-testid="code-block"
    >
      {/* Embedded: the host already labels the block, so the copy button is all
          that's left — pin it to the code's top-right instead of letting it
          float on a row of its own. */}
      <div
        className={cn(
          "flex items-center gap-3",
          embedded ? "absolute top-1.5 right-1.5 z-10" : "px-3 pt-3 pb-1.5",
        )}
      >
        {showPackageManagerToggle && packageName ? (
          <PackageManagerToggle onChange={handlePackageManagerChange} />
        ) : (
          !embedded && (
            <span className="pl-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {displayLanguage}
            </span>
          )
        )}
        <button
          className={cn(
            "ml-auto inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            copied && "text-primary",
          )}
          data-copy
          data-code={displayCode}
          data-blok-testid="code-copy-button"
          onClick={handleCopy}
          type="button"
          aria-label={copied ? t('codeBlock.copied') : actualCopyLabel}
        >
          {copied ? (
            <svg
              className="size-4"
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
              className="size-4"
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
      <div className={cn("relative", !embedded && "mx-3 mb-3")}>
        <div
          ref={scrollRef}
          className={cn(
            "overflow-x-auto rounded-xl pt-3 pb-3 pl-4 font-mono text-sm leading-relaxed [&_pre]:!m-0 [&_code]:font-mono",
            embedded ? "pr-12" : "pr-8",
          )}
          style={{ backgroundColor: codeBg }}
        >
          <div dangerouslySetInnerHTML={{ __html: highlightedCode }} />
        </div>
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-8 rounded-l-xl transition-opacity duration-200",
            edges.left ? "opacity-100" : "opacity-0",
          )}
          style={{
            backgroundImage: codeBg
              ? `linear-gradient(to right, ${codeBg}, transparent)`
              : undefined,
          }}
        />
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-xl transition-opacity duration-200",
            edges.right ? "opacity-100" : "opacity-0",
          )}
          style={{
            backgroundImage: codeBg
              ? `linear-gradient(to left, ${codeBg}, transparent)`
              : undefined,
          }}
        />
      </div>
    </div>
  );
};

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import { useNavigate } from "react-router-dom";
import { search, getSearchIndex } from "@/utils/search";
import type { SearchResult } from "@/types/search";
import { ModuleIcon } from "./ModuleIcon";
import { KindIcon } from "./KindIcon";
import { useI18n } from "../../contexts/I18nContext";
import { cn } from "@/lib/utils";

interface SearchProps {
  open: boolean;
  onClose: () => void;
}

const SEARCH_SHORTCUT = "k";
const SEARCH_DEBOUNCE_MS = 150;

// Keycap chip — mirrors the ⌘K kbd in the search input.
const KEYCAP_CLASS =
  "inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-secondary px-1 font-mono text-[10px] font-semibold leading-none text-muted-foreground/70";

// Highlight matching text in search results
// Matches the query term OR words that share a common prefix with it
const highlightMatch = (text: string, query: string): React.ReactNode => {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) return text;

  // Split query into words for multi-word matching
  const queryWords = trimmedQuery.split(/\s+/).filter((w) => w.length >= 2);
  if (queryWords.length === 0) return text;

  // Build a regex that matches:
  // 1. The exact query words
  // 2. Words that start with query words (prefix match)
  // 3. Words that the query words start with (reverse prefix - query "blocks" highlights "block")
  const patterns: string[] = [];
  for (const qw of queryWords) {
    // Escape special regex characters
    const escaped = qw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match word boundaries: query word followed by optional word chars (prefix match)
    patterns.push(`\\b${escaped}\\w*`);
    // Also match if query is longer: e.g., query "blocks" should highlight "block"
    if (qw.length >= 4) {
      // Try progressively shorter prefixes (minimum 3 chars)
      const prefixPatterns = Array.from({ length: qw.length - 3 }, (_, i) => {
        const prefix = qw
          .slice(0, qw.length - 1 - i)
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return `\\b${prefix}\\b`;
      });
      patterns.push(...prefixPatterns);
    }
  }

  const pattern = `(${patterns.join("|")})`;
  const splitRegex = new RegExp(pattern, "gi");
  const parts = text.split(splitRegex);

  // Use a fresh regex for testing each part (avoid global state issues)
  const testRegex = new RegExp(pattern, "i");

  return parts.map((part, index) =>
    testRegex.test(part) ? (
      <mark
        key={index}
        className="rounded-[3px] bg-primary/12 px-0.5 font-semibold text-primary"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
};

/** Group search results by module, preserving a predefined module order. */
const groupResultsByModule = (
  searchResults: SearchResult[],
): SearchResult[] => {
  const moduleOrder = ["Guide", "Core", "API Modules", "Data", "Page"];
  const groupedByModule = new Map<string, SearchResult[]>();

  for (const result of searchResults) {
    const existing = groupedByModule.get(result.module);

    if (existing) {
      existing.push(result);
    } else {
      groupedByModule.set(result.module, [result]);
    }
  }

  const orderedResults: SearchResult[] = [];

  for (const module of moduleOrder) {
    const moduleResults = groupedByModule.get(module);

    if (!moduleResults) continue;

    orderedResults.push(...moduleResults);
  }

  for (const [module, moduleResults] of groupedByModule) {
    if (moduleOrder.includes(module)) continue;

    orderedResults.push(...moduleResults);
  }

  return orderedResults;
};

const MORPH_MS = 420;
const CLOSE_ANIMATION_MS = MORPH_MS;
const PANEL_MAX_WIDTH = 560;
// easeOutExpo: a strong, smooth deceleration. The surface flies open then gently
// settles — reads as a soft morph instead of an abrupt pop.
const MORPH_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export const Search: React.FC<SearchProps> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const [isKeyboardNavMode, setIsKeyboardNavMode] = useState(false);
  // Morph state: `entered` drives the pill→panel geometry transition.
  const [entered, setEntered] = useState(false);
  const [pillWidth, setPillWidth] = useState<number | null>(null);
  const [targetWidth, setTargetWidth] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const keyboardNavTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Morph open: paint the surface at the pill's width first, then on the next
  // frame flip `entered` so width / radius / height transition into the panel.
  useLayoutEffect(() => {
    if (!open) return;

    const slotWidth = wrapperRef.current?.parentElement?.clientWidth ?? null;
    setPillWidth(slotWidth);
    // Resolve the final panel width to a concrete px value so the collapsed→expanded
    // width morph interpolates (px→% transitions snap instead of animating).
    setTargetWidth(Math.min(PANEL_MAX_WIDTH, window.innerWidth - 32));

    // Double rAF: let the collapsed (pill-width) geometry paint for one frame, THEN flip
    // `entered` so width / radius / height have a real "from" value and actually animate.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open]);

  // Reset state when closed
  useEffect(() => {
    if (open) return;

    setQuery("");
    setDebouncedQuery("");
    setResults([]);
    setSelectedIndex(0);
    setIsClosing(false);
    setIsKeyboardNavMode(false);
    setEntered(false);
    setPillWidth(null);
    setTargetWidth(null);

    if (!keyboardNavTimerRef.current) return;

    clearTimeout(keyboardNavTimerRef.current);
    keyboardNavTimerRef.current = null;
  }, [open]);

  // Cleanup keyboard nav timer on unmount
  useEffect(() => {
    return () => {
      if (keyboardNavTimerRef.current) {
        clearTimeout(keyboardNavTimerRef.current);
      }
    };
  }, []);

  // Animated close handler — reverse the morph, then unmount after it settles.
  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setEntered(false);
    setTimeout(() => {
      onClose();
    }, CLOSE_ANIMATION_MS);
  }, [isClosing, onClose]);

  // Close when clicking anywhere outside the inline panel.
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, handleClose]);

  // Handle global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isEscapeKey = e.key === "Escape";
      const isEscapeWithOpen = isEscapeKey && open;
      const isShortcutKey =
        (e.metaKey || e.ctrlKey) && e.key === SEARCH_SHORTCUT;

      // Handle Escape key separately
      if (isEscapeWithOpen) {
        handleClose();
        return;
      }

      // Cmd/Ctrl + K to open search
      if (!isShortcutKey) {
        return;
      }

      e.preventDefault();
      if (open) {
        handleClose();
      }
      // If not open, we need to trigger opening through the parent component
      // This is handled by the Nav component
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, handleClose]);

  // Debounce the search query
  useEffect(() => {
    if (!query.trim()) {
      setDebouncedQuery("");
      return;
    }

    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  // Search functionality with debounced query
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }

    const searchResults = search(debouncedQuery, getSearchIndex());
    const orderedResults = groupResultsByModule(searchResults);

    setResults(orderedResults);
    setSelectedIndex(0);
  }, [debouncedQuery]);

  // Handle result click
  const handleResultClick = useCallback(
    (result: SearchResult) => {
      const url = result.hash ? `${result.path}#${result.hash}` : result.path;
      navigate(url);
      handleClose();
    },
    [navigate, handleClose],
  );

  // Handle keyboard navigation within results
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (results.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setIsKeyboardNavMode(true);
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          // Clear any existing timer and set a new one
          if (keyboardNavTimerRef.current) {
            clearTimeout(keyboardNavTimerRef.current);
          }
          keyboardNavTimerRef.current = setTimeout(() => {
            setIsKeyboardNavMode(false);
          }, 500);
          break;
        case "ArrowUp":
          e.preventDefault();
          setIsKeyboardNavMode(true);
          setSelectedIndex((i) => Math.max(i - 1, 0));
          // Clear any existing timer and set a new one
          if (keyboardNavTimerRef.current) {
            clearTimeout(keyboardNavTimerRef.current);
          }
          keyboardNavTimerRef.current = setTimeout(() => {
            setIsKeyboardNavMode(false);
          }, 500);
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            handleResultClick(results[selectedIndex]);
          }
          break;
      }
    },
    [results, selectedIndex, handleResultClick],
  );

  // Scroll a buffer element into view within the results container
  const scrollBufferElement = useCallback(
    (
      bufferElement: Element | undefined,
      container: HTMLElement,
      containerRect: DOMRect,
      edge: "top" | "bottom",
    ) => {
      if (!bufferElement) return;

      const bufferRect = bufferElement.getBoundingClientRect();

      const scrollOffset =
        edge === "top"
          ? bufferRect.top - containerRect.top + container.scrollTop - 10
          : bufferRect.bottom -
            containerRect.top +
            container.scrollTop -
            container.clientHeight +
            10;

      const topValue =
        edge === "top" ? Math.max(0, scrollOffset) : scrollOffset;
      container.scrollTo({ top: topValue, behavior: "auto" });
      inputRef.current?.focus();
    },
    [],
  );

  // Scroll selected result into view with buffer (only for keyboard navigation)
  const scrollSelectedIntoView = useCallback(() => {
    if (!resultsRef.current || results.length === 0) return;

    const container = resultsRef.current;
    const allResults = Array.from(
      container.querySelectorAll("[data-search-result-index]"),
    );
    const selectedElement = allResults[selectedIndex] as
      | HTMLElement
      | undefined;

    if (!selectedElement) return;

    const bufferSize = 1; // Show 1 item above/below when possible
    const containerRect = container.getBoundingClientRect();
    const selectedRect = selectedElement.getBoundingClientRect();

    // Position relative to container's visible area
    const elementTop = selectedRect.top - containerRect.top;
    const elementBottom = selectedRect.bottom - containerRect.top;
    const containerHeight = container.clientHeight;

    // Buffer zone: roughly 1 item worth of space (~60px for search results)
    const bufferPixels = 70;

    // Check if selected element is near top edge
    if (elementTop < bufferPixels) {
      const bufferTopIndex = Math.max(0, selectedIndex - bufferSize);
      scrollBufferElement(
        allResults[bufferTopIndex],
        container,
        containerRect,
        "top",
      );
      return;
    }

    // Check if selected element is near bottom edge
    if (elementBottom <= containerHeight - bufferPixels) return;

    const bufferBottomIndex = Math.min(
      allResults.length - 1,
      selectedIndex + bufferSize,
    );
    scrollBufferElement(
      allResults[bufferBottomIndex],
      container,
      containerRect,
      "bottom",
    );
  }, [selectedIndex, results.length, scrollBufferElement]);

  // Auto-scroll only follows keyboard navigation. Hovering a result near the
  // top/bottom edge moves the selection too, but must NOT yank the list.
  useEffect(() => {
    if (!isKeyboardNavMode) return;
    scrollSelectedIntoView();
  }, [scrollSelectedIntoView, isKeyboardNavMode]);

  if (!open) return null;

  // Inline morph: a single surface that grows out of the nav pill. The collapsed
  // pill and this surface share geometry (slot width, 48px tall, full-round), so
  // flipping `entered` transitions width / border-radius while the results region
  // unrolls via the grid-rows 0fr→1fr trick — reading as one continuous shape.
  // The wrapper holds the FINAL panel width and is centered exactly once (a constant
  // translate), so the centering never drifts mid-morph. The dialog inside animates its
  // own width and stays centered via auto margins — sidestepping the transform-vs-width
  // race where `-translate-x-1/2` on an auto-width box freezes then snaps. Collapsed, the
  // dialog matches the nav pill's width; `entered` widens it to fill the wrapper.
  const expandedWidth = targetWidth
    ? `${targetWidth}px`
    : `min(${PANEL_MAX_WIDTH}px, calc(100vw - 2rem))`;
  const dialogWidth = entered
    ? expandedWidth
    : pillWidth
      ? `${pillWidth}px`
      : expandedWidth;

  return (
    <div
      ref={wrapperRef}
      className="pointer-events-none absolute left-1/2 top-0 z-50 -translate-x-1/2"
      style={{ width: expandedWidth }}
    >
      <div
        className="pointer-events-auto mx-auto overflow-hidden border border-border bg-card"
        style={{
          width: dialogWidth,
          // 1.5rem == half the 48px collapsed height, so it reads as a full-round pill at
          // rest but never balloons into an ellipse as the box grows (unlike 9999px).
          borderRadius: entered ? "1rem" : "1.5rem",
          boxShadow: entered
            ? "0 16px 48px -12px rgba(17,17,17,0.22)"
            : "0 2px 8px rgba(17,17,17,0.07)",
          transition: `width ${MORPH_MS}ms ${MORPH_EASE}, border-radius ${MORPH_MS}ms ${MORPH_EASE}, box-shadow ${MORPH_MS}ms ${MORPH_EASE}`,
        }}
        ref={dialogRef}
        data-blok-testid="search-dialog"
      >
        {/* Header mirrors the nav pill so the morph reads as that pill growing:
            neutral semibold prompt on the left, ⌘K hint + coral circular button on
            the right. The coral circle is the shared anchor that holds its place
            through the width morph. */}
        <div
          className={cn(
            "flex h-12 items-center border-b pl-5 pr-1.5 transition-colors duration-200",
            entered ? "border-border" : "border-transparent",
          )}
        >
          <input
            ref={inputRef}
            type="text"
            className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold tracking-[-0.01em] text-foreground placeholder:font-semibold placeholder:text-foreground/55 focus:outline-none"
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
          />
          <div className="ml-3 flex shrink-0 items-center gap-2.5">
            {query ? (
              <button
                className="flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                type="button"
                aria-label={t("search.clearSearch")}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M12 4L4 12M4 4l8 8"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            ) : (
              <kbd className="hidden items-center gap-0.5 rounded-md bg-secondary px-1.5 py-1 font-mono text-[10px] font-semibold leading-none text-muted-foreground/70 sm:inline-flex">
                <span className="text-[12px] leading-none">⌘</span>K
              </kbd>
            )}
            <button
              type="button"
              onClick={() => inputRef.current?.focus()}
              tabIndex={-1}
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-white shadow-[0_1px_3px_rgba(225,29,72,0.35)] transition-transform duration-200 hover:scale-105"
              aria-label={t("nav.searchAriaLabel")}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                <circle
                  cx="9"
                  cy="9"
                  r="6.25"
                  stroke="currentColor"
                  strokeWidth="2.2"
                />
                <path
                  d="M17.5 17.5l-4-4"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <div
          className="grid"
          style={{
            gridTemplateRows: entered ? "1fr" : "0fr",
            transition: `grid-template-rows ${MORPH_MS}ms ${MORPH_EASE}`,
          }}
        >
          <div
            className="min-h-0 overflow-hidden"
            style={{
              opacity: entered ? 1 : 0,
              // Content rises a few px into place so it lands after the surface
              // opens, instead of every row appearing at once. Slight delay on open
              // lets the box start unrolling first; fades out promptly on close.
              transform: entered ? "translateY(0)" : "translateY(8px)",
              transition: entered
                ? `opacity ${MORPH_MS}ms ${MORPH_EASE} 70ms, transform ${MORPH_MS}ms ${MORPH_EASE} 70ms`
                : `opacity ${Math.round(MORPH_MS * 0.5)}ms ease-out, transform ${MORPH_MS}ms ${MORPH_EASE}`,
            }}
          >
            <div className="max-h-[60vh] overflow-y-auto p-2" ref={resultsRef}>
              {results.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-12 text-center">
                  {query.trim() ? (
                    <>
                      {/* Same doc page, greyed — no coral title — giving a resigned
                          head-shake because nothing matched. */}
                      <div className="mb-4" aria-hidden="true">
                        <svg width="72" height="82" viewBox="0 0 56 64" fill="none">
                          <g>
                            <path
                              d="M12 7H36L48 19V54a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V11a4 4 0 0 1 4-4Z"
                              className="fill-card stroke-muted-foreground/40"
                              strokeWidth="1.6"
                              strokeLinejoin="round"
                            />
                            <path
                              d="M36 7v8a4 4 0 0 0 4 4h8"
                              className="fill-secondary stroke-muted-foreground/40"
                              strokeWidth="1.6"
                              strokeLinejoin="round"
                            />
                            {/* Blank, greyed content — nothing matched */}
                            <rect x="16" y="23" width="22" height="4.5" rx="2.25" className="fill-muted-foreground/30" />
                            <rect x="16" y="33" width="24" height="3" rx="1.5" className="fill-muted-foreground/20" />
                            <rect x="16" y="39" width="19" height="3" rx="1.5" className="fill-muted-foreground/20" />
                            <rect x="16" y="45" width="22" height="3" rx="1.5" className="fill-muted-foreground/20" />
                          </g>
                        </svg>
                      </div>
                      <p className="text-base font-semibold text-foreground">
                        {t("search.noResultsFor")}{" "}
                        <span className="text-primary">
                          &ldquo;{query.trim()}&rdquo;
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("search.noResultsDescription")}
                      </p>
                    </>
                  ) : (
                    <>
                      {/* One confident doc page. Its dog-ear corner folds and
                          unfolds from time to time: the flap pivots around the
                          diagonal crease. The page body stays notched, so when the
                          flap lays flat (card-coloured) it completes the rectangle,
                          and when folded it shows the underside dog-ear. */}
                      <div
                        className="mb-4"
                        aria-hidden="true"
                        style={{ perspective: "300px" }}
                      >
                        <svg
                          width="72"
                          height="82"
                          viewBox="0 0 56 64"
                          fill="none"
                          style={{ overflow: "visible", transformStyle: "preserve-3d" }}
                        >
                          {/* Page fill (notched) — unstroked; the outline below skips
                              the diagonal so no crease shows when the corner unfolds. */}
                          <path
                            d="M12 7H36L48 19V54a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V11a4 4 0 0 1 4-4Z"
                            className="fill-card"
                          />
                          <path
                            d="M48 19V54a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V11a4 4 0 0 1 4-4H36"
                            className="stroke-muted-foreground/40"
                            strokeWidth="1.6"
                            fill="none"
                            strokeLinejoin="round"
                          />
                          {/* Coral title block + body lines */}
                          <rect x="16" y="23" width="22" height="4.5" rx="2.25" className="fill-primary" />
                          <rect x="16" y="33" width="24" height="3" rx="1.5" className="fill-muted-foreground/35" />
                          <rect x="16" y="39" width="19" height="3" rx="1.5" className="fill-muted-foreground/35" />
                          <rect x="16" y="45" width="22" height="3" rx="1.5" className="fill-muted-foreground/35" />
                          {/* The folding corner flap, drawn at its unfolded
                              position; the animation pivots it onto the page. Its
                              two leg strokes become the rectangle's top+right edges
                              when flat, and the dog-ear's free edges when folded. */}
                          <g className="paper-fold">
                            <path
                              className="paper-fold-face"
                              d="M36 7H44a4 4 0 0 1 4 4V19Z"
                            />
                            <path
                              d="M36 7H44a4 4 0 0 1 4 4V19"
                              className="stroke-muted-foreground/40"
                              strokeWidth="1.6"
                              fill="none"
                              strokeLinejoin="round"
                            />
                          </g>
                          {/* The crease, along the fixed fold axis. Visible only
                              when folded (it's the cut edge); fades out as the corner
                              lays flat so the rectangle reads seamless. */}
                          <path
                            className="paper-crease stroke-muted-foreground/40"
                            d="M36 7L48 19"
                            strokeWidth="1.6"
                            fill="none"
                            strokeLinecap="round"
                          />
                        </svg>
                      </div>
                      <p className="text-base font-semibold text-foreground">
                        {t("search.emptyTitle")}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("search.emptyDescription")}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div className="px-3 pb-1.5 pt-1.5">
                    <span
                      className="text-xs text-muted-foreground"
                      data-blok-testid="search-results-count"
                    >
                      {results.length}{" "}
                      {results.length === 1
                        ? t("search.result")
                        : t("search.results")}
                    </span>
                  </div>
                  {results.map((result, index) => {
                    const showModuleHeader =
                      index === 0 ||
                      result.module !== results[index - 1].module;
                    const isSelected = index === selectedIndex;

                    return (
                      <div key={result.id}>
                        {showModuleHeader && (
                          <div
                            className={cn(
                              "flex items-center gap-2 px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70",
                              index === 0 ? "pt-1" : "pt-3",
                            )}
                            data-blok-testid="search-module-header"
                          >
                            <ModuleIcon module={result.module} />
                            <span>{result.module}</span>
                          </div>
                        )}
                        <button
                          className={cn(
                            "group flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
                            isSelected
                              ? "bg-secondary"
                              : "hover:bg-secondary/60",
                          )}
                          onClick={() => handleResultClick(result)}
                          type="button"
                          onMouseEnter={() => {
                            if (!isKeyboardNavMode) {
                              setSelectedIndex(index);
                            }
                          }}
                          data-search-result-index={index}
                          data-keyboard-nav={isKeyboardNavMode}
                        >
                          {/* Kind tile: a glyph that's the same for every result of a
                              kind, so the eye groups methods / options / pages before
                              reading a word. Methods carry the coral accent (callable). */}
                          <span
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                              result.kind === "method"
                                ? "bg-primary/10 text-primary"
                                : isSelected
                                  ? "bg-background text-muted-foreground"
                                  : "bg-secondary text-muted-foreground group-hover:bg-background",
                            )}
                            data-blok-testid="search-result-kind"
                            data-kind={result.kind}
                          >
                            <KindIcon kind={result.kind} />
                          </span>
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-medium text-foreground">
                                {highlightMatch(result.title, query)}
                              </span>
                              <span
                                className={cn(
                                  "shrink-0 text-[10px] font-semibold uppercase tracking-[0.05em]",
                                  result.kind === "method"
                                    ? "text-primary/80"
                                    : "text-muted-foreground/60",
                                )}
                              >
                                {t(`search.kind.${result.kind}`)}
                              </span>
                            </span>
                            <p className="truncate text-xs text-muted-foreground">
                              {result.section && (
                                <span className="font-medium text-foreground/65">
                                  {result.section}
                                  {result.description ? " · " : ""}
                                </span>
                              )}
                              {highlightMatch(result.description || "", query)}
                            </p>
                          </div>
                          <svg
                            className={cn(
                              "shrink-0 text-muted-foreground/50 transition-opacity duration-150",
                              isSelected ? "opacity-100" : "opacity-0",
                            )}
                            width="14"
                            height="14"
                            viewBox="0 0 16 16"
                            fill="none"
                          >
                            <path
                              d="M6 3l5 5-5 5"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            <div className="flex items-center justify-center gap-4 border-t border-border bg-secondary/40 px-5 py-2.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-1">
                  <kbd className={KEYCAP_CLASS}>↑</kbd>
                  <kbd className={KEYCAP_CLASS}>↓</kbd>
                </span>
                {t("search.navigate")}
              </span>
              <span className="h-3 w-px bg-border" />
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <kbd className={KEYCAP_CLASS}>↵</kbd>
                {t("search.select")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

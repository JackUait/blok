import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { Link } from "./Link";
import { search, getSearchIndex } from "@/utils/search";
import type { SearchResult } from "@/types/search";
import { KindIcon } from "./KindIcon";
import { Typo } from "./Typo";
import { useI18n, useLocalizedHref } from "../../contexts/I18nContext";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import {
  GROUP_LABEL_CLASS,
  LaunchpadList,
  ROW_CLASS,
  SearchPreview,
  isCodeKind,
  moduleIcon,
  shortTitle,
  useModuleTitle,
  type LaunchpadItem,
  type PreviewTarget,
} from "./SearchLaunchpad";

interface SearchProps {
  open: boolean;
  onClose: () => void;
  /** Dim the page behind the panel. Driven by the same morph as the panel so
      the tint fades in/out in lockstep with the open/close animation. */
  tinted?: boolean;
  /**
   * The button that opened the dialog. Focus returns here when the dialog
   * closes (Escape, outside click, or selecting a result) — required so the
   * dialog doesn't strand keyboard focus once it unmounts.
   */
  triggerRef?: React.RefObject<HTMLElement | null>;
}

const SEARCH_SHORTCUT = "k";
const SEARCH_DEBOUNCE_MS = 150;

// Each must find results in the real index; Search.test.tsx checks it.
const SUGGESTED_QUERIES = ["blocks.insert", "toolbox", "onChange", "readOnly"];

const MODULE_ORDER = [
  "Getting started",
  "Core",
  "Editing",
  "Interface",
  "Extending & system",
  "Data types",
  "Page",
];

const moduleRank = (module: string): number => {
  const rank = MODULE_ORDER.indexOf(module);
  return rank === -1 ? MODULE_ORDER.length : rank;
};

/** The address a result points at — its page, plus the in-page anchor if any. */
const resultHref = (result: SearchResult): string =>
  result.hash ? `${result.path}#${result.hash}` : result.path;

// Keycap chip — mirrors the ⌘K kbd in the search input.
const KEYCAP_CLASS =
  "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-b-2 border-border bg-secondary px-1 font-mono text-[10.5px] leading-none text-muted-foreground";

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
        className="bg-transparent font-semibold text-primary"
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

  for (const module of MODULE_ORDER) {
    const moduleResults = groupedByModule.get(module);

    if (!moduleResults) continue;

    orderedResults.push(...moduleResults);
  }

  for (const [module, moduleResults] of groupedByModule) {
    if (MODULE_ORDER.includes(module)) continue;

    orderedResults.push(...moduleResults);
  }

  return orderedResults;
};

type ResultsPluralForm = "one" | "few" | "many";

/**
 * Russian needs three grammatical plural forms for counts (one/few/many) —
 * "1 результат", "2 результата", "5 результатов" — unlike English's binary
 * singular/plural split. Mirrors the i18next `_one`/`_few`/`_many` suffix
 * convention so the right `search.result_<form>` key gets picked.
 */
const getResultsPluralForm = (count: number, locale: string): ResultsPluralForm => {
  if (locale === "ru") {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return "one";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
    return "many";
  }
  return count === 1 ? "one" : "many";
};

const MORPH_MS = 420;
const CLOSE_ANIMATION_MS = MORPH_MS;
const PANEL_MAX_WIDTH = 640;
// easeOutExpo: a strong, smooth deceleration. The surface flies open then gently
// settles — reads as a soft morph instead of an abrupt pop.
const MORPH_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export const Search: React.FC<SearchProps> = ({
  open,
  onClose,
  tinted,
  triggerRef,
}) => {
  const navigate = useNavigate();
  const localizedHref = useLocalizedHref();
  const { t, locale } = useI18n();
  const moduleTitle = useModuleTitle();
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
  // Module picked from a launchpad tile: lists its entries and scopes typing.
  const [scope, setScope] = useState<string | null>(null);
  // Starts on the first item so the preview pane is never empty.
  const [launchpadIndex, setLaunchpadIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const keyboardNavTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Tracks whether the dialog was actually open, so the close-side effect
  // only returns focus to the trigger on a real close, not on first mount.
  const wasOpenRef = useRef(false);

  const launchpadItems = useMemo<LaunchpadItem[]>(() => {
    if (!open) return [];

    const counts = new Map<string, number>();
    for (const item of getSearchIndex()) {
      counts.set(item.module, (counts.get(item.module) ?? 0) + 1);
    }
    const modules = [...counts.entries()]
      .sort(([a], [b]) => moduleRank(a) - moduleRank(b))
      .map(([module, count]) => ({ kind: "module" as const, module, count }));

    return [
      ...SUGGESTED_QUERIES.map((value) => ({ kind: "query" as const, value })),
      ...modules,
    ];
  }, [open]);

  const showLaunchpad = !query.trim() && !scope;

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Analytics: one open event per open, not per render.
  useEffect(() => {
    if (!open) return;

    trackEvent(ANALYTICS_EVENTS.searchOpen);
  }, [open]);

  // A11y: while open, hide the rest of the page from assistive tech and
  // keyboard focus so Tab can't walk out of the dialog into the sidebar/page
  // content behind it. Walks up from the dialog to <body>, inerting every
  // sibling along the way (same `inert` mechanism used for FrameworkCards'
  // accordion panels), and restores them on close.
  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const restoreFns: Array<() => void> = [];
    let node: HTMLElement | null = dialog;

    while (node && node !== document.body && node.parentElement) {
      const parent: HTMLElement = node.parentElement;
      Array.from(parent.children).forEach((sibling) => {
        if (sibling === node || !(sibling instanceof HTMLElement)) return;
        if (sibling.hasAttribute("inert")) return;
        sibling.setAttribute("inert", "");
        restoreFns.push(() => sibling.removeAttribute("inert"));
      });
      node = parent;
    }

    return () => {
      restoreFns.forEach((restore) => restore());
    };
  }, [open]);

  // A11y: trap Tab/Shift+Tab focus inside the dialog while it's open, so
  // keyboard users can't tab past it into the (inerted, but defense-in-depth)
  // page behind it.
  useEffect(() => {
    if (!open) return;

    const handleTabTrap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.getAttribute("tabindex") !== "-1");

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleTabTrap);
    return () => window.removeEventListener("keydown", handleTabTrap);
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
    if (open) {
      wasOpenRef.current = true;
      return;
    }

    setQuery("");
    setDebouncedQuery("");
    setResults([]);
    setSelectedIndex(0);
    setIsClosing(false);
    setIsKeyboardNavMode(false);
    setEntered(false);
    setPillWidth(null);
    setTargetWidth(null);
    setScope(null);
    setLaunchpadIndex(0);

    // Only return focus on an actual close (Escape, outside click, or
    // selecting a result) — not on first mount while already closed.
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef?.current?.focus();
    }

    if (!keyboardNavTimerRef.current) return;

    clearTimeout(keyboardNavTimerRef.current);
    keyboardNavTimerRef.current = null;
  }, [open, triggerRef]);

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
      setResults(
        scope
          ? getSearchIndex()
              .filter((item) => item.module === scope)
              .map(({ keywords: _keywords, ...item }) => ({ ...item, rank: 0 }))
          : [],
      );
      setSelectedIndex(0);
      return;
    }

    const searchResults = search(debouncedQuery, getSearchIndex()).filter(
      (result) => !scope || result.module === scope,
    );
    const orderedResults = groupResultsByModule(searchResults);

    setResults(orderedResults);
    setSelectedIndex(0);

    // Analytics fires on the SETTLED query only — this effect is keyed on the
    // debounced value, so a burst of keystrokes reports one search, not one per
    // character.
    const normalizedQuery = debouncedQuery.trim().toLowerCase();

    trackEvent(ANALYTICS_EVENTS.searchQuery, {
      query: normalizedQuery,
      results_count: orderedResults.length,
    });

    if (orderedResults.length === 0) {
      trackEvent(ANALYTICS_EVENTS.searchNoResults, { query: normalizedQuery });
    }
  }, [debouncedQuery, scope]);

  // Report + dismiss, shared by the mouse and the Enter key so analytics can't
  // drift between the two. Navigation is deliberately NOT here: a click is
  // carried by the result's own <a href>, which is what makes the palette's
  // destinations discoverable at all.
  const trackResultSelect = useCallback(
    (result: SearchResult, index: number) => {
      trackEvent(ANALYTICS_EVENTS.searchResultSelect, {
        query: debouncedQuery.trim().toLowerCase(),
        result_title: result.title,
        result_path: result.path,
        result_module: result.module,
        result_index: index,
      });
      handleClose();
    },
    [handleClose, debouncedQuery],
  );

  // Enter has no anchor to follow, so it navigates itself — through the same
  // locale mapping the rendered <Link> uses, or Enter would leave the Russian
  // tree while a click on the same row stayed in it.
  const handleResultEnter = useCallback(
    (result: SearchResult, index: number) => {
      trackResultSelect(result, index);
      navigate(localizedHref(resultHref(result)));
    },
    [navigate, localizedHref, trackResultSelect],
  );

  const pickLaunchpadItem = useCallback((item: LaunchpadItem) => {
    if (item.kind === "query") {
      setQuery(item.value);
    } else {
      setScope(item.module);
    }
    setLaunchpadIndex(0);
    inputRef.current?.focus();
  }, []);

  const handleLaunchpadKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setLaunchpadIndex((i) => Math.min(i + 1, launchpadItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setLaunchpadIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (launchpadItems[launchpadIndex]) {
            pickLaunchpadItem(launchpadItems[launchpadIndex]);
          }
          break;
      }
    },
    [launchpadItems, launchpadIndex, pickLaunchpadItem],
  );

  // Handle keyboard navigation within results
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Backspace" && !query && scope) {
        e.preventDefault();
        setScope(null);
        return;
      }

      if (showLaunchpad) {
        handleLaunchpadKeyDown(e);
        return;
      }

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
            handleResultEnter(results[selectedIndex], selectedIndex);
          }
          break;
      }
    },
    [
      results,
      selectedIndex,
      handleResultEnter,
      query,
      scope,
      showLaunchpad,
      handleLaunchpadKeyDown,
    ],
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

  const previewTarget = ((): PreviewTarget | null => {
    if (showLaunchpad) {
      const item = launchpadItems[launchpadIndex];
      if (!item) return null;
      if (item.kind === "query") {
        return { kind: "query", value: item.value, top: search(item.value, getSearchIndex()).slice(0, 4) };
      }
      const index = getSearchIndex();
      return {
        kind: "module",
        module: item.module,
        count: item.count,
        total: index.length,
        entries: index.filter((entry) => entry.module === item.module).slice(0, 4),
      };
    }
    const result = results[selectedIndex];
    if (!result) return null;
    return {
      kind: "result",
      result,
      related: results
        .filter((other) => other.id !== result.id && other.module === result.module && other.section === result.section)
        .slice(0, 2),
    };
  })();

  const countLabel = (count: number) =>
    t(`search.entry_${getResultsPluralForm(count, locale)}`);

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
    <>
      {/* Page tint — fades in/out on the SAME `entered` morph (and same
          duration + easing) as the panel, so dim and panel move together.
          Portaled to <body> so it can sit below the nav (z-30) yet above the
          page. Only active when the caller asks for it (scrolled state). */}
      {createPortal(
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-foreground/25 backdrop-blur-[2px] motion-reduce:transition-none"
          style={{
            opacity: entered && tinted ? 1 : 0,
            pointerEvents: entered && tinted ? "auto" : "none",
            transition: `opacity ${MORPH_MS}ms ${MORPH_EASE}`,
          }}
        />,
        document.body,
      )}

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
          borderRadius: entered ? "0.875rem" : "1.5rem",
          boxShadow: entered
            ? "0 0 0 0.5px rgba(17,17,17,0.04), 0 24px 60px -24px rgba(40,20,25,0.32)"
            : "0 2px 8px rgba(17,17,17,0.07)",
          transition: `width ${MORPH_MS}ms ${MORPH_EASE}, border-radius ${MORPH_MS}ms ${MORPH_EASE}, box-shadow ${MORPH_MS}ms ${MORPH_EASE}`,
        }}
        ref={dialogRef}
        data-blok-testid="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.searchAriaLabel")}
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
          {scope && (
            <span
              className="mr-2 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary py-1 pl-2 pr-1 text-xs font-semibold text-foreground"
              data-blok-testid="search-scope"
            >
              <span className="flex [&_svg]:size-3.5">{moduleIcon(scope)}</span>
              {moduleTitle(scope)}
              <button
                type="button"
                className="flex size-4 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                onClick={() => {
                  setScope(null);
                  inputRef.current?.focus();
                }}
                aria-label={t("search.clearScope")}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                  <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          )}
          <input
            ref={inputRef}
            type="text"
            className="min-w-0 flex-1 rounded-md bg-transparent text-[15px] font-semibold tracking-[-0.01em] text-foreground caret-primary placeholder:font-semibold placeholder:text-foreground/55 outline-none"
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLaunchpadIndex(0);
            }}
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
            <div className="flex sm:h-[min(64vh,440px)]">
            <div
              ref={resultsRef}
              className={cn(
                "max-h-[64vh] w-full min-w-0 overflow-y-auto p-1.5",
                previewTarget && "sm:w-[248px] sm:shrink-0 sm:border-r sm:border-border",
              )}
            >
              {showLaunchpad ? (
                <LaunchpadList
                  items={launchpadItems}
                  activeIndex={launchpadIndex}
                  onPick={pickLaunchpadItem}
                  onHover={setLaunchpadIndex}
                />
              ) : results.length === 0 ? (
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
                        <Typo>{t("search.noResultsFor")}</Typo>{" "}
                        <span className="text-primary">
                          &ldquo;{query.trim()}&rdquo;
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        <Typo>{t("search.noResultsDescription")}</Typo>
                      </p>
                    </>
                  ) : null}
                </div>
              ) : (
                <div>
                  {results.map((result, index) => {
                    const showModuleHeader =
                      index === 0 ||
                      result.module !== results[index - 1].module;
                    const isSelected = index === selectedIndex;
                    const code = isCodeKind(result.kind);

                    return (
                      <div key={result.id}>
                        {showModuleHeader && (
                          <div className={GROUP_LABEL_CLASS} data-blok-testid="search-module-header">
                            {moduleTitle(result.module)}
                          </div>
                        )}
                        <Link
                          to={resultHref(result)}
                          className={ROW_CLASS}
                          data-selected={isSelected}
                          onClick={() => trackResultSelect(result, index)}
                          onMouseEnter={() => {
                            if (!isKeyboardNavMode) {
                              setSelectedIndex(index);
                            }
                          }}
                          data-search-result-index={index}
                          data-keyboard-nav={isKeyboardNavMode}
                        >
                          <span className="flex shrink-0 text-muted-foreground" data-kind={result.kind}>
                            <KindIcon kind={result.kind} size={14} />
                          </span>
                          <span className={cn("min-w-0 truncate", code && "font-mono text-[12px]")}>
                            {highlightMatch(code ? shortTitle(result.title) : result.title, query)}
                          </span>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <SearchPreview
              target={previewTarget}
              countLabel={countLabel}
              className="hidden sm:flex"
            />
            </div>

            <div className="flex h-[34px] items-center gap-3.5 border-t border-border px-3.5 text-[11.5px] text-muted-foreground/80">
              {results.length > 0 && (
                <span className="tabular-nums" data-blok-testid="search-results-count">
                  {results.length}{" "}
                  {t(`search.result_${getResultsPluralForm(results.length, locale)}`)}
                </span>
              )}
              <span className="flex-1" />
              <span className="flex items-center gap-1.5">
                <kbd className={KEYCAP_CLASS}>↑</kbd>
                <kbd className={KEYCAP_CLASS}>↓</kbd>
                {t("search.navigate")}
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className={KEYCAP_CLASS}>↵</kbd>
                {t("search.select")}
              </span>
              <span className="hidden items-center gap-1.5 sm:flex">
                <kbd className={KEYCAP_CLASS}>{t("search.escKey")}</kbd>
                {t("search.close")}
              </span>
            </div>
          </div>
        </div>
      </div>
      </div>
    </>
  );
};

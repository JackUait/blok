import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CategoryIcon } from "../common/CategoryIcon";
import { SectionReveal } from "../common/SectionReveal";
import { useI18n } from "../../contexts/I18nContext";
import { cn } from "@/lib/utils";

/** One of the inline panels the homepage can swap between. */
export type HomeView =
  | "getStarted"
  | "docs"
  | "tools"
  | "playground"
  | "migration"
  | "changelog";

interface Category {
  /** i18n key under home.categories, and the view it opens. */
  view: HomeView;
  /** CategoryIcon glyph name */
  icon: string;
}

export const HOME_CATEGORIES: Category[] = [
  { view: "getStarted", icon: "guide" },
  { view: "docs", icon: "page" },
  { view: "tools", icon: "tools" },
  { view: "playground", icon: "block" },
  { view: "migration", icon: "history" },
  { view: "changelog", icon: "events" },
];

interface CategoryBarProps {
  /** Currently open view. */
  activeView: HomeView;
  /** Open a view in place (no navigation). */
  onSelect: (view: HomeView) => void;
}

/**
 * Airbnb-style category strip: a horizontally scrollable row of icon + label
 * tabs. Instead of routing away, each tab swaps the panel rendered below it on
 * the homepage — mirroring Airbnb's category scroller under its search header.
 *
 * On narrow viewports the row overflows beyond the screen edge. Two affordances
 * keep that legible: edge fades that appear only on the side(s) with more tabs
 * to reveal, and auto-scrolling the active pill into view so the current view
 * is never stranded off-screen.
 */
export const CategoryBar: React.FC<CategoryBarProps> = ({ activeView, onSelect }) => {
  const { t } = useI18n();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const items = useMemo(
    () =>
      HOME_CATEGORIES.map((category) => ({
        ...category,
        label: t(`home.categories.${category.view}`),
        active: category.view === activeView,
      })),
    [t, activeView],
  );

  // Show a fade on a side only when there is scroll distance remaining there,
  // so the gradient reads as "more tabs this way" rather than fixed chrome.
  const syncEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setEdges({
      start: scrollLeft > 1,
      end: Math.ceil(scrollLeft + clientWidth) < scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    syncEdges();
    el.addEventListener("scroll", syncEdges, { passive: true });
    window.addEventListener("resize", syncEdges);
    return () => {
      el.removeEventListener("scroll", syncEdges);
      window.removeEventListener("resize", syncEdges);
    };
  }, [syncEdges, items.length]);

  // Keep the active pill in the visible window whenever the selection changes.
  useEffect(() => {
    const prefersReduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    activeRef.current?.scrollIntoView({
      behavior: prefersReduced ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [activeView]);

  return (
    <SectionReveal
      as="nav"
      y={10}
      blur={false}
      viewportMargin="0px"
      className="border-y border-border bg-background/80 backdrop-blur"
      aria-label={t("home.categories.label")}
      data-blok-testid="category-bar"
    >
      <div className="relative mx-auto w-full max-w-6xl">
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-background to-transparent transition-opacity duration-200",
            edges.start ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-background to-transparent transition-opacity duration-200",
            edges.end ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          ref={scrollerRef}
          className="flex snap-x scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 py-3 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => (
            <button
              key={item.view}
              ref={item.active ? activeRef : undefined}
              type="button"
              onClick={() => onSelect(item.view)}
              className={cn(
                "group flex shrink-0 snap-start cursor-pointer items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.97]",
                item.active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
              /**
               * The Playground tab mounts the Blok editor, whose bundled CSS leaks
               * globally and overrides the active utilities (`bg-foreground` etc.)
               * for the rest of the session. Pin the active colours inline so the
               * selected pill stays solid regardless of that leak.
               */
              style={
                item.active
                  ? {
                      backgroundColor: "var(--foreground)",
                      borderColor: "var(--foreground)",
                      color: "var(--background)",
                    }
                  : undefined
              }
              aria-pressed={item.active}
            >
              <span className="shrink-0" aria-hidden="true">
                <CategoryIcon category={item.icon} size={18} />
              </span>
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </SectionReveal>
  );
};

import { useMemo } from "react";
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
 */
export const CategoryBar: React.FC<CategoryBarProps> = ({ activeView, onSelect }) => {
  const { t } = useI18n();

  const items = useMemo(
    () =>
      HOME_CATEGORIES.map((category) => ({
        ...category,
        label: t(`home.categories.${category.view}`),
        active: category.view === activeView,
      })),
    [t, activeView],
  );

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
      <div className="mx-auto flex w-full max-w-6xl gap-2 overflow-x-auto px-6 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <button
            key={item.view}
            type="button"
            onClick={() => onSelect(item.view)}
            className={cn(
              "group flex shrink-0 cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all",
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
    </SectionReveal>
  );
};

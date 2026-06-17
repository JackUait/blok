import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { CategoryIcon } from "../common/CategoryIcon";
import { useI18n } from "../../contexts/I18nContext";
import { cn } from "@/lib/utils";

interface Category {
  /** i18n key under home.categories */
  key: string;
  /** destination route (may include a hash) */
  href: string;
  /** CategoryIcon glyph name */
  icon: string;
}

const CATEGORIES: Category[] = [
  { key: "getStarted", href: "/#quick-start", icon: "guide" },
  { key: "blocks", href: "/docs#blocks", icon: "blocks" },
  { key: "tools", href: "/tools", icon: "tools" },
  { key: "inlineTools", href: "/docs#inline-toolbar-api", icon: "inline" },
  { key: "api", href: "/docs#core", icon: "api" },
  { key: "events", href: "/docs#events", icon: "events" },
  { key: "migration", href: "/migration", icon: "history" },
];

/** Path portion of an href, ignoring any hash. */
const pathOf = (href: string): string => href.split("#")[0] || "/";

/**
 * Airbnb-style category strip: a horizontally scrollable row of icon + label
 * tabs that route into the main documentation areas. Sits directly beneath the
 * hero, mirroring Airbnb's category scroller under its search header.
 */
export const CategoryBar: React.FC = () => {
  const { t } = useI18n();
  const location = useLocation();

  const items = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        ...category,
        label: t(`home.categories.${category.key}`),
        active: pathOf(category.href) === location.pathname,
      })),
    [t, location.pathname],
  );

  return (
    <nav
      className="border-y border-border bg-background/80 backdrop-blur"
      aria-label={t("home.categories.label")}
      data-blok-testid="category-bar"
    >
      <div className="mx-auto flex w-full max-w-6xl gap-2 overflow-x-auto px-6 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <Link
            key={item.key}
            to={item.href}
            className={cn(
              "group flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all",
              item.active
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
            aria-current={item.active ? "page" : undefined}
          >
            <span className="shrink-0" aria-hidden="true">
              <CategoryIcon category={item.icon} size={18} />
            </span>
            <span className="whitespace-nowrap">{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
};

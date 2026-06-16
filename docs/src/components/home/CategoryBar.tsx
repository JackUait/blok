import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { CategoryIcon } from "../common/CategoryIcon";
import { useI18n } from "../../contexts/I18nContext";

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
  { key: "recipes", href: "/recipes", icon: "page" },
  { key: "integrations", href: "/integrations", icon: "config" },
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
      className="category-bar"
      aria-label={t("home.categories.label")}
      data-blok-testid="category-bar"
    >
      <div className="category-bar-track">
        {items.map((item) => (
          <Link
            key={item.key}
            to={item.href}
            className={`category-tab${item.active ? " category-tab--active" : ""}`}
            aria-current={item.active ? "page" : undefined}
          >
            <span className="category-tab-icon" aria-hidden="true">
              <CategoryIcon category={item.icon} size={22} />
            </span>
            <span className="category-tab-label">{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
};

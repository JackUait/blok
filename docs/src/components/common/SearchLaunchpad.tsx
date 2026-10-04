import { useEffect, useState } from "react";
import { ModuleIcon } from "./ModuleIcon";
import { GROUP_TITLES_EN } from "../api/api-nav";
import { SECTION_ICONS } from "../api/section-icons";
import { useI18n } from "../../contexts/I18nContext";
import { cn } from "@/lib/utils";

export interface ModuleTile {
  module: string;
  count: number;
}

export type LaunchpadItem =
  | { kind: "query"; value: string }
  | { kind: "module"; module: string; count: number };

interface SearchLaunchpadProps {
  items: LaunchpadItem[];
  activeIndex: number;
  countLabel: (count: number) => string;
  onPick: (item: LaunchpadItem) => void;
}

// Index modules are sidebar group titles; reuse the sidebar's icon for each.
const GROUP_KEY_BY_TITLE = new Map(
  Object.entries(GROUP_TITLES_EN).map(([key, title]) => [title, key]),
);

export const moduleIcon = (module: string): React.ReactNode => {
  const key = GROUP_KEY_BY_TITLE.get(module);
  return (key && SECTION_ICONS[key]) || <ModuleIcon module={module} size={17} />;
};

/** Index modules are English group titles; this shows them in the reader's language. */
export const useModuleTitle = (): ((module: string) => string) => {
  const { t } = useI18n();
  return (module) => {
    const key = GROUP_KEY_BY_TITLE.get(module);
    return key ? t(`api.sections.${key}`) : module;
  };
};

// Delay before the first chip/tile rises, so content lands after the panel opens.
const RISE_BASE_MS = 80;
const RISE_STEP_MS = 28;

const SECTION_LABEL_CLASS =
  "px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70";

export const SearchLaunchpad: React.FC<SearchLaunchpadProps> = ({
  items,
  activeIndex,
  countLabel,
  onPick,
}) => {
  const { t } = useI18n();
  const moduleTitle = useModuleTitle();
  const tiles = items.filter((item) => item.kind === "module");

  // Indices are shared with keyboard navigation, so chips and tiles are
  // rendered from one flat list in one order.
  const renderItem = (item: LaunchpadItem, index: number) => {
    const selected = index === activeIndex;
    const style = { animationDelay: `${RISE_BASE_MS + index * RISE_STEP_MS}ms` };

    if (item.kind === "query") {
      return (
        <button
          key={`q-${item.value}`}
          type="button"
          data-blok-testid="search-suggestion"
          data-selected={selected}
          onClick={() => onPick(item)}
          style={style}
          className={cn(
            "search-rise inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-mono text-[12.5px] font-medium text-foreground transition-colors",
            selected ? "bg-secondary" : "bg-card hover:bg-secondary/60",
          )}
        >
          {item.value}
        </button>
      );
    }

    // Each tile takes its own stop along the brand sunrise (rose → orange).
    const position = tiles.length > 1 ? tiles.indexOf(item) / (tiles.length - 1) : 0;
    const hue = `color-mix(in srgb, var(--brand-from) ${Math.round((1 - position) * 100)}%, var(--brand-to))`;

    return (
      <button
        key={`m-${item.module}`}
        type="button"
        data-blok-testid="search-module-tile"
        data-module={item.module}
        data-selected={selected}
        onClick={() => onPick(item)}
        style={{ ...style, ["--tile-hue" as string]: hue }}
        className={cn(
          "search-rise search-tile group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-border p-2.5 text-left text-foreground transition-colors",
          selected ? "bg-secondary" : "bg-card hover:bg-secondary/60",
        )}
      >
        <span className="search-tile-icon flex size-8 shrink-0 items-center justify-center rounded-lg">
          {moduleIcon(item.module)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="line-clamp-2 hyphens-auto text-[13px] font-semibold leading-[1.2] [overflow-wrap:anywhere]">
            {moduleTitle(item.module)}
          </span>
          <span className="text-[11.5px] tabular-nums text-muted-foreground">
            {item.count} {countLabel(item.count)}
          </span>
        </span>
      </button>
    );
  };

  const chipItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === "query");
  const tileItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === "module");

  return (
    <div className="px-1.5 pb-2 pt-2.5" data-blok-testid="search-launchpad">
      <div className={SECTION_LABEL_CLASS}>{t("search.try")}</div>
      <div className="flex flex-wrap gap-1.5 px-1.5">
        {chipItems.map(({ item, index }) => renderItem(item, index))}
      </div>
      <div className={cn(SECTION_LABEL_CLASS, "mt-4")}>{t("search.browse")}</div>
      <div className="grid grid-cols-2 gap-2 px-1.5 sm:grid-cols-3">
        {tileItems.map(({ item, index }) => renderItem(item, index))}
      </div>
    </div>
  );
};

const GHOST_START_MS = 600;
const GHOST_TYPE_MS = 75;
const GHOST_DELETE_MS = 32;
const GHOST_HOLD_MS = 1500;
const GHOST_GAP_MS = 350;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Types and erases each phrase in turn. Returns null when not running
 * (inactive, or the user prefers reduced motion), so callers can drop the
 * ghost entirely and fall back to the real placeholder.
 */
export const useGhostTyping = (
  phrases: readonly string[],
  active: boolean,
): string | null => {
  const [reducedMotion] = useState(prefersReducedMotion);
  const enabled = active && !reducedMotion && phrases.length > 0;
  const [text, setText] = useState("");

  useEffect(() => {
    if (!enabled) {
      setText("");
      return;
    }

    let phrase = 0;
    let length = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const word = phrases[phrase];

      if (!deleting) {
        length += 1;
        setText(word.slice(0, length));
        deleting = length >= word.length;
        timer = setTimeout(tick, deleting ? GHOST_HOLD_MS : GHOST_TYPE_MS);
        return;
      }

      length -= 1;
      setText(word.slice(0, length));
      if (length > 0) {
        timer = setTimeout(tick, GHOST_DELETE_MS);
        return;
      }
      deleting = false;
      phrase = (phrase + 1) % phrases.length;
      timer = setTimeout(tick, GHOST_GAP_MS);
    };

    timer = setTimeout(tick, GHOST_START_MS);
    return () => clearTimeout(timer);
  }, [enabled, phrases]);

  return enabled ? text : null;
};

import { ModuleIcon } from "./ModuleIcon";
import { GROUP_TITLES_EN } from "../api/api-nav";
import { SECTION_ICONS } from "../api/section-icons";
import { useI18n } from "../../contexts/I18nContext";
import { cn } from "@/lib/utils";
import type { SearchIndexItem, SearchResult } from "@/types/search";

export type LaunchpadItem =
  | { kind: "query"; value: string }
  | { kind: "module"; module: string; count: number };

/** What the preview pane describes: a launchpad item or a search result. */
export type PreviewTarget =
  | { kind: "query"; value: string; top: SearchResult[] }
  | { kind: "module"; module: string; count: number; total: number; entries: SearchIndexItem[] }
  | { kind: "result"; result: SearchResult; related: SearchResult[] };

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

/** Methods, properties and options are code; pages and sections are prose. */
export const isCodeKind = (kind: SearchResult["kind"]): boolean =>
  kind === "method" || kind === "property" || kind === "option";

/** "blocks.insert(type?, data?)" → "blocks.insert()" for a one-line list row. */
export const shortTitle = (title: string): string => {
  const paren = title.indexOf("(");
  return paren === -1 ? title : `${title.slice(0, paren)}()`;
};

export const GROUP_LABEL_CLASS =
  "px-2 pb-1 pt-2.5 text-[10.5px] font-semibold tracking-[0.02em] text-muted-foreground/70";

// The selected row shows ↵ at its end. It is drawn with ::after so it never
// joins the row's text or accessible name (a suggestion's text is its query).
export const ROW_CLASS =
  "flex h-[30px] w-full cursor-pointer items-center gap-2.5 rounded-[7px] px-2 text-left text-[13px] text-foreground data-[selected=true]:bg-secondary data-[selected=true]:after:ml-auto data-[selected=true]:after:pl-2 data-[selected=true]:after:font-mono data-[selected=true]:after:text-[11px] data-[selected=true]:after:text-muted-foreground data-[selected=true]:after:content-['↵']";

interface LaunchpadListProps {
  items: LaunchpadItem[];
  activeIndex: number;
  onPick: (item: LaunchpadItem) => void;
  onHover: (index: number) => void;
}

export const LaunchpadList: React.FC<LaunchpadListProps> = ({
  items,
  activeIndex,
  onPick,
  onHover,
}) => {
  const { t } = useI18n();
  const moduleTitle = useModuleTitle();
  const firstModule = items.findIndex((item) => item.kind === "module");

  return (
    <div data-blok-testid="search-launchpad">
      {items.map((item, index) => {
        const selected = index === activeIndex;
        const common = {
          type: "button" as const,
          "data-selected": selected,
          onClick: () => onPick(item),
          onMouseEnter: () => onHover(index),
          className: ROW_CLASS,
        };

        return (
          <div key={item.kind === "query" ? `q-${item.value}` : `m-${item.module}`}>
            {index === 0 && <div className={GROUP_LABEL_CLASS}>{t("search.suggested")}</div>}
            {index === firstModule && <div className={GROUP_LABEL_CLASS}>{t("search.sections")}</div>}
            {item.kind === "query" ? (
              <button {...common} data-blok-testid="search-suggestion">
                <svg aria-hidden="true" className="shrink-0 text-muted-foreground" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </svg>
                <span className="truncate font-mono text-[12px]">{item.value}</span>
              </button>
            ) : (
              <button {...common} data-blok-testid="search-module-tile" data-module={item.module}>
                <span className="flex shrink-0 text-muted-foreground [&_svg]:size-[15px]">
                  {moduleIcon(item.module)}
                </span>
                <span className="truncate">{moduleTitle(item.module)}</span>
                {!selected && (
                  <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground/70">
                    {item.count}
                  </span>
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

const KEYCAP =
  "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-b-2 border-border bg-secondary px-1 font-mono text-[10.5px] text-muted-foreground";

const Signature: React.FC<{ title: string }> = ({ title }) => {
  const paren = title.indexOf("(");
  if (paren === -1) return <span className="font-semibold text-foreground">{title}</span>;

  return (
    <>
      <span className="font-semibold text-foreground">{title.slice(0, paren)}</span>
      <span className="text-muted-foreground">(</span>
      <span className="text-primary">{title.slice(paren + 1, title.lastIndexOf(")"))}</span>
      <span className="text-muted-foreground">)</span>
    </>
  );
};

interface PreviewRow {
  id: string;
  label: string;
  title: string;
  code: boolean;
}

/** Rows in the preview are plain text, never links: results stay the only anchors. */
const PreviewRows: React.FC<{ rows: PreviewRow[] }> = ({ rows }) => (
  <div className="flex flex-col border-t border-border">
    {rows.map((row) => (
      <div key={row.id} className="flex items-baseline gap-2.5 border-b border-border py-[7px]">
        <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70">
          {row.label}
        </span>
        <span className={cn("min-w-0 truncate", row.code ? "font-mono text-[12px]" : "text-[12.5px]")}>
          {row.title}
        </span>
      </div>
    ))}
  </div>
);

const targetKey = (target: PreviewTarget): string =>
  target.kind === "result"
    ? `r:${target.result.id}`
    : target.kind === "module"
      ? `m:${target.module}`
      : `q:${target.value}`;

interface SearchPreviewProps {
  target: PreviewTarget | null;
  countLabel: (count: number) => string;
  className?: string;
}

export const SearchPreview: React.FC<SearchPreviewProps> = ({ target, countLabel, className }) => {
  const { t } = useI18n();
  const moduleTitle = useModuleTitle();
  if (!target) return null;

  const kindLabel = (kind: SearchResult["kind"]) => t(`search.kind.${kind}`);
  const toRow = (item: SearchIndexItem | SearchResult): PreviewRow => ({
    id: item.id,
    label: kindLabel(item.kind),
    title: isCodeKind(item.kind) ? shortTitle(item.title) : item.title,
    code: isCodeKind(item.kind),
  });

  let crumb: React.ReactNode;
  let body: React.ReactNode;
  let action: string;

  if (target.kind === "module") {
    crumb = (
      <>
        <span className="flex [&_svg]:size-[13px]">{moduleIcon(target.module)}</span>
        {kindLabel("section")}
      </>
    );
    action = t("search.browseSection");
    body = (
      <>
        <h3 className="text-[19px] font-bold tracking-[-0.02em]">{moduleTitle(target.module)}</h3>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {target.count} {countLabel(target.count)}
          </span>
          {/* Share of the whole index. */}
          <span aria-hidden="true" className="relative h-0.5 overflow-hidden rounded-full bg-border">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-primary"
              style={{ width: `${(target.count / target.total) * 100}%` }}
            />
          </span>
        </div>
        <PreviewRows rows={target.entries.map(toRow)} />
      </>
    );
  } else if (target.kind === "query") {
    crumb = t("search.suggested");
    action = t("search.searchAction");
    body = (
      <>
        <h3 className="font-mono text-[17px] font-semibold tracking-[-0.01em]">{target.value}</h3>
        <PreviewRows rows={target.top.map(toRow)} />
      </>
    );
  } else {
    const { result } = target;
    crumb = (
      <>
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
        <span className="truncate">
          {kindLabel(result.kind)} · {moduleTitle(result.module)}
          {result.section && <> › {result.section}</>}
        </span>
      </>
    );
    action = t("search.open");
    body = (
      <>
        {isCodeKind(result.kind) ? (
          <div className="overflow-x-auto whitespace-nowrap rounded-lg bg-secondary px-3 py-2.5 font-mono text-[12.5px] leading-relaxed">
            <Signature title={result.title} />
          </div>
        ) : (
          <h3 className="text-[19px] font-bold tracking-[-0.02em]">{result.title}</h3>
        )}
        {result.description && (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{result.description}</p>
        )}
        {target.related.length > 0 && (
          <PreviewRows rows={target.related.map((item) => ({ ...toRow(item), label: t("search.also") }))} />
        )}
      </>
    );
  }

  return (
    <div
      data-blok-testid="search-preview"
      className={cn("min-w-0 flex-1 flex-col overflow-y-auto px-5 py-4", className)}
    >
      {/* Keyed by target so the pane crossfades as the selection moves. */}
      <div key={targetKey(target)} className="search-fade flex min-h-full flex-col gap-3.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground/80">{crumb}</div>
        {body}
        <div className="mt-auto flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
          <kbd className={KEYCAP}>↵</kbd>
          {action}
        </div>
      </div>
    </div>
  );
};

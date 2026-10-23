import { IconArrowDiagonal, IconCross, IconTable, IconTemplates } from '../../components/icons';
import { openModalDialog } from '../../components/utils/modal-dialog';

export interface GalleryTemplate {
  id: string;
  name: string;
  description: string;
  /** The glyph drawn on the preview's title line. */
  icon: string;
  tint: string;
  /** Column names, then option pills drawn in column `pillColumn` (a board's groups without columns). */
  columns: string[];
  /** `dot`: a status pill, drawn with Notion's leading dot. */
  pills: Array<{ label: string; color: string; dot?: boolean }>;
  pillColumn?: number;
}

export interface TemplateGalleryOptions {
  t: (key: string, vars?: Record<string, string>) => string;
  templates: GalleryTemplate[];
  /** The document's other databases, under "Existing data sources". */
  sources: Array<{ id: string; title: string; parent: string }>;
  onEmpty: () => void;
  onSource: (id: string) => void;
  onTemplate: (id: string) => void;
  directionSource?: Element | null;
}

/** research/27 §1e: six templates, then "More templates"; research/27 shot 07: four sources, then "Show more". */
const FIRST_TEMPLATES = 6;
const FIRST_SOURCES = 4;

const counter = { next: 0 };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attribute: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);

  node.setAttribute(attribute, '');
  if (text !== undefined) node.textContent = text;

  return node;
};

const glyph = (svg: string): HTMLElement => {
  const icon = el('span', 'data-blok-database-tpl-gallery-glyph');

  icon.setAttribute('aria-hidden', 'true');
  // Blok's own icon constants, never user text.
  icon.innerHTML = svg;

  return icon;
};

/** The small preview under a card's text: a title line, column names, then three skeleton rows. */
const thumbnail = (title: string, icon: string, columns: string[], pills: GalleryTemplate['pills'], pillColumn?: number): HTMLElement => {
  const box = el('div', 'data-blok-database-tpl-gallery-thumb');
  const heading = el('div', 'data-blok-database-tpl-gallery-thumb-title');
  const pill = (option: GalleryTemplate['pills'][number]): HTMLElement => {
    const node = el('span', 'data-blok-database-tpl-gallery-pill', option.label);

    node.setAttribute('data-color', option.color);
    if (option.dot === true) node.setAttribute('data-dot', '');

    return node;
  };
  const bar = (): HTMLElement => el('span', 'data-blok-database-tpl-gallery-bar');

  box.setAttribute('aria-hidden', 'true');
  heading.append(glyph(icon), document.createTextNode(title));
  box.appendChild(heading);
  if (columns.length === 0) {
    // A board: its groups head the columns, with skeleton cards under them.
    const board = el('div', 'data-blok-database-tpl-gallery-thumb-board');

    board.append(...pills.map((option) => {
      const column = el('div', 'data-blok-database-tpl-gallery-thumb-column');

      column.append(pill(option), el('span', 'data-blok-database-tpl-gallery-card-bar'));

      return column;
    }));
    box.appendChild(board);

    return box;
  }
  const head = el('div', 'data-blok-database-tpl-gallery-thumb-head');

  head.append(...columns.map((name) => el('span', 'data-blok-database-tpl-gallery-thumb-cell', name)));
  box.appendChild(head);
  box.append(...[0, 1, 2].map((index) => {
    const row = el('div', 'data-blok-database-tpl-gallery-thumb-row');
    const option = pills[index];

    row.append(...columns.map((_, column) => {
      const cell = el('span', 'data-blok-database-tpl-gallery-thumb-cell');

      cell.appendChild(column === pillColumn && option !== undefined ? pill(option) : bar());

      return cell;
    }));

    return row;
  }));

  return box;
};

/**
 * Notion's "More templates" modal (research/26 §2, research/27 §1e): a
 * search, "Empty database", the document's databases and the templates.
 * A pick closes it and reports what was picked; close and Escape pick nothing.
 * Notion's search and its "More in Marketplace" were not measured or built.
 */
export const openTemplateGallery = (options: TemplateGalleryOptions): { close: () => void } => {
  const { t } = options;
  const backdrop = el('div', 'data-blok-database-starter-backdrop');
  const surface = el('div', 'data-blok-database-tpl-gallery');
  const header = el('div', 'data-blok-database-tpl-gallery-header');
  const close = el('button', 'data-blok-database-tpl-gallery-close');
  const search = el('input', 'data-blok-database-tpl-gallery-search');
  const body = el('div', 'data-blok-database-tpl-gallery-body');
  const column = el('div', 'data-blok-database-tpl-gallery-column');
  const state = { query: '', allSources: false, allTemplates: false };

  counter.next += 1;
  backdrop.setAttribute('data-blok-popover', '');
  surface.setAttribute('data-blok-testid', 'database-template-gallery');
  close.type = 'button';
  close.innerHTML = IconCross;
  close.setAttribute('aria-label', t('tools.database.close'));
  close.setAttribute('data-blok-testid', 'database-template-gallery-close');
  search.type = 'text';
  search.id = `blok-database-gallery-search-${counter.next}`;
  search.placeholder = t('tools.database.searchLabel');
  search.setAttribute('aria-label', t('tools.database.searchLabel'));
  search.setAttribute('data-blok-testid', 'database-template-gallery-search');
  header.append(close, search);

  const settled = { done: false };
  const finish = (then?: () => void): void => {
    if (settled.done) return;
    settled.done = true;
    handle.close();
    then?.();
  };
  const matches = (name: string): boolean => name.toLowerCase().includes(state.query.trim().toLowerCase());

  const empty = el('button', 'data-blok-database-tpl-gallery-empty');

  empty.type = 'button';
  empty.setAttribute('data-blok-testid', 'database-template-gallery-empty');
  empty.append(glyph(IconTable), el('span', 'data-blok-database-tpl-gallery-empty-label', t('tools.database.starterEmptyDatabase')));
  empty.addEventListener('click', () => finish(options.onEmpty));

  const section = (label: string, icon?: string): HTMLElement => {
    const node = el('div', 'data-blok-database-tpl-gallery-section');

    if (icon !== undefined) node.appendChild(glyph(icon));
    node.appendChild(document.createTextNode(label));

    return node;
  };
  const sourceLabel = section(t('tools.database.layoutExistingDataSources'), IconArrowDiagonal);
  const sourceGrid = el('div', 'data-blok-database-tpl-gallery-grid');
  const sourceCards = options.sources.map((source) => {
    const card = el('button', 'data-blok-database-tpl-gallery-card');
    const title = source.title === '' ? t('tools.database.relationUntitledDatabase') : source.title;

    card.type = 'button';
    card.setAttribute('data-blok-testid', `database-template-gallery-source-${source.id}`);
    card.setAttribute('data-blok-database-tpl-gallery-source', '');
    card.append(
      el('span', 'data-blok-database-tpl-gallery-card-title', title),
      el('span', 'data-blok-database-tpl-gallery-card-text', source.parent),
      thumbnail(title, IconTable, [], [])
    );
    card.addEventListener('click', () => finish(() => options.onSource(source.id)));

    return { card, title };
  });
  const showMore = el('button', 'data-blok-database-tpl-gallery-link', t('tools.database.linkedShowMore'));

  showMore.type = 'button';
  showMore.setAttribute('data-blok-testid', 'database-template-gallery-show-more');
  showMore.addEventListener('click', () => {
    state.allSources = true;
    draw();
  });

  const templateLabel = section(t('tools.database.templateMenuLabel'), IconTemplates);
  const templateGrid = el('div', 'data-blok-database-tpl-gallery-grid');
  const templateCards = options.templates.map((item) => {
    const card = el('button', 'data-blok-database-tpl-gallery-card');

    card.type = 'button';
    card.setAttribute('data-blok-testid', `database-template-gallery-template-${item.id}`);
    card.setAttribute('data-tint', item.tint);
    card.append(
      el('span', 'data-blok-database-tpl-gallery-card-title', item.name),
      el('span', 'data-blok-database-tpl-gallery-card-text', item.description),
      thumbnail(item.name, item.icon, item.columns, item.pills, item.pillColumn)
    );
    card.addEventListener('click', () => finish(() => options.onTemplate(item.id)));

    return { card, title: item.name };
  });
  const more = el('button', 'data-blok-database-tpl-gallery-link', t('tools.database.starterMoreTemplates'));

  more.type = 'button';
  more.setAttribute('data-blok-testid', 'database-template-gallery-more');
  more.addEventListener('click', () => {
    state.allTemplates = true;
    draw();
  });

  sourceGrid.append(...sourceCards.map((entry) => entry.card));
  templateGrid.append(...templateCards.map((entry) => entry.card));

  /** Shows the matching cards; the caps apply only without a query (Blok choice). */
  const fit = (cards: Array<{ card: HTMLElement; title: string }>, cap: number, all: boolean): { shown: number; capped: boolean } => {
    const searching = state.query.trim() !== '';
    const counts = { shown: 0, matched: 0 };

    for (const { card, title } of cards) {
      const hit = matches(title);

      if (hit) counts.matched += 1;
      card.hidden = !hit || (!searching && !all && counts.matched > cap);
      if (!card.hidden) counts.shown += 1;
    }

    return { shown: counts.shown, capped: counts.shown < counts.matched };
  };

  const draw = (): void => {
    const sources = fit(sourceCards, FIRST_SOURCES, state.allSources);
    const templates = fit(templateCards, FIRST_TEMPLATES, state.allTemplates);
    const parts: HTMLElement[] = [empty];

    if (sources.shown > 0) parts.push(sourceLabel, sourceGrid, ...(sources.capped ? [showMore] : []));
    if (templates.shown > 0) parts.push(templateLabel, templateGrid, ...(templates.capped ? [more] : []));
    column.replaceChildren(...parts);
  };

  search.addEventListener('input', () => {
    state.query = search.value;
    draw();
  });
  close.addEventListener('click', () => finish());
  body.appendChild(column);
  surface.append(header, body);
  backdrop.appendChild(surface);
  draw();

  const handle = openModalDialog({
    content: backdrop,
    surface,
    role: 'dialog',
    label: t('tools.database.starterMoreTemplates'),
    initialFocus: () => search,
    directionSource: options.directionSource ?? null,
    onDismiss: () => finish(),
  });

  return { close: () => finish() };
};

import type { I18n } from '../../../types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from './types';
import { renderCellValue } from './cells';
import { formatDateDisplay } from './cells/date-format';
import type { BodyBlock } from './row-body';
import { resolveViewProperties } from './view-settings';
import { htmlToPlainText } from '../../components/utils/plain-text';
import { safeImageSrc } from '../../components/utils/sanitize-url';

/** A host's footer for one card: comments, reactions (Tier 3, D6). Returns its cleanup. */
export type FeedFooter = (context: { rowId: string; holder: HTMLElement }) => (() => void) | void;

export interface FeedViewOptions {
  view: DatabaseViewConfig;
  /** Localized schema. */
  schema: PropertyDefinition[];
  rows: DatabaseRow[];
  /** Rows the view holds; more than `rows` shows "Load more". */
  total: number;
  titlePropertyId: string;
  i18n: Pick<I18n, 't'>;
  locale: string;
  bodyOf: (rowId: string) => BodyBlock[];
  personName?: (id: string) => string | undefined;
  handlers: {
    openRow: (rowId: string) => void;
    loadMore: () => void;
  };
  footer?: FeedFooter;
}

const field = (data: unknown, key: string): unknown =>
  typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[key] : undefined;

/** Block text, never parsed into the live DOM: HTML through an inert parse, segments as text. */
const textOf = (data: unknown): string => {
  const text = field(data, 'text');

  if (typeof text === 'string') return htmlToPlainText(text).trim();
  if (Array.isArray(text)) {
    return text.map((segment) => {
      const part = field(segment, 'text');

      return typeof part === 'string' ? part : '';
    }).join('').trim();
  }

  return '';
};

const levelOf = (block: BodyBlock): string => {
  const level = field(block.data, 'level');

  if (block.type !== 'header' || typeof level !== 'number') return 'text';

  if (level <= 1) return 'h1';

  return level === 2 ? 'h2' : 'h3';
};

/**
 * Notion's feed (research/03 §9): one card per row, stacked, showing the
 * row's page content and its visible properties. Card look measured in
 * research/08. Read-only: the page itself is edited in the row page.
 */
export class DatabaseFeedView implements DatabaseViewRenderer {
  private readonly options: FeedViewOptions;
  private readonly cleanups: Array<() => void> = [];

  constructor(options: FeedViewOptions) {
    this.options = options;
  }

  createView(): HTMLDivElement {
    const feed = document.createElement('div');

    feed.setAttribute('data-blok-database-feed', '');
    feed.setAttribute('role', 'list');
    for (const row of this.options.rows) {
      feed.appendChild(this.createCard(row));
    }
    if (this.options.total > this.options.rows.length) {
      const more = document.createElement('button');

      more.type = 'button';
      more.setAttribute('data-blok-database-feed-more', '');
      more.textContent = this.options.i18n.t('tools.database.galleryLoadMore');
      more.addEventListener('click', () => this.options.handlers.loadMore());
      feed.appendChild(more);
    }

    return feed;
  }

  appendRow(container: HTMLElement, row: DatabaseRow): void {
    container.appendChild(this.createCard(row));
  }

  removeRow(wrapper: HTMLElement, rowId: string): void {
    wrapper.querySelector(`[data-blok-database-feed-card][data-row-id="${CSS.escape(rowId)}"]`)?.remove();
  }

  updateRowTitle(wrapper: HTMLElement, rowId: string, title: string): void {
    const el = wrapper.querySelector(`[data-blok-database-feed-card][data-row-id="${CSS.escape(rowId)}"] [data-blok-database-feed-title]`);

    if (el !== null) el.textContent = title;
  }

  destroy(): void {
    this.cleanups.splice(0).forEach((cleanup) => cleanup());
  }

  private createCard(row: DatabaseRow): HTMLElement {
    const card = document.createElement('article');
    const title = row.properties[this.options.titlePropertyId];
    const text = typeof title === 'string' ? title : '';

    card.setAttribute('data-blok-database-feed-card', '');
    card.setAttribute('data-row-id', row.id);
    card.setAttribute('role', 'listitem');

    const byline = this.createByline(row);

    if (byline !== null) card.appendChild(byline);

    const titleEl = document.createElement('button');

    titleEl.type = 'button';
    titleEl.setAttribute('data-blok-database-feed-title', '');
    titleEl.textContent = text;
    if (text === '') titleEl.setAttribute('data-placeholder', this.options.i18n.t('tools.database.cardTitlePlaceholder'));
    titleEl.addEventListener('click', () => this.options.handlers.openRow(row.id));
    card.appendChild(titleEl);

    const properties = this.createProperties(row);

    if (properties.childElementCount > 0) card.appendChild(properties);

    const body = this.createBody(row.id);

    if (body.childElementCount > 0) card.appendChild(body);
    if (this.options.footer !== undefined) {
      const holder = document.createElement('div');

      holder.setAttribute('data-blok-database-feed-footer', '');
      card.appendChild(holder);
      const cleanup = this.options.footer({ rowId: row.id, holder });

      if (typeof cleanup === 'function') this.cleanups.push(cleanup);
    }

    return card;
  }

  /** Notion shows the author and when the page was made by default (research/08). */
  private createByline(row: DatabaseRow): HTMLElement | null {
    const author = row.meta?.createdBy;

    if (author === undefined) return null;
    const byline = document.createElement('div');
    const name = document.createElement('span');

    byline.setAttribute('data-blok-database-feed-byline', '');
    name.setAttribute('data-blok-database-feed-author', '');
    name.textContent = this.options.personName?.(author) ?? author;
    byline.appendChild(name);
    const at = row.meta?.createdAt;

    if (at !== undefined) {
      const time = document.createElement('span');

      time.setAttribute('data-blok-database-feed-time', '');
      time.textContent = formatDateDisplay(new Date(at).toISOString(), this.options.locale, { dateFormat: 'relative', timeFormat: 'hidden' }) ?? '';
      byline.appendChild(time);
    }

    return byline;
  }

  private createProperties(row: DatabaseRow): HTMLElement {
    const list = document.createElement('div');

    list.setAttribute('data-blok-database-feed-properties', '');
    for (const setting of resolveViewProperties(this.options.view, this.options.schema)) {
      const property = this.options.schema.find((p) => p.id === setting.id);

      if (!setting.visible || property === undefined || property.id === this.options.titlePropertyId) continue;
      const cell = renderCellValue(property, row.properties[property.id], { i18n: this.options.i18n, readOnly: true, locale: this.options.locale });

      if (cell.hasAttribute('data-empty')) continue;
      const item = document.createElement('div');

      item.setAttribute('data-blok-database-feed-property', '');
      item.setAttribute('data-property-id', property.id);
      item.title = property.name;
      item.appendChild(cell);
      list.appendChild(item);
    }

    return list;
  }

  private appendImage(body: HTMLElement, url: unknown): void {
    const src = typeof url === 'string' ? safeImageSrc(url) : null;

    if (src === null) return;
    const img = document.createElement('img');

    img.setAttribute('data-blok-database-feed-image', '');
    img.alt = '';
    img.loading = 'lazy';
    img.src = src;
    body.appendChild(img);
  }

  /** The page content as read-only text and images. Other block kinds show their text only. */
  private createBody(rowId: string): HTMLElement {
    const body = document.createElement('div');

    body.setAttribute('data-blok-database-feed-body', '');
    for (const block of this.options.bodyOf(rowId)) {
      if (block.type === 'image') {
        this.appendImage(body, field(block.data, 'url'));
        continue;
      }
      const text = textOf(block.data);

      if (text === '') continue;
      const line = document.createElement('div');

      line.setAttribute('data-blok-database-feed-line', '');
      line.setAttribute('data-level', levelOf(block));
      line.textContent = text;
      body.appendChild(line);
    }

    return body;
  }
}

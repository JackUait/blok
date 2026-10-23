import type { I18n } from '../../../types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition, RowReactions } from './types';
import { renderCellValue } from './cells';
import { formatRelativeStamp } from './cells/date-format';
import type { BodyBlock } from './row-body';
import { resolveViewProperties } from './view-settings';
import { pageIconElement, showsPageIcon } from './page-icon';
import { htmlToPlainText } from '../../components/utils/plain-text';
import { safeImageSrc } from '../../components/utils/sanitize-url';
import { onHover } from '../../components/utils/tooltip';
import { onPropertyHover } from './property-hint';
import { IconDotsHorizontal, IconEmojiSmile, IconPlus } from '../../components/icons';

/** A host's footer for one card: comments, reactions (Tier 3, D6). Returns its cleanup. */
export type FeedFooter = (context: { rowId: string; holder: HTMLElement }) => (() => void) | void;

/** Built-in reactions (research/19 §2c). Without `toggle` and `pick` they show but cannot change. */
export interface FeedReactions {
  /** The viewer's user id. */
  me?: string;
  toggle?: (rowId: string, emoji: string) => void;
  pick?: (rowId: string, anchor: HTMLElement) => void;
}

interface ReactionPill {
  emoji: string;
  /** User ids, in the order they reacted. */
  users: string[];
}

/**
 * One pill per emoji. Peers can hold the map's keys in different orders, so
 * order comes from the reaction times, with the ids breaking ties.
 */
export const reactionPills = (reactions: RowReactions | undefined): ReactionPill[] => {
  const entries = Object.entries(reactions ?? {}).flatMap(([userId, own]) => Object.entries(own)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([emoji, at]) => ({ userId, emoji, at })));
  const byTime = (a: { at: number; key: string }, b: { at: number; key: string }): number => a.at - b.at || Number(a.key > b.key) - Number(a.key < b.key);
  const first = new Map<string, number>();

  entries.forEach(({ emoji, at }) => first.set(emoji, Math.min(first.get(emoji) ?? at, at)));

  return Array.from(first.entries())
    .map(([emoji, at]) => ({ emoji, at, key: emoji }))
    .sort(byTime)
    .map(({ emoji }) => ({
      emoji,
      users: entries.filter((entry) => entry.emoji === emoji).map((entry) => ({ at: entry.at, key: entry.userId })).sort(byTime).map((entry) => entry.key),
    }));
};

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
    /** Adds a post. Without it an empty feed shows no "New page" tile. */
    addRow?: () => void;
  };
  footer?: FeedFooter;
  /** Built-in reactions. Not drawn when the host owns the footer. */
  reactions?: FeedReactions;
  /** Built-in comments: a card's comment box, or null for none. Not drawn when the host owns the footer. */
  comments?: (rowId: string) => HTMLElement | null;
  /** The card's "More actions" menu. */
  actions?: (rowId: string, anchor: HTMLElement, card: HTMLElement) => void;
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
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** research/36 §10: Notion re-reads every byline age on a 30 s tick. */
const AGE_TICK_MS = 30_000;

/**
 * research/36 §10: "Just now" under a minute, then "1m" … "59m", then "1h",
 * floored; research/33 "5h". Older posts keep "Yesterday" / "3 days ago"
 * (when hours turn into a date is unmeasured).
 */
const feedAge = (at: number, locale: string, justNow: string): string => {
  const age = Date.now() - at;

  if (age < 0 || age >= 24 * HOUR_MS) return formatRelativeStamp(at, locale, { timeFormat: 'hidden' });
  if (age < MINUTE_MS) return justNow;
  const unit = age < HOUR_MS ? 'minute' : 'hour';

  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(Math.floor(age / (unit === 'minute' ? MINUTE_MS : HOUR_MS)));
};

export class DatabaseFeedView implements DatabaseViewRenderer {
  private readonly options: FeedViewOptions;
  private readonly cleanups: Array<() => void> = [];
  /** Every shown byline age, re-read by one shared timer. */
  private readonly ages = new Map<HTMLElement, number>();
  private ageTimer: ReturnType<typeof setInterval> | null = null;

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
    const addRow = this.options.handlers.addRow;

    // findings-creation N20: Notion's empty feed shows a ringed "+ New page" tile. Only the empty state was measured.
    if (addRow !== undefined && this.options.rows.length === 0) {
      const add = document.createElement('button');
      const icon = document.createElement('span');

      add.type = 'button';
      add.setAttribute('data-blok-database-feed-new', '');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = IconPlus;
      add.append(icon, this.options.i18n.t('tools.database.layoutNewPage'));
      add.addEventListener('click', () => addRow());
      feed.appendChild(add);
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
    const card = wrapper.querySelector(`[data-blok-database-feed-card][data-row-id="${CSS.escape(rowId)}"]`);

    [...this.ages.keys()].filter((el) => card?.contains(el) === true).forEach((el) => this.ages.delete(el));
    card?.remove();
  }

  updateRowTitle(wrapper: HTMLElement, rowId: string, title: string): void {
    const el = wrapper.querySelector(`[data-blok-database-feed-card][data-row-id="${CSS.escape(rowId)}"] [data-blok-database-feed-title]`);

    if (el !== null) el.textContent = title;
  }

  destroy(): void {
    this.cleanups.splice(0).forEach((cleanup) => cleanup());
    if (this.ageTimer !== null) clearInterval(this.ageTimer);
    this.ageTimer = null;
    this.ages.clear();
  }

  private createCard(row: DatabaseRow): HTMLElement {
    const card = document.createElement('article');
    const title = row.properties[this.options.titlePropertyId];
    const text = typeof title === 'string' ? title : '';

    card.setAttribute('data-blok-database-feed-card', '');
    card.setAttribute('data-row-id', row.id);
    card.setAttribute('role', 'listitem');

    const toolbar = this.createToolbar(row.id, card);

    if (toolbar !== null) card.appendChild(toolbar);

    const byline = this.createByline(row);

    if (byline !== null) card.appendChild(byline);

    const titleEl = document.createElement('button');

    titleEl.type = 'button';
    titleEl.setAttribute('data-blok-database-feed-title', '');
    titleEl.textContent = text;
    if (text === '') titleEl.setAttribute('data-placeholder', this.options.i18n.t('tools.database.cardTitlePlaceholder'));
    titleEl.addEventListener('click', () => this.options.handlers.openRow(row.id));
    const icon = showsPageIcon(this.options.view) ? pageIconElement(row) : null;

    if (icon === null) {
      card.appendChild(titleEl);
    } else {
      // The card stacks its children, so the icon needs a row to sit beside the title.
      const head = document.createElement('div');

      head.setAttribute('data-blok-database-feed-head', '');
      head.append(icon, titleEl);
      card.appendChild(head);
    }

    const properties = this.createProperties(row);

    if (properties.childElementCount > 0) card.appendChild(properties);

    const body = this.createBody(row.id);

    if (body.childElementCount > 0) card.appendChild(body);
    const reactions = this.createReactions(row);

    if (reactions !== null) card.appendChild(reactions);
    const comments = this.options.footer === undefined ? this.options.comments?.(row.id) ?? null : null;

    if (comments !== null) card.appendChild(comments);
    if (this.options.footer !== undefined) {
      const holder = document.createElement('div');

      holder.setAttribute('data-blok-database-feed-footer', '');
      card.appendChild(holder);
      const cleanup = this.options.footer({ rowId: row.id, holder });

      if (typeof cleanup === 'function') this.cleanups.push(cleanup);
    }

    return card;
  }

  /** The built-in reactions, unless the host owns the footer. */
  private ownReactions(): FeedReactions | undefined {
    return this.options.footer === undefined ? this.options.reactions : undefined;
  }

  private iconButton(attribute: string, label: string, icon: string, onClick: (button: HTMLButtonElement) => void): HTMLButtonElement {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(attribute, '');
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick(button);
    });
    onHover(button, label);

    return button;
  }

  /** research/19 §2b: React and More actions, shown over the hovered card only. */
  private createToolbar(rowId: string, card: HTMLElement): HTMLElement | null {
    const reactions = this.ownReactions();
    const pick = reactions?.pick;
    const actions = this.options.actions;
    const t = (key: string): string => this.options.i18n.t(key);

    if (pick === undefined && actions === undefined) return null;
    const toolbar = document.createElement('div');

    toolbar.setAttribute('data-blok-database-feed-card-actions', '');
    if (pick !== undefined) {
      toolbar.appendChild(this.iconButton('data-blok-database-feed-react', t('tools.database.feedReact'), IconEmojiSmile, (button) => pick(rowId, button)));
    }
    if (actions !== undefined) {
      toolbar.appendChild(this.iconButton('data-blok-database-feed-more-actions', t('tools.database.tableMoreActions'), IconDotsHorizontal, (button) => actions(rowId, button, card)));
    }

    return toolbar;
  }

  /** research/19 §2c: a pill per emoji, then Add reaction. */
  private createReactions(row: DatabaseRow): HTMLElement | null {
    const reactions = this.ownReactions();

    if (reactions === undefined) return null;
    const { me, toggle, pick } = reactions;
    const list = reactionPills(row.reactions);

    if (list.length === 0 && pick === undefined) return null;
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-database-feed-reactions', '');
    for (const { emoji, users } of list) {
      const mine = me !== undefined && users.includes(me);
      const pill = document.createElement(toggle === undefined ? 'span' : 'button');
      const glyph = document.createElement('span');
      const count = document.createElement('span');
      const people = users.map((id) => this.options.personName?.(id) ?? id);

      pill.setAttribute('data-blok-database-feed-reaction', '');
      pill.setAttribute('data-emoji', emoji);
      pill.toggleAttribute('data-mine', mine);
      glyph.textContent = emoji;
      count.setAttribute('data-blok-database-feed-reaction-count', '');
      count.textContent = String(users.length);
      pill.append(glyph, count);
      if (pill instanceof HTMLButtonElement && toggle !== undefined) {
        pill.type = 'button';
        pill.setAttribute('aria-pressed', String(mine));
        pill.addEventListener('click', (event) => {
          event.stopPropagation();
          toggle(row.id, emoji);
        });
      }
      onHover(pill, this.options.i18n.t('tools.database.feedReactedWith', {
        names: new Intl.ListFormat(this.options.locale, { type: 'conjunction' }).format(people),
        emoji,
      }));
      holder.appendChild(pill);
    }
    if (pick !== undefined) {
      holder.appendChild(this.iconButton('data-blok-database-feed-add-reaction', this.options.i18n.t('tools.database.feedAddReaction'), IconEmojiSmile, (button) => pick(row.id, button)));
    }

    return holder;
  }

  /** Notion shows the author and when the page was made by default (research/08). */
  private createByline(row: DatabaseRow): HTMLElement | null {
    const author = row.meta?.createdBy;
    const anonymous = row.meta?.anonymous === true;

    if (author === undefined && !anonymous) return null;
    const byline = document.createElement('div');
    const name = document.createElement('span');

    byline.setAttribute('data-blok-database-feed-byline', '');
    name.setAttribute('data-blok-database-feed-author', '');
    name.textContent = author === undefined
      ? this.options.i18n.t('tools.database.personAnonymous')
      : this.options.personName?.(author) ?? author;
    byline.appendChild(name);
    const at = row.meta?.createdAt;

    if (at !== undefined) {
      const time = document.createElement('span');

      time.setAttribute('data-blok-database-feed-time', '');
      time.textContent = this.age(at);
      this.ages.set(time, at);
      this.ageTimer ??= setInterval(() => this.refreshAges(), AGE_TICK_MS);
      onHover(time, this.createdHint(at));
      byline.appendChild(time);
    }

    return byline;
  }

  private refreshAges(): void {
    for (const [el, created] of this.ages) {
      el.textContent = this.age(created);
    }
  }

  private age(at: number): string {
    return feedAge(at, this.options.locale, this.options.i18n.t('tools.database.feedJustNow'));
  }

  /** research/35 §19: "Created October 22, 2026 at 5:43:51 AM". */
  private createdHint(at: number): string {
    const { locale, i18n } = this.options;
    const date = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(at);
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(at);

    return i18n.t('tools.database.feedCreatedAt', { date, time });
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
      // research/35 §4 measured board, list and gallery; Feed's placement is unmeasured.
      onPropertyHover(item, property.name, property.description);
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

import type { I18n } from '../../../types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition, PropertyValue, SelectOption } from './types';
import { createOptionPill, renderCellValue } from './cells';
import { coverImageOf, pageContentPreview } from './row-body';
import type { BodyBlock } from './row-body';
import { resolveCardPreview, resolveCardSize, resolveFitImage, resolveViewProperties } from './view-settings';
import { safeImageSrc } from '../../components/utils/sanitize-url';
import { getElementDirection } from '../../components/utils/direction';
import { IconPlus } from '../../components/icons';

export interface GalleryGroup {
  /** '' when the gallery is not grouped. */
  key: string;
  label: string;
  option?: SelectOption;
  /** The rows shown, already cut to the load limit. */
  rows: DatabaseRow[];
  /** Rows in the group before the cut. */
  total: number;
}

/** Same shape as a table row drop, so the tool moves both through one path. */
export interface GalleryDropResult {
  rowId: string;
  /** Card now after the dropped one, or null at the end. */
  beforeRowId: string | null;
  /** Card now before the dropped one, or null at the start. */
  afterRowId: string | null;
  groupKey: string;
  fromGroupKey: string;
}

export interface GalleryHandlers {
  openRow: (rowId: string) => void;
  /** Group key, or null when the gallery is not grouped. */
  addRow: (groupKey: string | null) => void;
  moveRow: (result: GalleryDropResult) => void;
  loadMore: (groupKey: string) => void;
}

export interface DatabaseGalleryViewOptions {
  readOnly: boolean;
  i18n: Pick<I18n, 't'>;
  view: DatabaseViewConfig;
  /** Localized schema. */
  schema: PropertyDefinition[];
  groups: GalleryGroup[];
  grouped: boolean;
  titlePropertyId: string;
  /** The row's body blocks: its child blocks, else its legacy body column. */
  bodyOf: (rowId: string) => BodyBlock[];
  handlers?: GalleryHandlers;
  locale?: string;
}

/** Pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4;

interface DragState {
  card: HTMLElement;
  rowId: string;
  fromGroupKey: string;
  startX: number;
  startY: number;
  active: boolean;
  target: { card: HTMLElement; side: 'before' | 'after' } | null;
}

const imageFromValue = (value: PropertyValue | undefined): string | undefined => {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  const url = typeof first === 'object' && first !== null ? (first as { url?: unknown }).url : first;

  return typeof url === 'string' && url !== '' ? safeImageSrc(url) ?? undefined : undefined;
};

/**
 * Notion's gallery layout (research/03 §4): a grid of cards with a preview,
 * the title and the visible properties, an optional group per section, and
 * a trailing "+ New" card.
 */
export class DatabaseGalleryView implements DatabaseViewRenderer {
  private readonly options: DatabaseGalleryViewOptions;
  private drag: DragState | null = null;
  /** Set after a drag so the click that ends it does not open the card. */
  private suppressClick = false;

  constructor(options: DatabaseGalleryViewOptions) {
    this.options = options;
  }

  get interacting(): boolean {
    return this.drag?.active === true;
  }

  private t(key: string): string {
    return this.options.i18n.t(key);
  }

  private get canDrag(): boolean {
    return !this.options.readOnly && this.options.handlers !== undefined && this.options.view.sorts.length === 0;
  }

  createView(): HTMLDivElement {
    const root = document.createElement('div');

    root.setAttribute('data-blok-database-gallery', '');
    root.setAttribute('data-card-size', resolveCardSize(this.options.view));
    if (resolveFitImage(this.options.view)) {
      root.setAttribute('data-fit-image', '');
    }
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', this.t('tools.database.galleryLabel'));

    for (const group of this.options.groups) {
      root.appendChild(this.options.grouped ? this.createGroup(group) : this.createGrid(group));
    }

    root.addEventListener('click', this.onClick);
    root.addEventListener('keydown', this.onKeyDown);
    root.addEventListener('pointerdown', this.onPointerDown);

    return root;
  }

  private createGroup(group: GalleryGroup): HTMLElement {
    const section = document.createElement('section');

    section.setAttribute('data-blok-database-gallery-group', '');
    section.setAttribute('data-group-key', group.key);

    const header = document.createElement('div');

    header.setAttribute('data-blok-database-gallery-group-header', '');
    if (group.option !== undefined) {
      header.appendChild(createOptionPill(group.option));
    } else {
      const label = document.createElement('span');

      label.setAttribute('data-blok-database-gallery-group-label', '');
      label.textContent = group.label;
      header.appendChild(label);
    }

    const count = document.createElement('span');

    count.setAttribute('data-blok-database-gallery-group-count', '');
    count.textContent = String(group.total);
    header.appendChild(count);
    section.append(header, this.createGrid(group));

    return section;
  }

  private createGrid(group: GalleryGroup): HTMLElement {
    const container = document.createElement('div');
    const grid = document.createElement('div');

    grid.setAttribute('data-blok-database-gallery-grid', '');
    grid.setAttribute('data-group-key', group.key);
    grid.setAttribute('role', 'list');

    for (const row of group.rows) {
      grid.appendChild(this.createCard(row, group.key));
    }

    if (!this.options.readOnly && this.options.handlers !== undefined) {
      grid.appendChild(this.createNewCard(group.key));
    }
    container.appendChild(grid);

    if (group.total > group.rows.length) {
      const more = document.createElement('button');

      more.type = 'button';
      more.setAttribute('data-blok-database-gallery-load-more', '');
      more.setAttribute('data-group-key', group.key);
      more.textContent = this.t('tools.database.galleryLoadMore');
      container.appendChild(more);
    }

    return container;
  }

  private titleOf(row: DatabaseRow): string {
    const title = row.properties[this.options.titlePropertyId];

    return typeof title === 'string' ? title : '';
  }

  private createCard(row: DatabaseRow, groupKey: string): HTMLElement {
    const card = document.createElement('div');
    const properties = resolveViewProperties(this.options.view, this.options.schema);
    const titleShown = properties.find((p) => p.id === this.options.titlePropertyId)?.visible !== false;
    const title = this.titleOf(row);

    card.setAttribute('data-blok-database-gallery-card', '');
    card.setAttribute('data-row-id', row.id);
    card.setAttribute('data-group-key', groupKey);
    card.setAttribute('role', 'listitem');
    card.tabIndex = 0;
    if (!titleShown) {
      card.setAttribute('aria-label', title);
    }

    const preview = this.createPreview(row);

    if (preview !== null) {
      card.appendChild(preview);
    }

    if (titleShown) {
      const titleEl = document.createElement('div');

      titleEl.setAttribute('data-blok-database-gallery-title', '');
      titleEl.textContent = title;
      if (title === '') {
        titleEl.setAttribute('data-placeholder', this.t('tools.database.cardTitlePlaceholder'));
      }
      card.appendChild(titleEl);
    }

    const shown = properties.filter((p) => p.visible && p.id !== this.options.titlePropertyId);
    const list = document.createElement('div');

    list.setAttribute('data-blok-database-gallery-properties', '');
    for (const setting of shown) {
      const property = this.options.schema.find((p) => p.id === setting.id);
      const value = row.properties[setting.id];

      if (property === undefined) {
        continue;
      }

      const cell = renderCellValue(property, value, { i18n: this.options.i18n, readOnly: true, locale: this.options.locale });

      if (cell.hasAttribute('data-empty')) {
        continue;
      }

      const item = document.createElement('div');

      item.setAttribute('data-blok-database-gallery-property', '');
      item.setAttribute('data-property-id', property.id);
      item.setAttribute('data-wrap', String(setting.wrap));
      item.title = property.name;
      item.appendChild(cell);
      list.appendChild(item);
    }
    if (list.childElementCount > 0) {
      card.appendChild(list);
    }

    return card;
  }

  private createPreview(row: DatabaseRow): HTMLElement | null {
    const preview = resolveCardPreview(this.options.view, this.options.schema);

    if (preview.kind === 'none') {
      return null;
    }

    const box = document.createElement('div');

    box.setAttribute('data-blok-database-gallery-preview', '');
    box.setAttribute('data-preview', preview.kind);

    if (preview.kind === 'property') {
      this.fillImage(box, imageFromValue(row.properties[preview.propertyId]));

      return box;
    }

    const body = this.options.bodyOf(row.id);

    if (preview.kind === 'cover') {
      this.fillImage(box, coverImageOf(body));

      return box;
    }

    const content = pageContentPreview(body);

    if (content.image !== undefined) {
      this.fillImage(box, content.image);

      return box;
    }

    for (const line of content.lines) {
      const el = document.createElement('div');

      el.setAttribute('data-blok-database-gallery-preview-line', line.level);
      el.textContent = line.text;
      box.appendChild(el);
    }
    if (content.lines.length === 0) {
      box.setAttribute('data-empty', '');
    }

    return box;
  }

  private fillImage(box: HTMLElement, src: string | undefined): void {
    if (src === undefined) {
      box.setAttribute('data-empty', '');

      return;
    }

    const img = document.createElement('img');

    img.setAttribute('data-blok-database-gallery-image', '');
    img.alt = '';
    img.loading = 'lazy';
    img.draggable = false;
    img.src = src;
    box.appendChild(img);
  }

  private createNewCard(groupKey: string): HTMLElement {
    const add = document.createElement('div');

    add.setAttribute('data-blok-database-gallery-new', '');
    add.setAttribute('data-group-key', groupKey);
    add.setAttribute('role', 'button');
    add.tabIndex = 0;

    const icon = document.createElement('span');

    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = IconPlus;

    const label = document.createElement('span');

    label.textContent = this.t('tools.database.galleryNew');
    add.append(icon, label);

    return add;
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (this.suppressClick) {
      this.suppressClick = false;

      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const handlers = this.options.handlers;

    if (target === null || handlers === undefined) {
      return;
    }

    const more = target.closest('[data-blok-database-gallery-load-more]');

    if (more !== null) {
      handlers.loadMore(more.getAttribute('data-group-key') ?? '');

      return;
    }

    const add = target.closest('[data-blok-database-gallery-new]');

    if (add !== null) {
      handlers.addRow(this.options.grouped ? add.getAttribute('data-group-key') : null);

      return;
    }

    const card = target.closest('[data-blok-database-gallery-card]');
    const rowId = card?.getAttribute('data-row-id');

    if (rowId !== null && rowId !== undefined) {
      handlers.openRow(rowId);
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    const target = event.target instanceof HTMLElement ? event.target : null;

    if (target?.matches('[data-blok-database-gallery-card], [data-blok-database-gallery-new]') === true) {
      event.preventDefault();
      target.click();
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.canDrag || !(event.target instanceof Element)) {
      return;
    }

    const card = event.target.closest<HTMLElement>('[data-blok-database-gallery-card]');
    const rowId = card?.getAttribute('data-row-id');

    if (card === null || rowId === null || rowId === undefined) {
      return;
    }

    this.drag = {
      card,
      rowId,
      fromGroupKey: card.getAttribute('data-group-key') ?? '',
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      target: null,
    };
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('pointercancel', this.cancelDrag);
    document.addEventListener('keydown', this.onDragKeyDown);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;

    if (drag === null) {
      return;
    }

    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) {
        return;
      }
      drag.active = true;
      drag.card.setAttribute('data-dragging', '');
    }

    this.setTarget(this.findTarget(event.clientX, event.clientY));
  };

  private findTarget(x: number, y: number): DragState['target'] {
    const root = this.drag?.card.closest('[data-blok-database-gallery]');

    if (root === null || root === undefined || this.drag === null) {
      return null;
    }

    const rtl = getElementDirection(root) === 'rtl';
    const dragged = this.drag.card;

    for (const card of root.querySelectorAll<HTMLElement>('[data-blok-database-gallery-card]')) {
      const box = card.getBoundingClientRect();

      if (card === dragged || x < box.left || x > box.right || y < box.top || y > box.bottom) {
        continue;
      }

      const firstHalf = x < box.left + box.width / 2;

      return { card, side: firstHalf !== rtl ? 'before' : 'after' };
    }

    return null;
  }

  private setTarget(target: DragState['target']): void {
    const drag = this.drag;

    if (drag === null) {
      return;
    }

    drag.target?.card.removeAttribute('data-drop');
    drag.target = target;
    target?.card.setAttribute('data-drop', target.side);
  }

  private readonly onPointerUp = (): void => {
    const drag = this.drag;
    const target = drag?.target ?? null;

    this.endDrag();

    if (drag === null || !drag.active) {
      return;
    }

    this.suppressClick = true;
    if (target === null) {
      return;
    }

    const groupKey = target.card.getAttribute('data-group-key') ?? '';
    const grid = target.card.parentElement;
    const siblings = [...(grid?.querySelectorAll<HTMLElement>('[data-blok-database-gallery-card]') ?? [])]
      .filter((card) => card !== drag.card);
    const at = siblings.indexOf(target.card) + (target.side === 'after' ? 1 : 0);

    this.options.handlers?.moveRow({
      rowId: drag.rowId,
      afterRowId: siblings[at - 1]?.getAttribute('data-row-id') ?? null,
      beforeRowId: siblings[at]?.getAttribute('data-row-id') ?? null,
      groupKey,
      fromGroupKey: drag.fromGroupKey,
    });
  };

  private readonly onDragKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.cancelDrag();
    }
  };

  private readonly cancelDrag = (): void => {
    const wasActive = this.drag?.active === true;

    this.endDrag();
    this.suppressClick = wasActive;
  };

  private endDrag(): void {
    this.drag?.target?.card.removeAttribute('data-drop');
    this.drag?.card.removeAttribute('data-dragging');
    this.drag = null;
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('pointercancel', this.cancelDrag);
    document.removeEventListener('keydown', this.onDragKeyDown);
  }

  destroy(): void {
    this.endDrag();
  }

  appendRow(): void {
    // The tool redraws the gallery after a row is added.
  }

  removeRow(wrapper: HTMLElement, rowId: string): void {
    this.findCard(wrapper, rowId)?.remove();
  }

  updateRowTitle(wrapper: HTMLElement, rowId: string, title: string): void {
    const titleEl = this.findCard(wrapper, rowId)?.querySelector('[data-blok-database-gallery-title]');

    if (titleEl !== null && titleEl !== undefined) {
      titleEl.textContent = title;
    }
  }

  private findCard(wrapper: HTMLElement, rowId: string): HTMLElement | null {
    return [...wrapper.querySelectorAll<HTMLElement>('[data-blok-database-gallery-card]')]
      .find((card) => card.getAttribute('data-row-id') === rowId) ?? null;
  }
}

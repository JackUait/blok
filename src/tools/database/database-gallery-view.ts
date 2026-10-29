import { fileChipIcon, pageIconElement, showsPageIcon } from './page-icon';
import type { I18n } from '../../../types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition, SelectOption } from './types';
import { bindFileNameHint, createOptionPill, renderCellValue } from './cells';
import { rowCellContext } from './reminders';
import type { CellContext } from './cells';
import { createCardPreview } from './database-card-preview';
import { readPropertyValue } from './property-values';
import type { BodyBlock } from './row-body';
import { resolveCardLayout, resolveCardPreview, resolveCardSize, resolveFitImage, resolveViewProperties } from './view-settings';
import { syncCommentBadge } from './database-comment-badge';
import type { CommentBadges } from './database-comment-badge';
import { getElementDirection } from '../../components/utils/direction';
import { IconDotsHorizontal, IconPencil, IconPlus } from '../../components/icons';
import { onHover } from '../../components/utils/tooltip';
import { onPropertyHover } from './property-hint';
import { startInlineRename } from '../../components/utils/inline-rename';

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
  /** Replaces the selection. Without it the arrows select nothing (read-only). */
  selectRows?: (rowIds: string[]) => void;
  /** Cmd/Ctrl-click toggles, Shift-click adds a range of `order`, the cards as drawn. */
  pickRow?: (rowId: string, range: boolean, order: string[]) => void;
  renameRow?: (rowId: string, title: string) => void;
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
  /** What cells need from the host: relation titles, computed result types. */
  cellContext?: Partial<CellContext>;
  /** The host's comment counts. Without it there are no badges. */
  commentBadges?: CommentBadges;
}

/** Painted by the tool's paintRowSelection; the gallery reads the selection back from it. */
const SELECTED_ATTR = 'data-blok-database-row-selected';
const CARD = '[data-blok-database-gallery-card]';
/** The card's hover buttons; the tool opens the row menu from "•••". */
const CARD_ACTIONS = '[data-blok-database-card-actions]';
const CELL_LINK = 'a[data-blok-database-cell-link]';

/** Pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4;

interface DragState {
  card: HTMLElement;
  rowId: string;
  fromGroupKey: string;
  startX: number;
  startY: number;
  active: boolean;
  /** A card and a side, or an empty group's grid (`inside`). */
  target: { card: HTMLElement; side: 'before' | 'after' | 'inside' } | null;
}

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
  private root: HTMLElement | null = null;
  /** The card the arrows move from; kept after the selection clears so the next arrow resumes there (research/16 §3a runs C, D). */
  private cursor: string | null = null;
  /** Where a Shift+arrow range starts. */
  private anchor: string | null = null;
  /** The cursor came from a click pick, not the arrows: Enter opens it instead of renaming (research/23 §8). */
  private clickPicked = false;
  /** The selection Enter opened a peek from; it comes back with focus when the peek closes (research/23 §8). */
  private peekFrom: string[] | null = null;

  constructor(options: DatabaseGalleryViewOptions) {
    this.options = options;
  }

  get interacting(): boolean {
    return this.drag?.active === true;
  }

  private t(key: string): string {
    return this.options.i18n.t(key);
  }

  private get selectable(): boolean {
    return !this.options.readOnly && this.options.handlers?.selectRows !== undefined;
  }

  private get canDrag(): boolean {
    return !this.options.readOnly && this.options.handlers !== undefined && this.options.view.sorts.length === 0;
  }

  createView(): HTMLDivElement {
    const root = document.createElement('div');

    root.setAttribute('data-blok-database-gallery', '');
    root.setAttribute('data-card-size', resolveCardSize(this.options.view));
    root.setAttribute('data-card-layout', resolveCardLayout(this.options.view));
    if (resolveFitImage(this.options.view)) {
      root.setAttribute('data-fit-image', '');
    }
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', this.t('tools.database.galleryLabel'));
    if (this.selectable) {
      // Holds focus while the arrows select cards; core keys stand down inside.
      root.tabIndex = -1;
      root.setAttribute('data-blok-keyboard-owner', '');
      // Core leaves a Shift-click on a card to pickRow, not a block range.
      root.setAttribute('data-blok-selection-owner', '');
    }
    this.root = root;

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

    const preview = createCardPreview(resolveCardPreview(this.options.view, this.options.schema), row, this.options.bodyOf, 'gallery');

    if (preview !== null) {
      card.appendChild(preview);
    }

    if (titleShown) {
      const icon = showsPageIcon(this.options.view) ? pageIconElement(row) : null;

      if (icon !== null) {
        card.appendChild(icon);
      }
      const titleEl = this.createTitle(title);

      card.appendChild(titleEl);
      if (this.options.commentBadges !== undefined) syncCommentBadge(titleEl, row.id, this.options.commentBadges, this.options.i18n);
    }

    const shown = properties.filter((p) => p.visible && p.id !== this.options.titlePropertyId);
    const list = document.createElement('div');

    list.setAttribute('data-blok-database-gallery-properties', '');
    for (const setting of shown) {
      const property = this.options.schema.find((p) => p.id === setting.id);

      if (property === undefined) {
        continue;
      }

      const cell = renderCellValue(property, readPropertyValue(row, property), {
        ...this.options.cellContext, i18n: this.options.i18n, readOnly: true, locale: this.options.locale, ...rowCellContext(row, property.id),
      });

      if (cell.hasAttribute('data-empty')) {
        continue;
      }
      // notion-spec-2 §19.17: a card file chip has the page glyph, as in the table.
      // notion-spec-2 §19.19: a card's Button presses as in the table; the card's other values stay read-only.
      cell.querySelectorAll('[data-blok-database-button]').forEach((button) => button.toggleAttribute('disabled', this.options.readOnly));
      cell.querySelectorAll<HTMLElement>('[data-blok-database-file-chip]').forEach((chip) => {
        chip.prepend(fileChipIcon());
        bindFileNameHint(chip);
      });
      // notion-spec-2 §19.17: a card's checkbox has the property name beside it.
      if (property.type === 'checkbox') {
        const name = document.createElement('span');

        name.setAttribute('data-blok-database-checkbox-name', '');
        name.setAttribute('aria-hidden', 'true');
        name.textContent = property.name;
        cell.appendChild(name);
      }

      const item = document.createElement('div');

      item.setAttribute('data-blok-database-gallery-property', '');
      item.setAttribute('data-property-id', property.id);
      item.setAttribute('data-wrap', String(setting.wrap));
      // research/35 §4: left of the card in Notion; Blok anchors on the value.
      onPropertyHover(item, property.name, property.description);
      item.appendChild(cell);
      list.appendChild(item);
    }
    if (list.childElementCount > 0) {
      card.appendChild(list);
    }
    if (!this.options.readOnly) {
      card.appendChild(this.createActions(row.id, titleShown));
    }

    return card;
  }

  /** Edit and "•••" at the cover's top-right, Tab stops right after the card (research/12 §3, research/16 §3a). */
  private createActions(rowId: string, titleShown: boolean): HTMLElement {
    const actions = document.createElement('div');
    const button = (attribute: string, label: string, icon: string): HTMLButtonElement => {
      const el = document.createElement('button');

      el.type = 'button';
      el.setAttribute(attribute, '');
      el.setAttribute('data-row-id', rowId);
      el.setAttribute('aria-label', label);
      el.innerHTML = icon;
      onHover(el, label);
      actions.appendChild(el);

      return el;
    };

    actions.setAttribute('data-blok-database-card-actions', '');
    // A hidden name has nothing to rename.
    if (titleShown) {
      button('data-blok-database-edit-card', this.t('tools.database.galleryCardEdit'), IconPencil)
        .addEventListener('click', () => this.startRename(rowId));
    }
    button('data-blok-database-card-menu', this.t('tools.database.galleryCardMore'), IconDotsHorizontal);

    return actions;
  }

  private createTitle(title: string): HTMLElement {
    const titleEl = document.createElement('div');

    titleEl.setAttribute('data-blok-database-gallery-title', '');
    titleEl.textContent = title;
    if (title === '') {
      titleEl.setAttribute('data-placeholder', this.t('tools.database.cardTitlePlaceholder'));
    }

    return titleEl;
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

    label.textContent = this.t('tools.database.newPage');
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

    // The buttons act on their own; the click goes on to the tool for "•••". A link is followed (research/22 §3).
    if (target.closest(CARD_ACTIONS) !== null || target.closest(CELL_LINK) !== null) {
      return;
    }

    const add = target.closest('[data-blok-database-gallery-new]');

    if (add !== null) {
      handlers.addRow(this.options.grouped ? add.getAttribute('data-group-key') : null);

      return;
    }

    const card = target.closest('[data-blok-database-gallery-card]');
    const rowId = card?.getAttribute('data-row-id');

    if (rowId === null || rowId === undefined) {
      return;
    }
    if ((event.metaKey || event.ctrlKey || event.shiftKey) && !this.options.readOnly && handlers.pickRow !== undefined) {
      handlers.pickRow(rowId, event.shiftKey, this.cardIds());
      this.cursor = rowId;
      this.anchor = rowId;
      this.clickPicked = true;
      // Core blocks the Shift-click focus (selection owner), so the arrows would miss the gallery.
      this.root?.focus({ preventScroll: true });

      return;
    }
    this.peekFrom = null;
    handlers.openRow(rowId);
  };

  /**
   * Notion's gallery keys (research/16 §3a): arrows select cards with focus
   * on the root, Enter on an arrow-picked card renames it, Enter on a
   * click-picked or Tab-focused card opens it. Escape is the tool's selection handler.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;

    if (target === null || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (target.matches('[data-blok-database-gallery-new]') && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      target.click();

      return;
    }
    if (target.matches(CARD) && (event.key === 'Enter' || event.key === ' ')) {
      // Space does nothing on a card, as on Notion's card link.
      event.preventDefault();
      if (event.key === 'Enter') target.click();

      return;
    }
    if (!this.selectable || this.root === null) {
      return;
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      this.moveSelection(event.key, event.shiftKey);
    } else if (event.key === 'Enter' && target === this.root) {
      const selected = this.selectedIds();
      const rowId = this.cursor !== null && selected.includes(this.cursor) ? this.cursor : selected[0];

      // A click pick or several picked: opens the last one clicked (research/22 §2, research/23 §8).
      // One picked with the arrows: renames it (research/16 §3a).
      const open = this.clickPicked && this.cursor !== null ? this.cursor : rowId;

      if ((this.clickPicked || selected.length > 1) && open !== undefined) {
        event.preventDefault();
        this.peekFrom = selected;
        this.options.handlers?.openRow(open);
      } else if (rowId !== undefined && this.startRename(rowId)) {
        event.preventDefault();
      }
    }
  };

  /** The tool calls it when the row's peek closes. */
  rowPageClosed(): void {
    const from = this.peekFrom;

    this.peekFrom = null;
    if (from === null || this.root?.isConnected !== true) return;
    const present = from.filter((id) => this.cardIds().includes(id));

    if (this.selectedIds().length === 0 && present.length > 0) {
      this.options.handlers?.selectRows?.(present);
    }
    // Notion leaves focus on the body, so its first ArrowDown only scrolls; here it moves.
    this.root.focus({ preventScroll: true });
  }

  private cardIds(): string[] {
    return [...(this.root?.querySelectorAll<HTMLElement>(CARD) ?? [])].map((card) => card.getAttribute('data-row-id') ?? '');
  }

  private selectedIds(): string[] {
    return [...(this.root?.querySelectorAll<HTMLElement>(`${CARD}[${SELECTED_ATTR}]`) ?? [])].map((card) => card.getAttribute('data-row-id') ?? '');
  }

  /** Down/Up go one card in reading order and stop at the ends; Left/Right only start a selection. */
  private moveSelection(key: string, extend: boolean): void {
    const order = this.cardIds();
    const selected = this.selectedIds();

    if (order.length === 0) {
      return;
    }
    if (selected.length === 0) {
      const focused = document.activeElement instanceof HTMLElement && document.activeElement.matches(CARD)
        ? document.activeElement.getAttribute('data-row-id')
        : null;
      const resume = focused ?? this.cursor;
      const start = resume !== null && order.includes(resume) ? resume : order[0];

      this.select([start], start);
      this.anchor = start;

      return;
    }
    if (key !== 'ArrowDown' && key !== 'ArrowUp') {
      return;
    }

    const step = key === 'ArrowDown' ? 1 : -1;
    const from = this.cursor !== null && selected.includes(this.cursor) ? this.cursor : selected[step > 0 ? selected.length - 1 : 0];
    const next = order[Math.min(order.length - 1, Math.max(0, order.indexOf(from) + step))];

    if (!extend) {
      this.select([next], next);
      this.anchor = next;

      return;
    }

    const anchor = this.anchor !== null && order.includes(this.anchor) ? this.anchor : from;
    const [a, b] = [order.indexOf(anchor), order.indexOf(next)].sort((x, y) => x - y);

    this.anchor = anchor;
    this.select(order.slice(a, b + 1), next);
  }

  private select(rowIds: string[], cursor: string): void {
    this.cursor = cursor;
    this.clickPicked = false;
    this.options.handlers?.selectRows?.(rowIds);
    this.root?.querySelector<HTMLElement>(`${CARD}[data-row-id="${CSS.escape(cursor)}"]`)?.scrollIntoView?.({ block: 'nearest' });
    if (document.activeElement !== this.root) {
      this.root?.focus({ preventScroll: true });
    }
  }

  /** Inline title rename (research/16 §3a): the selection clears, and comes back on the card when the rename ends. */
  private startRename(rowId: string): boolean {
    const card = this.root?.querySelector<HTMLElement>(`${CARD}[data-row-id="${CSS.escape(rowId)}"]`);
    const titleEl = card?.querySelector<HTMLElement>('[data-blok-database-gallery-title]');

    if (card === null || card === undefined || titleEl === null || titleEl === undefined) {
      return false;
    }
    const original = titleEl.textContent ?? '';
    // A blur onto another control ends the rename without pulling focus back.
    const reselect = (): void => {
      if (card.contains(document.activeElement)) {
        this.select([rowId], rowId);
      }
    };

    this.options.handlers?.selectRows?.([]);
    startInlineRename({
      target: titleEl,
      currentValue: original,
      label: this.t('tools.database.editCardTitle'),
      configureInput: (input) => {
        input.setAttribute('data-blok-database-gallery-title-input', '');
        input.setAttribute('placeholder', this.t('tools.database.cardNamePlaceholder'));
      },
      // Keeps the comment-badge anchor attributes; the badge itself is the next sibling and survives the swap.
      buildRestored: (title) => {
        const restored = this.createTitle(title);

        for (const { name, value } of titleEl.attributes) {
          if (name !== 'data-placeholder') restored.setAttribute(name, value);
        }

        return restored;
      },
      onCommit: (title) => {
        if (title !== original) {
          this.options.handlers?.renameRow?.(rowId, title);
        }
        reselect();
      },
      onCancel: reselect,
    });

    return true;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.canDrag || !(event.target instanceof Element) || event.target.closest(CARD_ACTIONS) !== null) {
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

    for (const grid of root.querySelectorAll<HTMLElement>('[data-blok-database-gallery-grid]')) {
      const box = grid.getBoundingClientRect();
      const empty = [...grid.querySelectorAll('[data-blok-database-gallery-card]')].every((card) => card === dragged);

      if (empty && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
        return { card: grid, side: 'inside' };
      }
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

    this.guardNextClick(true);
    if (target === null) {
      return;
    }

    const groupKey = target.card.getAttribute('data-group-key') ?? '';
    const grid = target.side === 'inside' ? target.card : target.card.parentElement;
    const siblings = [...(grid?.querySelectorAll<HTMLElement>('[data-blok-database-gallery-card]') ?? [])]
      .filter((card) => card !== drag.card);
    const at = target.side === 'inside' ? siblings.length : siblings.indexOf(target.card) + (target.side === 'after' ? 1 : 0);

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
    this.guardNextClick(wasActive);
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

  /**
   * Eats the click the browser fires right after a drag's pointerup. Cleared
   * on the next task: a drag released outside the view sends that click
   * elsewhere, and the guard must not eat the person's next real click.
   */
  private guardNextClick(on: boolean): void {
    this.suppressClick = on;
    if (on) {
      setTimeout(() => {
        this.suppressClick = false;
      }, 0);
    }
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

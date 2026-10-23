import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseBoardView } from '../../../../src/tools/database/database-board-view';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition, SelectOption } from '../../../../src/tools/database/types';
import type { I18n } from '../../../../types';

const i18n = { t: (key: string, vars?: Record<string, string>) => (vars?.property !== undefined ? `${key}:${vars.property}` : key) } as unknown as I18n;

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'status', name: 'Status', type: 'select', position: 'a1', config: { options: [] } },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a2' },
];

const view: DatabaseViewConfig = {
  id: 'v1', name: 'Board', type: 'board', position: 'a0', groupBy: 'status', sorts: [], filters: [], visibleProperties: [],
  properties: [{ id: 'notes', visible: true }],
};

const options: SelectOption[] = [{ id: 'o1', label: 'To do', position: 'a0' }];

const rows: DatabaseRow[] = [
  { id: 'r1', position: 'a0', properties: { title: 'Alpha' } },
  { id: 'r2', position: 'a1', properties: { title: '' } },
];

const make = (overrides: Partial<ConstructorParameters<typeof DatabaseBoardView>[0]> = {}): { view: DatabaseBoardView; board: HTMLElement } => {
  const board = new DatabaseBoardView({
    readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title', view, schema, ...overrides,
  });
  const el = board.createView();

  document.body.appendChild(el);

  return { view: board, board: el };
};

const card = (board: HTMLElement, rowId: string): HTMLElement => {
  const el = board.querySelector<HTMLElement>(`[data-blok-database-card][data-row-id="${rowId}"]`);

  if (el === null) throw new Error(`no card ${rowId}`);

  return el;
};

const input = (board: HTMLElement): HTMLInputElement => {
  const el = board.querySelector<HTMLInputElement>('[data-blok-database-card-title-input]');

  if (el === null) throw new Error('no title input');

  return el;
};

const type = (el: HTMLInputElement, value: string): void => {
  Object.assign(el, { value });
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const press = (el: HTMLElement, key: string): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

describe('board card title, edited in place', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('puts the caret at the end of the title instead of selecting it (feel findings B22)', () => {
    const { board } = make();

    card(board, 'r1').querySelector<HTMLElement>('[data-blok-database-edit-card]')?.click();

    const field = input(board);

    expect(field).toHaveFocus();
    expect(field.value).toBe('Alpha');
    expect([field.selectionStart, field.selectionEnd]).toEqual([5, 5]);
    expect(field.placeholder).toBe('tools.database.cardNamePlaceholder');
  });

  it('shows the page glyph and turns the pencil into Open in side peek while editing', () => {
    const { view: boardView, board } = make();

    boardView.editTitle('r1');

    const cardEl = card(board, 'r1');
    const glyph = cardEl.querySelector('[data-blok-database-card-edit-glyph]');
    const button = cardEl.querySelector<HTMLElement>('[data-blok-database-edit-card]');

    expect(cardEl.hasAttribute('data-editing')).toBe(true);
    expect(glyph?.nextElementSibling).toBe(input(board));
    expect(button?.getAttribute('aria-label')).toBe('tools.page.openInSidePeek');

    press(input(board), 'Enter');

    expect(cardEl.hasAttribute('data-editing')).toBe(false);
    expect(cardEl.querySelector('[data-blok-database-card-edit-glyph]')).toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('tools.database.editCardTitle');
  });

  it('Enter saves the name, then asks for the next new card (feel findings B09)', () => {
    const onTitleEdit = vi.fn();
    const onEnter = vi.fn();
    const { view: boardView, board } = make({ onTitleEdit });

    boardView.editTitle('r2', { onEnter });
    type(input(board), 'Bravo');
    press(input(board), 'Enter');

    expect(onTitleEdit).toHaveBeenCalledWith('r2', 'Bravo');
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('Escape saves without a next card; an empty Enter makes no next card', () => {
    const onTitleEdit = vi.fn();
    const onEnter = vi.fn();
    const { view: boardView, board } = make({ onTitleEdit });

    boardView.editTitle('r2', { onEnter });
    type(input(board), 'Bravo');
    press(input(board), 'Escape');
    document.body.innerHTML = '';
    const next = make({ onTitleEdit });

    next.view.editTitle('r2', { onEnter });
    press(input(next.board), 'Enter');

    expect(onTitleEdit).toHaveBeenCalledWith('r2', 'Bravo');
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('keeps typed text across a redraw: the draft moves to the new board, unsaved', () => {
    const onTitleEdit = vi.fn();
    const onEnter = vi.fn();
    const first = make({ onTitleEdit });

    first.view.editTitle('r2', { onEnter });
    type(input(first.board), 'Half typ');

    const draft = first.view.captureTitleDraft();

    first.board.remove();
    const second = make({ onTitleEdit });

    expect(draft).not.toBeNull();
    if (draft !== null) second.view.restoreTitleDraft(draft);

    const field = input(second.board);

    expect(field.value).toBe('Half typ');
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([8, 8]);
    expect(onTitleEdit).not.toHaveBeenCalled();

    press(field, 'Enter');

    expect(onTitleEdit).toHaveBeenCalledWith('r2', 'Half typ');
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  // feel findings B09/B22: while the title is edited, each empty visible property shows a faint "Add …" row.
  it('shows "Add <property>" rows for empty visible properties while editing, and drops them after', () => {
    const { view: boardView, board } = make();

    boardView.editTitle('r1');

    const ghost = card(board, 'r1').querySelector<HTMLElement>('[data-blok-database-card-property][data-ghost]');

    expect(ghost?.getAttribute('data-property-id')).toBe('notes');
    expect(ghost?.textContent?.trim()).toBe('tools.database.cardAddProperty:Notes');
    expect(ghost?.querySelector('svg')).not.toBeNull();

    press(input(board), 'Enter');

    expect(card(board, 'r1').querySelector('[data-ghost]')).toBeNull();
  });

  it('an "Add …" row saves the title, then edits that property on the card', () => {
    const onTitleEdit = vi.fn();
    const onPropertyEdit = vi.fn();
    const { view: boardView, board } = make({ onTitleEdit, onPropertyEdit });

    boardView.editTitle('r2');
    type(input(board), 'Bravo');
    card(board, 'r2').querySelector<HTMLElement>('[data-ghost]')?.click();

    expect(onTitleEdit).toHaveBeenCalledWith('r2', 'Bravo');
    expect(onPropertyEdit).toHaveBeenCalledWith('r2', 'notes', card(board, 'r2'));
  });

  it('has no draft when nothing is being edited', () => {
    expect(make().view.captureTitleDraft()).toBeNull();
  });
});

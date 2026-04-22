import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseBoardView } from '../../../../src/tools/database/database-board-view';
import { simulateKeydown } from '../../../helpers/simulate';
import type { SelectOption, DatabaseRow } from '../../../../src/tools/database/types';
import type { I18n } from '../../../../types';

const makeOption = (overrides: Partial<SelectOption> = {}): SelectOption => ({
  id: 'opt-1', label: 'To Do', position: 'a0', ...overrides,
});
const makeRow = (overrides: Partial<DatabaseRow> = {}): DatabaseRow => ({
  id: 'row-1', position: 'a0', properties: { title: 'Fix bug' }, ...overrides,
});

const createMockI18n = (): I18n => ({
  t: vi.fn((key: string) => key),
  has: vi.fn(() => true),
  getEnglishTranslation: vi.fn(() => ''),
  getLocale: vi.fn(() => 'en'),
});

describe('DatabaseBoardView', () => {
  let i18n: I18n;

  beforeEach(() => {
    vi.clearAllMocks();
    i18n = createMockI18n();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createView', () => {
    it('renders wrapper with data-blok-tool="database" attribute', () => {
      const view = new DatabaseBoardView({ readOnly: false, i18n, options: [], getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      expect(board.getAttribute('data-blok-tool')).toBe('database');
    });

    it('renders one [data-blok-database-column] per column', () => {
      const options = [
        makeOption({ id: 'opt-1', position: 'a0' }),
        makeOption({ id: 'opt-2', label: 'In Progress', position: 'a1' }),
        makeOption({ id: 'opt-3', label: 'Done', position: 'a2' }),
      ];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls).toHaveLength(3);
    });

    it('renders [data-blok-database-card] elements inside columns', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [
        makeRow({ id: 'row-1', position: 'a0' }),
        makeRow({ id: 'row-2', position: 'a1', properties: { title: 'Write tests' } }),
      ];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const cardEls = board.querySelectorAll('[data-blok-database-card]');

      expect(cardEls).toHaveLength(2);
    });

    it('renders [data-blok-database-add-card] button in each column when NOT read-only', () => {
      const options = [
        makeOption({ id: 'opt-1', position: 'a0' }),
        makeOption({ id: 'opt-2', label: 'Done', position: 'a1' }),
      ];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const addCardBtns = board.querySelectorAll('[data-blok-database-add-card]');

      expect(addCardBtns).toHaveLength(2);
    });

    it('hides add-card button in read-only mode', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const view = new DatabaseBoardView({ readOnly: true, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const addCardBtns = board.querySelectorAll('[data-blok-database-add-card]');

      expect(addCardBtns).toHaveLength(0);
    });

    it('renders [data-blok-database-add-column] button when NOT read-only', () => {
      const view = new DatabaseBoardView({ readOnly: false, i18n, options: [], getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn).not.toBeNull();
    });

    it('hides add-column button in read-only mode', () => {
      const view = new DatabaseBoardView({ readOnly: true, i18n, options: [], getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn).toBeNull();
    });

    it('sets data-option-id on each column element', () => {
      const options = [
        makeOption({ id: 'opt-alpha', position: 'a0' }),
        makeOption({ id: 'opt-beta', position: 'a1' }),
      ];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls[0].getAttribute('data-option-id')).toBe('opt-alpha');
      expect(columnEls[1].getAttribute('data-option-id')).toBe('opt-beta');
    });

    it('sets data-row-id on each card element', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [
        makeRow({ id: 'row-x', position: 'a0' }),
        makeRow({ id: 'row-y', position: 'a1' }),
      ];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const cardEls = board.querySelectorAll('[data-blok-database-card]');

      expect(cardEls[0].getAttribute('data-row-id')).toBe('row-x');
      expect(cardEls[1].getAttribute('data-row-id')).toBe('row-y');
    });

    it('applies column color as background on the column element when color is defined', () => {
      const options = [makeOption({ id: 'opt-1', color: 'green' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const column = board.querySelector('[data-blok-database-column]') as HTMLElement;

      expect(column.style.backgroundColor).toBe('var(--blok-color-green-bg)');
    });

    it('does not apply column color when color is undefined', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const column = board.querySelector('[data-blok-database-column]') as HTMLElement;

      expect(column.style.backgroundColor).toBe('');
    });

    it('does not render action buttons in read-only mode', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: true, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      expect(board.querySelector('[data-blok-database-card-actions]')).toBeNull();
      expect(board.querySelector('[data-blok-database-delete-card]')).toBeNull();
      expect(board.querySelector('[data-blok-database-edit-card]')).toBeNull();
      expect(board.querySelector('[data-blok-database-card-menu]')).toBeNull();
    });

    it('renders card count badge in each column header', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [
        makeRow({ id: 'row-1', position: 'a0' }),
        makeRow({ id: 'row-2', position: 'a1', properties: { title: 'Write tests' } }),
      ];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const countEl = board.querySelector('[data-blok-database-column-count]');

      expect(countEl).not.toBeNull();
      expect(countEl?.textContent).toBe('2');
    });

    it('renders card count badge as 0 for empty columns', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const countEl = board.querySelector('[data-blok-database-column-count]');

      expect(countEl).not.toBeNull();
      expect(countEl?.textContent).toBe('0');
    });

    it('prefixes add-card button text with +', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const addCardBtn = board.querySelector('[data-blok-database-add-card]');
      const iconEl = addCardBtn?.querySelector('[data-blok-database-add-card-icon]');
      const labelEl = addCardBtn?.querySelector('span:last-child');

      expect(iconEl).not.toBeNull();
      expect(labelEl?.textContent).toBeTruthy();
    });

    it('prefixes add-column button text with +', () => {
      const view = new DatabaseBoardView({ readOnly: false, i18n, options: [], getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn?.textContent).toMatch(/^\+ /);
    });

    it('renders colored dot in column header when color is defined', () => {
      const options = [makeOption({ id: 'opt-1', color: 'blue' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const dot = board.querySelector('[data-blok-database-column-dot]') as HTMLElement;

      expect(dot).not.toBeNull();
      expect(dot.style.backgroundColor).toBe('var(--blok-color-blue-text)');
    });

    it('does not render dot when color is undefined', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const dot = board.querySelector('[data-blok-database-column-dot]');

      expect(dot).toBeNull();
    });

    it('renders column header pill element', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const pill = board.querySelector('[data-blok-database-column-pill]');

      expect(pill).not.toBeNull();
    });

    it('does not render empty placeholder', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const placeholder = board.querySelector('[data-blok-database-empty-placeholder]');

      expect(placeholder).toBeNull();
    });

    it('wraps columns inside a board area element ([data-blok-database-board])', () => {
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const boardArea = board.querySelector('[data-blok-database-board]');

      expect(boardArea).not.toBeNull();

      const column = boardArea!.querySelector('[data-blok-database-column]');

      expect(column).not.toBeNull();
    });
  });

  describe('card action buttons', () => {
    it('renders [data-blok-database-card-actions] on each card when NOT read-only', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const actionGroups = board.querySelectorAll('[data-blok-database-card-actions]');
      expect(actionGroups).toHaveLength(1);
    });

    it('does not render [data-blok-database-card-actions] in read-only mode', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: true, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const actionGroups = board.querySelectorAll('[data-blok-database-card-actions]');
      expect(actionGroups).toHaveLength(0);
    });

    it('renders [data-blok-database-edit-card] button inside the action group', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const editBtn = board.querySelector('[data-blok-database-edit-card]');
      expect(editBtn).not.toBeNull();
      expect(editBtn?.closest('[data-blok-database-card-actions]')).not.toBeNull();
    });

    it('renders [data-blok-database-card-menu] button inside the action group', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const menuBtn = board.querySelector('[data-blok-database-card-menu]');
      expect(menuBtn).not.toBeNull();
      expect(menuBtn?.closest('[data-blok-database-card-actions]')).not.toBeNull();
    });

    it('does NOT render the old [data-blok-database-delete-card] button', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const deleteBtn = board.querySelector('[data-blok-database-delete-card]');
      expect(deleteBtn).toBeNull();
    });

    it('sets aria-label on edit button', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const editBtn = board.querySelector('[data-blok-database-edit-card]');
      expect(editBtn?.getAttribute('aria-label')).toBeTruthy();
    });

    it('sets aria-label on menu button', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const menuBtn = board.querySelector('[data-blok-database-card-menu]');
      expect(menuBtn?.getAttribute('aria-label')).toBeTruthy();
    });
  });

  describe('card inline title edit', () => {
    const createViewWithCard = (title = 'Fix bug'): { board: HTMLDivElement; cardEl: HTMLElement } => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title } })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();
      const cardEl = board.querySelector('[data-blok-database-card]') as HTMLElement;
      return { board, cardEl };
    };

    it('replaces title div with input when edit button is clicked', () => {
      const { cardEl } = createViewWithCard('Fix bug');
      const editBtn = cardEl.querySelector('[data-blok-database-edit-card]') as HTMLElement;

      editBtn.click();

      const input = cardEl.querySelector<HTMLInputElement>('[data-blok-database-card-title-input]');
      expect(input).not.toBeNull();
      expect(input?.value).toBe('Fix bug');
    });

    it('restores title div on Enter and calls onTitleEdit with new value', () => {
      const onTitleEdit = vi.fn();
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Fix bug' } })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title', onTitleEdit });
      const board = view.createView();
      const cardEl = board.querySelector('[data-blok-database-card]') as HTMLElement;
      const editBtn = cardEl.querySelector('[data-blok-database-edit-card]') as HTMLElement;

      editBtn.click();

      const input = cardEl.querySelector<HTMLInputElement>('[data-blok-database-card-title-input]')!;
      input.value = 'New Title';
      simulateKeydown(input, 'Enter');

      const titleDiv = cardEl.querySelector('[data-blok-database-card-title]');
      expect(titleDiv).not.toBeNull();
      expect(cardEl.querySelector('[data-blok-database-card-title-input]')).toBeNull();
      expect(onTitleEdit).toHaveBeenCalledWith('row-1', 'New Title');
    });

    it('restores title div on blur and calls onTitleEdit with new value', () => {
      const onTitleEdit = vi.fn();
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Fix bug' } })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title', onTitleEdit });
      const board = view.createView();
      const cardEl = board.querySelector('[data-blok-database-card]') as HTMLElement;
      const editBtn = cardEl.querySelector('[data-blok-database-edit-card]') as HTMLElement;

      editBtn.click();

      const input = cardEl.querySelector<HTMLInputElement>('[data-blok-database-card-title-input]')!;
      input.value = 'Blurred Title';
      input.dispatchEvent(new Event('blur', { bubbles: true }));

      expect(cardEl.querySelector('[data-blok-database-card-title]')).not.toBeNull();
      expect(onTitleEdit).toHaveBeenCalledWith('row-1', 'Blurred Title');
    });

    it('restores original title on Escape without calling onTitleEdit', () => {
      const onTitleEdit = vi.fn();
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Fix bug' } })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title', onTitleEdit });
      const board = view.createView();
      const cardEl = board.querySelector('[data-blok-database-card]') as HTMLElement;
      const editBtn = cardEl.querySelector('[data-blok-database-edit-card]') as HTMLElement;

      editBtn.click();

      const input = cardEl.querySelector<HTMLInputElement>('[data-blok-database-card-title-input]')!;
      input.value = 'Changed';
      simulateKeydown(input, 'Escape');

      const titleDiv = cardEl.querySelector('[data-blok-database-card-title]');
      expect(titleDiv?.textContent).toBe('Fix bug');
      expect(onTitleEdit).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('board element has role="region" and aria-label pointing at the localised key', () => {
      const view = new DatabaseBoardView({ readOnly: false, i18n, options: [], getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      expect(board.getAttribute('role')).toBe('region');
      expect(board.getAttribute('aria-label')).toBe('tools.database.kanbanBoard');
    });

    it('each column element has role="group"', () => {
      const options = [
        makeOption({ id: 'opt-1', position: 'a0' }),
        makeOption({ id: 'opt-2', label: 'In Progress', position: 'a1' }),
      ];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls[0].getAttribute('role')).toBe('group');
      expect(columnEls[1].getAttribute('role')).toBe('group');
    });

    it('each column has aria-label set to the option label', () => {
      const options = [
        makeOption({ id: 'opt-1', label: 'To Do', position: 'a0' }),
        makeOption({ id: 'opt-2', label: 'In Progress', position: 'a1' }),
      ];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls[0].getAttribute('aria-label')).toBe('To Do');
      expect(columnEls[1].getAttribute('aria-label')).toBe('In Progress');
    });

    it('cards container has role="list"', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const cardsContainer = board.querySelector('[data-blok-database-cards]');

      expect(cardsContainer?.getAttribute('role')).toBe('list');
    });

    it('each card element has role="listitem"', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [
        makeRow({ id: 'row-1', position: 'a0' }),
        makeRow({ id: 'row-2', position: 'a1', properties: { title: 'Write tests' } }),
      ];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const cardEls = board.querySelectorAll('[data-blok-database-card]');

      expect(cardEls[0].getAttribute('role')).toBe('listitem');
      expect(cardEls[1].getAttribute('role')).toBe('listitem');
    });

    it('edit card button has a descriptive aria-label', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const editBtn = board.querySelector('[data-blok-database-edit-card]');

      expect(editBtn?.getAttribute('aria-label')).toBe('tools.database.editCardTitle');
    });

    it('add-card button has an aria-label', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const addCardBtn = board.querySelector('[data-blok-database-add-card]');

      expect(addCardBtn?.getAttribute('aria-label')).toBe('tools.database.addCard');
    });

    it('add-column button has an aria-label', () => {
      const view = new DatabaseBoardView({ readOnly: false, i18n, options: [], getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn?.getAttribute('aria-label')).toBe('tools.database.addColumn');
    });
  });

  describe('styling', () => {
    it('board area has flex-start alignment and gap between columns', () => {
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.alignItems).toBe('flex-start');
      expect(boardArea.style.gap).toBeTruthy();
    });

    it('board area has padding', () => {
      const view = new DatabaseBoardView({ readOnly: false, i18n, options: [], getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.paddingBottom).toBeTruthy();
    });

    it('board area has data-blok-database-board attribute for CSS alignment', () => {
      const view = new DatabaseBoardView({ readOnly: false, i18n, options: [], getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();
      const boardArea = board.querySelector('[data-blok-database-board]');

      expect(boardArea).not.toBeNull();
    });

    it('column element has flex column layout with minimum width', () => {
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const column = board.querySelector('[data-blok-database-column]') as HTMLElement;

      expect(column.style.display).toBe('flex');
      expect(column.style.flexDirection).toBe('column');
      expect(column.style.minWidth).toBeTruthy();
      expect(column.style.flex).toBe('0 0 260px');
    });

    it('column header has flex layout with padding and border-radius', () => {
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const header = board.querySelector('[data-blok-database-column-header]') as HTMLElement;

      expect(header.style.display).toBe('flex');
      expect(header.style.alignItems).toBe('center');
      expect(header.style.padding).toBeTruthy();
      expect(header.style.borderRadius).toBeTruthy();
    });

    it('column header has no top padding', () => {
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const header = board.querySelector('[data-blok-database-column-header]') as HTMLElement;

      expect(header.style.paddingTop).toBe('0px');
      expect(header.style.paddingRight).toBe('0px');
    });

    it('cards container has flex column layout with gap', () => {
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const container = board.querySelector('[data-blok-database-cards]') as HTMLElement;

      expect(container.style.display).toBe('flex');
      expect(container.style.flexDirection).toBe('column');
      expect(container.style.gap).toBeTruthy();
    });

    it('card element has padding, border-radius, and pointer cursor', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const card = board.querySelector('[data-blok-database-card]') as HTMLElement;

      expect(card.style.padding).toBeTruthy();
      expect(card.style.borderRadius).toBeTruthy();
      expect(card.style.cursor).toBe('pointer');
    });

    it('card element has position relative for action button positioning', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const card = board.querySelector('[data-blok-database-card]') as HTMLElement;

      expect(card.style.position).toBe('relative');
    });

    it('column title has no inline font-weight override (weight comes from CSS)', () => {
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const title = board.querySelector('[data-blok-database-column-title]') as HTMLElement;

      expect(title.style.fontWeight).toBe('');
    });

    it('column header has gap between title and delete button', () => {
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const header = board.querySelector('[data-blok-database-column-header]') as HTMLElement;

      expect(header.style.gap).toBeTruthy();
    });

    it('board area has vertical padding set inline', () => {
      const view = new DatabaseBoardView({ readOnly: false, i18n, options: [], getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.paddingTop).toBe('');
      expect(boardArea.style.paddingBottom).toBe('24px');
    });

    it('board area has updated gap of 12px', () => {
      const view = new DatabaseBoardView({ readOnly: false, i18n, options: [], getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.gap).toBe('12px');
    });

    it('cards container has updated gap of 8px', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const container = board.querySelector('[data-blok-database-cards]') as HTMLElement;

      expect(container.style.gap).toBe('8px');
    });

    it('cards container has padding-top of 6px', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const container = board.querySelector('[data-blok-database-cards]') as HTMLElement;

      expect(container.style.paddingTop).toBe('6px');
    });

    it('column element has min-width of 260px', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const column = board.querySelector('[data-blok-database-column]') as HTMLElement;

      expect(column.style.minWidth).toBe('260px');
    });

    it('card element has updated padding of 10px 12px', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const card = board.querySelector('[data-blok-database-card]') as HTMLElement;

      expect(card.style.padding).toBe('10px 12px');
    });

    it('card element has border-radius of 10px to match Notion', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const card = board.querySelector('[data-blok-database-card]') as HTMLElement;

      expect(card.style.borderRadius).toBe('10px');
    });

    it('applies Notion-style card background via --blok-database-card-bg token', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const card = board.querySelector('[data-blok-database-card]') as HTMLElement;

      expect(card.style.backgroundColor).toBe('var(--blok-database-card-bg)');
    });

    it('applies Notion-style card shadow via --blok-database-card-shadow token', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const card = board.querySelector('[data-blok-database-card]') as HTMLElement;

      expect(card.style.boxShadow).toBe('var(--blok-database-card-shadow)');
    });

    it('add-card button border color matches column color when color is defined', () => {
      const options = [makeOption({ id: 'opt-1', color: 'blue' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const addCardBtn = board.querySelector('[data-blok-database-add-card]') as HTMLElement;

      expect(addCardBtn.style.borderColor).toBe('color-mix(in srgb, var(--blok-color-blue-text) 30%, transparent)');
    });

    it('add-card button has no inline border color when column has no color', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const addCardBtn = board.querySelector('[data-blok-database-add-card]') as HTMLElement;

      expect(addCardBtn.style.borderColor).toBe('');
    });

    it('add-column button matches column width (260px) via flex', () => {
      const view = new DatabaseBoardView({ readOnly: false, i18n, options: [], getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      const addColBtn = board.querySelector('[data-blok-database-add-column]') as HTMLElement;

      expect(addColBtn.style.minWidth).toBe('260px');
      expect(addColBtn.style.flex).toBe('0 0 260px');
    });
  });

  describe('DOM update helpers', () => {
    it('appendRow adds a card element to a cards container', () => {
      const view = new DatabaseBoardView({ readOnly: false, i18n, options: [], getRows: () => [], titlePropertyId: 'title' });
      const container = document.createElement('div');
      const row = makeRow({ id: 'row-new', properties: { title: 'New card' } });

      view.appendRow(container, row);

      const cardEl = container.querySelector('[data-blok-database-card]');

      expect(cardEl).not.toBeNull();
      expect(cardEl?.getAttribute('data-row-id')).toBe('row-new');
    });

    it('removeRow removes a card element by data-row-id', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-rm' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      expect(board.querySelector('[data-row-id="row-rm"]')).not.toBeNull();

      view.removeRow(board, 'row-rm');

      expect(board.querySelector('[data-row-id="row-rm"]')).toBeNull();
    });

    it('appendGroup inserts a column before the add-column button', () => {
      const view = new DatabaseBoardView({ readOnly: false, i18n, options: [], getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();
      const newOption = makeOption({ id: 'opt-new', label: 'New Column' });

      view.appendGroup(board, newOption);

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls).toHaveLength(1);
      expect(columnEls[0].getAttribute('data-option-id')).toBe('opt-new');

      // Column should be before the add-column button
      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn).not.toBeNull();
      expect(columnEls[0].compareDocumentPosition(addColBtn!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('updateRowTitle updates the title text of a card by data-row-id', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Original' } })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      view.updateRowTitle(board, 'row-1', 'Updated title');

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.textContent).toBe('Updated title');
    });

    it('updateRowTitle falls back to cardTitlePlaceholder i18n key when title is empty', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Has title' } })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      view.updateRowTitle(board, 'row-1', '');

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.textContent).toBe('tools.database.cardTitlePlaceholder');
    });

    it('createView renders card with empty title using cardTitlePlaceholder i18n key', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: '' } })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.textContent).toBe('tools.database.cardTitlePlaceholder');
    });

    it('createView sets data-placeholder on card title when title is empty', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: '' } })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.hasAttribute('data-placeholder')).toBe(true);
    });

    it('createView does not set data-placeholder when card has a title', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'My Card' } })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.hasAttribute('data-placeholder')).toBe(false);
    });

    it('updateRowTitle adds data-placeholder when title is cleared', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Has title' } })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      view.updateRowTitle(board, 'row-1', '');

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.hasAttribute('data-placeholder')).toBe(true);
    });

    it('updateRowTitle removes data-placeholder when title is set', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: '' } })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      view.updateRowTitle(board, 'row-1', 'Now titled');

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.hasAttribute('data-placeholder')).toBe(false);
    });

    it('updateRowTitle does nothing when card id is not found', () => {
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Original' } })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
      const board = view.createView();

      view.updateRowTitle(board, 'nonexistent', 'New');

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.textContent).toBe('Original');
    });

    it('removeGroup removes a column element by data-option-id', () => {
      const options = [makeOption({ id: 'opt-del', position: 'a0' })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => [], titlePropertyId: 'title' });
      const board = view.createView();

      expect(board.querySelector('[data-option-id="opt-del"]')).not.toBeNull();

      view.removeGroup(board, 'opt-del');

      expect(board.querySelector('[data-option-id="opt-del"]')).toBeNull();
    });
  });
});

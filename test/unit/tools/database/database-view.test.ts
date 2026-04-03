import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseView } from '../../../../src/tools/database/database-view';
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

describe('DatabaseView', () => {
  let i18n: I18n;

  beforeEach(() => {
    vi.clearAllMocks();
    i18n = createMockI18n();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createBoard', () => {
    it('renders wrapper with data-blok-tool="database" attribute', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => [], 'title');

      expect(board.getAttribute('data-blok-tool')).toBe('database');
    });

    it('renders one [data-blok-database-column] per column', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [
        makeOption({ id: 'opt-1', position: 'a0' }),
        makeOption({ id: 'opt-2', label: 'In Progress', position: 'a1' }),
        makeOption({ id: 'opt-3', label: 'Done', position: 'a2' }),
      ];
      const board = view.createBoard(options, () => [], 'title');

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls).toHaveLength(3);
    });

    it('renders [data-blok-database-card] elements inside columns', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [
        makeRow({ id: 'row-1', position: 'a0' }),
        makeRow({ id: 'row-2', position: 'a1', properties: { title: 'Write tests' } }),
      ];
      const board = view.createBoard(options, () => rows, 'title');

      const cardEls = board.querySelectorAll('[data-blok-database-card]');

      expect(cardEls).toHaveLength(2);
    });

    it('renders [data-blok-database-add-card] button in each column when NOT read-only', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [
        makeOption({ id: 'opt-1', position: 'a0' }),
        makeOption({ id: 'opt-2', label: 'Done', position: 'a1' }),
      ];
      const board = view.createBoard(options, () => [], 'title');

      const addCardBtns = board.querySelectorAll('[data-blok-database-add-card]');

      expect(addCardBtns).toHaveLength(2);
    });

    it('hides add-card button in read-only mode', () => {
      const view = new DatabaseView({ readOnly: true, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const board = view.createBoard(options, () => [], 'title');

      const addCardBtns = board.querySelectorAll('[data-blok-database-add-card]');

      expect(addCardBtns).toHaveLength(0);
    });

    it('renders [data-blok-database-add-column] button when NOT read-only', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => [], 'title');

      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn).not.toBeNull();
    });

    it('hides add-column button in read-only mode', () => {
      const view = new DatabaseView({ readOnly: true, i18n });
      const board = view.createBoard([], () => [], 'title');

      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn).toBeNull();
    });

    it('sets data-option-id on each column element', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [
        makeOption({ id: 'opt-alpha', position: 'a0' }),
        makeOption({ id: 'opt-beta', position: 'a1' }),
      ];
      const board = view.createBoard(options, () => [], 'title');

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls[0].getAttribute('data-option-id')).toBe('opt-alpha');
      expect(columnEls[1].getAttribute('data-option-id')).toBe('opt-beta');
    });

    it('sets data-row-id on each card element', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [
        makeRow({ id: 'row-x', position: 'a0' }),
        makeRow({ id: 'row-y', position: 'a1' }),
      ];
      const board = view.createBoard(options, () => rows, 'title');

      const cardEls = board.querySelectorAll('[data-blok-database-card]');

      expect(cardEls[0].getAttribute('data-row-id')).toBe('row-x');
      expect(cardEls[1].getAttribute('data-row-id')).toBe('row-y');
    });

    it('applies column color as background on the column element when color is defined', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1', color: 'green' })];
      const board = view.createBoard(options, () => [], 'title');

      const column = board.querySelector('[data-blok-database-column]') as HTMLElement;

      expect(column.style.backgroundColor).toBe('var(--blok-color-green-bg)');
    });

    it('does not apply column color when color is undefined', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const board = view.createBoard(options, () => [], 'title');

      const column = board.querySelector('[data-blok-database-column]') as HTMLElement;

      expect(column.style.backgroundColor).toBe('');
    });

    it('renders delete-card button on each card when NOT read-only', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const board = view.createBoard(options, () => rows, 'title');

      const deleteBtns = board.querySelectorAll('[data-blok-database-delete-card]');

      expect(deleteBtns).toHaveLength(1);
      expect(deleteBtns[0].getAttribute('data-row-id')).toBe('row-1');
      expect(deleteBtns[0].textContent).toBe('\u00d7');
    });

    it('does not render delete-card button in read-only mode', () => {
      const view = new DatabaseView({ readOnly: true, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const board = view.createBoard(options, () => rows, 'title');

      const deleteBtns = board.querySelectorAll('[data-blok-database-delete-card]');

      expect(deleteBtns).toHaveLength(0);
    });

    it('renders card count badge in each column header', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [
        makeRow({ id: 'row-1', position: 'a0' }),
        makeRow({ id: 'row-2', position: 'a1', properties: { title: 'Write tests' } }),
      ];
      const board = view.createBoard(options, () => rows, 'title');

      const countEl = board.querySelector('[data-blok-database-column-count]');

      expect(countEl).not.toBeNull();
      expect(countEl?.textContent).toBe('2');
    });

    it('renders card count badge as 0 for empty columns', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const board = view.createBoard(options, () => [], 'title');

      const countEl = board.querySelector('[data-blok-database-column-count]');

      expect(countEl).not.toBeNull();
      expect(countEl?.textContent).toBe('0');
    });

    it('prefixes add-card button text with +', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const board = view.createBoard(options, () => [], 'title');

      const addCardBtn = board.querySelector('[data-blok-database-add-card]');

      expect(addCardBtn?.textContent).toMatch(/^\+ /);
    });

    it('prefixes add-column button text with +', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => [], 'title');

      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn?.textContent).toMatch(/^\+ /);
    });

    it('renders colored dot in column header when color is defined', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1', color: 'blue' })];
      const board = view.createBoard(options, () => [], 'title');

      const dot = board.querySelector('[data-blok-database-column-dot]') as HTMLElement;

      expect(dot).not.toBeNull();
      expect(dot.style.backgroundColor).toBe('var(--blok-color-blue-text)');
    });

    it('does not render dot when color is undefined', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const board = view.createBoard(options, () => [], 'title');

      const dot = board.querySelector('[data-blok-database-column-dot]');

      expect(dot).toBeNull();
    });

    it('renders column header pill element', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const board = view.createBoard(options, () => [], 'title');

      const pill = board.querySelector('[data-blok-database-column-pill]');

      expect(pill).not.toBeNull();
    });

    it('does not render empty placeholder', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const board = view.createBoard(options, () => [], 'title');

      const placeholder = board.querySelector('[data-blok-database-empty-placeholder]');

      expect(placeholder).toBeNull();
    });

    it('wraps columns inside a board area element ([data-blok-database-board])', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const board = view.createBoard(options, () => [], 'title');

      const boardArea = board.querySelector('[data-blok-database-board]');

      expect(boardArea).not.toBeNull();

      const column = boardArea!.querySelector('[data-blok-database-column]');

      expect(column).not.toBeNull();
    });
  });

  describe('accessibility', () => {
    it('board element has role="region" and aria-label="Kanban board"', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => [], 'title');

      expect(board.getAttribute('role')).toBe('region');
      expect(board.getAttribute('aria-label')).toBe('Kanban board');
    });

    it('each column element has role="group"', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [
        makeOption({ id: 'opt-1', position: 'a0' }),
        makeOption({ id: 'opt-2', label: 'In Progress', position: 'a1' }),
      ];
      const board = view.createBoard(options, () => [], 'title');

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls[0].getAttribute('role')).toBe('group');
      expect(columnEls[1].getAttribute('role')).toBe('group');
    });

    it('each column has aria-label set to the option label', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [
        makeOption({ id: 'opt-1', label: 'To Do', position: 'a0' }),
        makeOption({ id: 'opt-2', label: 'In Progress', position: 'a1' }),
      ];
      const board = view.createBoard(options, () => [], 'title');

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls[0].getAttribute('aria-label')).toBe('To Do');
      expect(columnEls[1].getAttribute('aria-label')).toBe('In Progress');
    });

    it('cards container has role="list"', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const board = view.createBoard(options, () => [], 'title');

      const cardsContainer = board.querySelector('[data-blok-database-cards]');

      expect(cardsContainer?.getAttribute('role')).toBe('list');
    });

    it('each card element has role="listitem"', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [
        makeRow({ id: 'row-1', position: 'a0' }),
        makeRow({ id: 'row-2', position: 'a1', properties: { title: 'Write tests' } }),
      ];
      const board = view.createBoard(options, () => rows, 'title');

      const cardEls = board.querySelectorAll('[data-blok-database-card]');

      expect(cardEls[0].getAttribute('role')).toBe('listitem');
      expect(cardEls[1].getAttribute('role')).toBe('listitem');
    });

    it('delete card button has a descriptive aria-label', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const board = view.createBoard(options, () => rows, 'title');

      const deleteBtn = board.querySelector('[data-blok-database-delete-card]');

      expect(deleteBtn?.getAttribute('aria-label')).toBe('tools.database.deleteCard');
    });

    it('add-card button has an aria-label', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const board = view.createBoard(options, () => [], 'title');

      const addCardBtn = board.querySelector('[data-blok-database-add-card]');

      expect(addCardBtn?.getAttribute('aria-label')).toBe('tools.database.addCard');
    });

    it('add-column button has an aria-label', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => [], 'title');

      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn?.getAttribute('aria-label')).toBe('tools.database.addColumn');
    });
  });

  describe('styling', () => {
    it('board area has flex-start alignment and gap between columns', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const board = view.createBoard(options, () => [], 'title');

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.alignItems).toBe('flex-start');
      expect(boardArea.style.gap).toBeTruthy();
    });

    it('board area has padding', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => [], 'title');

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.paddingTop).toBeTruthy();
    });

    it('board area has data-blok-database-board attribute for CSS alignment', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => [], 'title');
      const boardArea = board.querySelector('[data-blok-database-board]');

      expect(boardArea).not.toBeNull();
    });

    it('column element has flex column layout with minimum width', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const board = view.createBoard(options, () => [], 'title');

      const column = board.querySelector('[data-blok-database-column]') as HTMLElement;

      expect(column.style.display).toBe('flex');
      expect(column.style.flexDirection).toBe('column');
      expect(column.style.minWidth).toBeTruthy();
      expect(column.style.flex).toBe('0 0 260px');
    });

    it('column header has flex layout with padding and border-radius', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const board = view.createBoard(options, () => [], 'title');

      const header = board.querySelector('[data-blok-database-column-header]') as HTMLElement;

      expect(header.style.display).toBe('flex');
      expect(header.style.alignItems).toBe('center');
      expect(header.style.padding).toBeTruthy();
      expect(header.style.borderRadius).toBeTruthy();
    });

    it('cards container has flex column layout with gap', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const board = view.createBoard(options, () => [], 'title');

      const container = board.querySelector('[data-blok-database-cards]') as HTMLElement;

      expect(container.style.display).toBe('flex');
      expect(container.style.flexDirection).toBe('column');
      expect(container.style.gap).toBeTruthy();
    });

    it('card element has padding, border-radius, and pointer cursor', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const board = view.createBoard(options, () => rows, 'title');

      const card = board.querySelector('[data-blok-database-card]') as HTMLElement;

      expect(card.style.padding).toBeTruthy();
      expect(card.style.borderRadius).toBeTruthy();
      expect(card.style.cursor).toBe('pointer');
    });

    it('card element has position relative for delete button positioning', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const board = view.createBoard(options, () => rows, 'title');

      const card = board.querySelector('[data-blok-database-card]') as HTMLElement;

      expect(card.style.position).toBe('relative');
    });

    it('delete card button is positioned absolutely in top-right corner', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const board = view.createBoard(options, () => rows, 'title');

      const deleteBtn = board.querySelector('[data-blok-database-delete-card]') as HTMLElement;

      expect(deleteBtn.style.position).toBe('absolute');
      expect(deleteBtn.style.top).toBeTruthy();
      expect(deleteBtn.style.right).toBeTruthy();
    });

    it('column title has font-weight semibold', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const board = view.createBoard(options, () => [], 'title');

      const title = board.querySelector('[data-blok-database-column-title]') as HTMLElement;

      expect(title.style.fontWeight).toBe('600');
    });

    it('column header has gap between title and delete button', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1', position: 'a0' })];
      const board = view.createBoard(options, () => [], 'title');

      const header = board.querySelector('[data-blok-database-column-header]') as HTMLElement;

      expect(header.style.gap).toBeTruthy();
    });

    it('board area has vertical padding set inline', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => [], 'title');

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.paddingTop).toBe('6px');
      expect(boardArea.style.paddingBottom).toBe('24px');
    });

    it('board area has updated gap of 12px', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => [], 'title');

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.gap).toBe('12px');
    });

    it('cards container has updated gap of 8px', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const board = view.createBoard(options, () => [], 'title');

      const container = board.querySelector('[data-blok-database-cards]') as HTMLElement;

      expect(container.style.gap).toBe('8px');
    });

    it('cards container has padding-top of 6px', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const board = view.createBoard(options, () => [], 'title');

      const container = board.querySelector('[data-blok-database-cards]') as HTMLElement;

      expect(container.style.paddingTop).toBe('6px');
    });

    it('column element has min-width of 260px', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const board = view.createBoard(options, () => [], 'title');

      const column = board.querySelector('[data-blok-database-column]') as HTMLElement;

      expect(column.style.minWidth).toBe('260px');
    });

    it('card element has updated padding of 10px 12px', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const board = view.createBoard(options, () => rows, 'title');

      const card = board.querySelector('[data-blok-database-card]') as HTMLElement;

      expect(card.style.padding).toBe('10px 12px');
    });

    it('card element has border-radius of 8px', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1' })];
      const board = view.createBoard(options, () => rows, 'title');

      const card = board.querySelector('[data-blok-database-card]') as HTMLElement;

      expect(card.style.borderRadius).toBe('8px');
    });

    it('add-column button matches column width (260px) via flex', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => [], 'title');

      const addColBtn = board.querySelector('[data-blok-database-add-column]') as HTMLElement;

      expect(addColBtn.style.minWidth).toBe('260px');
      expect(addColBtn.style.flex).toBe('0 0 260px');
    });
  });

  describe('DOM update helpers', () => {
    it('appendCard adds a card element to a cards container', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const container = document.createElement('div');
      const row = makeRow({ id: 'row-new', properties: { title: 'New card' } });

      view.appendCard(container, row, 'title');

      const cardEl = container.querySelector('[data-blok-database-card]');

      expect(cardEl).not.toBeNull();
      expect(cardEl?.getAttribute('data-row-id')).toBe('row-new');
    });

    it('removeCard removes a card element by data-row-id', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-rm' })];
      const board = view.createBoard(options, () => rows, 'title');

      expect(board.querySelector('[data-row-id="row-rm"]')).not.toBeNull();

      view.removeCard(board, 'row-rm');

      expect(board.querySelector('[data-row-id="row-rm"]')).toBeNull();
    });

    it('appendColumn inserts a column before the add-column button', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => [], 'title');
      const newOption = makeOption({ id: 'opt-new', label: 'New Column' });

      view.appendColumn(board, newOption);

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls).toHaveLength(1);
      expect(columnEls[0].getAttribute('data-option-id')).toBe('opt-new');

      // Column should be before the add-column button
      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn).not.toBeNull();
      expect(columnEls[0].compareDocumentPosition(addColBtn!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('updateCardTitle updates the title text of a card by data-row-id', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Original' } })];
      const board = view.createBoard(options, () => rows, 'title');

      view.updateCardTitle(board, 'row-1', 'Updated title');

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.textContent).toBe('Updated title');
    });

    it('updateCardTitle falls back to cardTitlePlaceholder i18n key when title is empty', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Has title' } })];
      const board = view.createBoard(options, () => rows, 'title');

      view.updateCardTitle(board, 'row-1', '');

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.textContent).toBe('tools.database.cardTitlePlaceholder');
    });

    it('createBoard renders card with empty title using cardTitlePlaceholder i18n key', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: '' } })];
      const board = view.createBoard(options, () => rows, 'title');

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.textContent).toBe('tools.database.cardTitlePlaceholder');
    });

    it('createBoard sets data-placeholder on card title when title is empty', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: '' } })];
      const board = view.createBoard(options, () => rows, 'title');

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.hasAttribute('data-placeholder')).toBe(true);
    });

    it('createBoard does not set data-placeholder when card has a title', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'My Card' } })];
      const board = view.createBoard(options, () => rows, 'title');

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.hasAttribute('data-placeholder')).toBe(false);
    });

    it('updateCardTitle adds data-placeholder when title is cleared', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Has title' } })];
      const board = view.createBoard(options, () => rows, 'title');

      view.updateCardTitle(board, 'row-1', '');

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.hasAttribute('data-placeholder')).toBe(true);
    });

    it('updateCardTitle removes data-placeholder when title is set', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: '' } })];
      const board = view.createBoard(options, () => rows, 'title');

      view.updateCardTitle(board, 'row-1', 'Now titled');

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.hasAttribute('data-placeholder')).toBe(false);
    });

    it('updateCardTitle does nothing when card id is not found', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Original' } })];
      const board = view.createBoard(options, () => rows, 'title');

      view.updateCardTitle(board, 'nonexistent', 'New');

      const titleEl = board.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(titleEl?.textContent).toBe('Original');
    });

    it('removeColumn removes a column element by data-option-id', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const options = [makeOption({ id: 'opt-del', position: 'a0' })];
      const board = view.createBoard(options, () => [], 'title');

      expect(board.querySelector('[data-option-id="opt-del"]')).not.toBeNull();

      view.removeColumn(board, 'opt-del');

      expect(board.querySelector('[data-option-id="opt-del"]')).toBeNull();
    });
  });
});

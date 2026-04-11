import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseView } from '../../../../src/tools/database/database-view';
import type { KanbanColumnData, KanbanCardData } from '../../../../src/tools/database/types';
import type { I18n } from '../../../../types';

const makeColumn = (overrides: Partial<KanbanColumnData> = {}): KanbanColumnData => ({
  id: 'col-1', title: 'To Do', position: 'a0', ...overrides,
});
const makeCard = (overrides: Partial<KanbanCardData> = {}): KanbanCardData => ({
  id: 'card-1', columnId: 'col-1', position: 'a0', title: 'Fix bug', ...overrides,
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
      const board = view.createBoard([], () => []);

      expect(board.getAttribute('data-blok-tool')).toBe('database');
    });

    it('renders one [data-blok-database-column] per column', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [
        makeColumn({ id: 'col-1', position: 'a0' }),
        makeColumn({ id: 'col-2', title: 'In Progress', position: 'a1' }),
        makeColumn({ id: 'col-3', title: 'Done', position: 'a2' }),
      ];
      const board = view.createBoard(columns, () => []);

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls).toHaveLength(3);
    });

    it('renders [data-blok-database-card] elements inside columns', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [
        makeCard({ id: 'card-1', columnId: 'col-1', position: 'a0' }),
        makeCard({ id: 'card-2', columnId: 'col-1', position: 'a1', title: 'Write tests' }),
      ];
      const board = view.createBoard(columns, () => cards);

      const cardEls = board.querySelectorAll('[data-blok-database-card]');

      expect(cardEls).toHaveLength(2);
    });

    it('renders [data-blok-database-add-card] button in each column when NOT read-only', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [
        makeColumn({ id: 'col-1', position: 'a0' }),
        makeColumn({ id: 'col-2', title: 'Done', position: 'a1' }),
      ];
      const board = view.createBoard(columns, () => []);

      const addCardBtns = board.querySelectorAll('[data-blok-database-add-card]');

      expect(addCardBtns).toHaveLength(2);
    });

    it('hides add-card button in read-only mode', () => {
      const view = new DatabaseView({ readOnly: true, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const board = view.createBoard(columns, () => []);

      const addCardBtns = board.querySelectorAll('[data-blok-database-add-card]');

      expect(addCardBtns).toHaveLength(0);
    });

    it('renders [data-blok-database-add-column] button when NOT read-only', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => []);

      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn).not.toBeNull();
    });

    it('hides add-column button in read-only mode', () => {
      const view = new DatabaseView({ readOnly: true, i18n });
      const board = view.createBoard([], () => []);

      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn).toBeNull();
    });

    it('sets data-column-id on each column element', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [
        makeColumn({ id: 'col-alpha', position: 'a0' }),
        makeColumn({ id: 'col-beta', position: 'a1' }),
      ];
      const board = view.createBoard(columns, () => []);

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls[0].getAttribute('data-column-id')).toBe('col-alpha');
      expect(columnEls[1].getAttribute('data-column-id')).toBe('col-beta');
    });

    it('sets data-card-id on each card element', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [
        makeCard({ id: 'card-x', columnId: 'col-1', position: 'a0' }),
        makeCard({ id: 'card-y', columnId: 'col-1', position: 'a1' }),
      ];
      const board = view.createBoard(columns, () => cards);

      const cardEls = board.querySelectorAll('[data-blok-database-card]');

      expect(cardEls[0].getAttribute('data-card-id')).toBe('card-x');
      expect(cardEls[1].getAttribute('data-card-id')).toBe('card-y');
    });

    it('applies column color as background on the column element when color is defined', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1', color: 'green' })];
      const board = view.createBoard(columns, () => []);

      const column = board.querySelector('[data-blok-database-column]') as HTMLElement;

      expect(column.style.backgroundColor).toBe('var(--blok-color-green-bg)');
    });

    it('does not apply column color when color is undefined', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const board = view.createBoard(columns, () => []);

      const column = board.querySelector('[data-blok-database-column]') as HTMLElement;

      expect(column.style.backgroundColor).toBe('');
    });

    it('renders delete-card button on each card when NOT read-only', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [makeCard({ id: 'card-1', columnId: 'col-1' })];
      const board = view.createBoard(columns, () => cards);

      const deleteBtns = board.querySelectorAll('[data-blok-database-delete-card]');

      expect(deleteBtns).toHaveLength(1);
      expect(deleteBtns[0].getAttribute('data-card-id')).toBe('card-1');
      expect(deleteBtns[0].textContent).toBe('\u00d7');
    });

    it('does not render delete-card button in read-only mode', () => {
      const view = new DatabaseView({ readOnly: true, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [makeCard({ id: 'card-1', columnId: 'col-1' })];
      const board = view.createBoard(columns, () => cards);

      const deleteBtns = board.querySelectorAll('[data-blok-database-delete-card]');

      expect(deleteBtns).toHaveLength(0);
    });

    it('renders card count badge in each column header', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [
        makeCard({ id: 'card-1', columnId: 'col-1', position: 'a0' }),
        makeCard({ id: 'card-2', columnId: 'col-1', position: 'a1', title: 'Write tests' }),
      ];
      const board = view.createBoard(columns, () => cards);

      const countEl = board.querySelector('[data-blok-database-column-count]');

      expect(countEl).not.toBeNull();
      expect(countEl?.textContent).toBe('2');
    });

    it('renders card count badge as 0 for empty columns', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const board = view.createBoard(columns, () => []);

      const countEl = board.querySelector('[data-blok-database-column-count]');

      expect(countEl).not.toBeNull();
      expect(countEl?.textContent).toBe('0');
    });

    it('prefixes add-card button text with +', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const board = view.createBoard(columns, () => []);

      const addCardBtn = board.querySelector('[data-blok-database-add-card]');

      expect(addCardBtn?.textContent).toMatch(/^\+ /);
    });

    it('prefixes add-column button text with +', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => []);

      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn?.textContent).toMatch(/^\+ /);
    });

    it('renders colored dot in column header when color is defined', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1', color: 'blue' })];
      const board = view.createBoard(columns, () => []);

      const dot = board.querySelector('[data-blok-database-column-dot]') as HTMLElement;

      expect(dot).not.toBeNull();
      expect(dot.style.backgroundColor).toBe('var(--blok-color-blue-text)');
    });

    it('does not render dot when color is undefined', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const board = view.createBoard(columns, () => []);

      const dot = board.querySelector('[data-blok-database-column-dot]');

      expect(dot).toBeNull();
    });

    it('renders column header pill element', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const board = view.createBoard(columns, () => []);

      const pill = board.querySelector('[data-blok-database-column-pill]');

      expect(pill).not.toBeNull();
    });

    it('does not render empty placeholder', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const board = view.createBoard(columns, () => []);

      const placeholder = board.querySelector('[data-blok-database-empty-placeholder]');

      expect(placeholder).toBeNull();
    });

    it('wraps columns inside a board area element ([data-blok-database-board])', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1', position: 'a0' })];
      const board = view.createBoard(columns, () => []);

      const boardArea = board.querySelector('[data-blok-database-board]');

      expect(boardArea).not.toBeNull();

      const column = boardArea!.querySelector('[data-blok-database-column]');

      expect(column).not.toBeNull();
    });
  });

  describe('accessibility', () => {
    it('board element has role="region" and aria-label="Kanban board"', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => []);

      expect(board.getAttribute('role')).toBe('region');
      expect(board.getAttribute('aria-label')).toBe('Kanban board');
    });

    it('each column element has role="group"', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [
        makeColumn({ id: 'col-1', position: 'a0' }),
        makeColumn({ id: 'col-2', title: 'In Progress', position: 'a1' }),
      ];
      const board = view.createBoard(columns, () => []);

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls[0].getAttribute('role')).toBe('group');
      expect(columnEls[1].getAttribute('role')).toBe('group');
    });

    it('each column has aria-label set to the column title', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [
        makeColumn({ id: 'col-1', title: 'To Do', position: 'a0' }),
        makeColumn({ id: 'col-2', title: 'In Progress', position: 'a1' }),
      ];
      const board = view.createBoard(columns, () => []);

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls[0].getAttribute('aria-label')).toBe('To Do');
      expect(columnEls[1].getAttribute('aria-label')).toBe('In Progress');
    });

    it('cards container has role="list"', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const board = view.createBoard(columns, () => []);

      const cardsContainer = board.querySelector('[data-blok-database-cards]');

      expect(cardsContainer?.getAttribute('role')).toBe('list');
    });

    it('each card element has role="listitem"', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [
        makeCard({ id: 'card-1', columnId: 'col-1', position: 'a0' }),
        makeCard({ id: 'card-2', columnId: 'col-1', position: 'a1', title: 'Write tests' }),
      ];
      const board = view.createBoard(columns, () => cards);

      const cardEls = board.querySelectorAll('[data-blok-database-card]');

      expect(cardEls[0].getAttribute('role')).toBe('listitem');
      expect(cardEls[1].getAttribute('role')).toBe('listitem');
    });

    it('delete card button has a descriptive aria-label', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [makeCard({ id: 'card-1', columnId: 'col-1' })];
      const board = view.createBoard(columns, () => cards);

      const deleteBtn = board.querySelector('[data-blok-database-delete-card]');

      expect(deleteBtn?.getAttribute('aria-label')).toBe('tools.database.deleteCard');
    });

    it('add-card button has an aria-label', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const board = view.createBoard(columns, () => []);

      const addCardBtn = board.querySelector('[data-blok-database-add-card]');

      expect(addCardBtn?.getAttribute('aria-label')).toBe('tools.database.addCard');
    });

    it('add-column button has an aria-label', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => []);

      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn?.getAttribute('aria-label')).toBe('tools.database.addColumn');
    });
  });

  describe('styling', () => {
    it('board area has flex-start alignment and gap between columns', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1', position: 'a0' })];
      const board = view.createBoard(columns, () => []);

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.alignItems).toBe('flex-start');
      expect(boardArea.style.gap).toBeTruthy();
    });

    it('board area has padding', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => []);

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.paddingTop).toBeTruthy();
    });

    it('board area has data-blok-database-board attribute for CSS alignment', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => []);
      const boardArea = board.querySelector('[data-blok-database-board]');

      expect(boardArea).not.toBeNull();
    });

    it('column element has flex column layout with minimum width', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1', position: 'a0' })];
      const board = view.createBoard(columns, () => []);

      const column = board.querySelector('[data-blok-database-column]') as HTMLElement;

      expect(column.style.display).toBe('flex');
      expect(column.style.flexDirection).toBe('column');
      expect(column.style.minWidth).toBeTruthy();
      expect(column.style.flex).toBe('0 0 260px');
    });

    it('column header has flex layout with padding and border-radius', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1', position: 'a0' })];
      const board = view.createBoard(columns, () => []);

      const header = board.querySelector('[data-blok-database-column-header]') as HTMLElement;

      expect(header.style.display).toBe('flex');
      expect(header.style.alignItems).toBe('center');
      expect(header.style.padding).toBeTruthy();
      expect(header.style.borderRadius).toBeTruthy();
    });

    it('cards container has flex column layout with gap', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1', position: 'a0' })];
      const board = view.createBoard(columns, () => []);

      const container = board.querySelector('[data-blok-database-cards]') as HTMLElement;

      expect(container.style.display).toBe('flex');
      expect(container.style.flexDirection).toBe('column');
      expect(container.style.gap).toBeTruthy();
    });

    it('card element has padding, border-radius, and pointer cursor', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [makeCard({ id: 'card-1', columnId: 'col-1' })];
      const board = view.createBoard(columns, () => cards);

      const card = board.querySelector('[data-blok-database-card]') as HTMLElement;

      expect(card.style.padding).toBeTruthy();
      expect(card.style.borderRadius).toBeTruthy();
      expect(card.style.cursor).toBe('pointer');
    });

    it('card element has position relative for delete button positioning', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [makeCard({ id: 'card-1', columnId: 'col-1' })];
      const board = view.createBoard(columns, () => cards);

      const card = board.querySelector('[data-blok-database-card]') as HTMLElement;

      expect(card.style.position).toBe('relative');
    });

    it('delete card button is positioned absolutely in top-right corner', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [makeCard({ id: 'card-1', columnId: 'col-1' })];
      const board = view.createBoard(columns, () => cards);

      const deleteBtn = board.querySelector('[data-blok-database-delete-card]') as HTMLElement;

      expect(deleteBtn.style.position).toBe('absolute');
      expect(deleteBtn.style.top).toBeTruthy();
      expect(deleteBtn.style.right).toBeTruthy();
    });

    it('column title has font-weight semibold', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1', position: 'a0' })];
      const board = view.createBoard(columns, () => []);

      const title = board.querySelector('[data-blok-database-column-title]') as HTMLElement;

      expect(title.style.fontWeight).toBe('600');
    });

    it('column header has gap between title and delete button', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1', position: 'a0' })];
      const board = view.createBoard(columns, () => []);

      const header = board.querySelector('[data-blok-database-column-header]') as HTMLElement;

      expect(header.style.gap).toBeTruthy();
    });

    it('board area has vertical padding set inline', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => []);

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.paddingTop).toBe('6px');
      expect(boardArea.style.paddingBottom).toBe('24px');
    });

    it('board area has updated gap of 12px', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => []);

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.gap).toBe('12px');
    });

    it('cards container has updated gap of 8px', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const board = view.createBoard(columns, () => []);

      const container = board.querySelector('[data-blok-database-cards]') as HTMLElement;

      expect(container.style.gap).toBe('8px');
    });

    it('cards container has padding-top of 6px', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const board = view.createBoard(columns, () => []);

      const container = board.querySelector('[data-blok-database-cards]') as HTMLElement;

      expect(container.style.paddingTop).toBe('6px');
    });

    it('column element has min-width of 260px', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const board = view.createBoard(columns, () => []);

      const column = board.querySelector('[data-blok-database-column]') as HTMLElement;

      expect(column.style.minWidth).toBe('260px');
    });

    it('card element has updated padding of 10px 12px', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [makeCard({ id: 'card-1', columnId: 'col-1' })];
      const board = view.createBoard(columns, () => cards);

      const card = board.querySelector('[data-blok-database-card]') as HTMLElement;

      expect(card.style.padding).toBe('10px 12px');
    });

    it('card element has border-radius of 8px', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [makeCard({ id: 'card-1', columnId: 'col-1' })];
      const board = view.createBoard(columns, () => cards);

      const card = board.querySelector('[data-blok-database-card]') as HTMLElement;

      expect(card.style.borderRadius).toBe('8px');
    });
  });

  describe('DOM update helpers', () => {
    it('appendCard adds a card element to a cards container', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const container = document.createElement('div');
      const card = makeCard({ id: 'card-new', title: 'New card' });

      view.appendCard(container, card);

      const cardEl = container.querySelector('[data-blok-database-card]');

      expect(cardEl).not.toBeNull();
      expect(cardEl?.getAttribute('data-card-id')).toBe('card-new');
    });

    it('removeCard removes a card element by data-card-id', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [makeCard({ id: 'card-rm', columnId: 'col-1' })];
      const board = view.createBoard(columns, () => cards);

      expect(board.querySelector('[data-card-id="card-rm"]')).not.toBeNull();

      view.removeCard(board, 'card-rm');

      expect(board.querySelector('[data-card-id="card-rm"]')).toBeNull();
    });

    it('appendColumn inserts a column before the add-column button', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => []);
      const newCol = makeColumn({ id: 'col-new', title: 'New Column' });

      view.appendColumn(board, newCol);

      const columnEls = board.querySelectorAll('[data-blok-database-column]');

      expect(columnEls).toHaveLength(1);
      expect(columnEls[0].getAttribute('data-column-id')).toBe('col-new');

      // Column should be before the add-column button
      const addColBtn = board.querySelector('[data-blok-database-add-column]');

      expect(addColBtn).not.toBeNull();
      expect(columnEls[0].compareDocumentPosition(addColBtn!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('updateCardTitle updates the title text of a card by data-card-id', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [makeCard({ id: 'card-1', columnId: 'col-1', title: 'Original' })];
      const board = view.createBoard(columns, () => cards);

      view.updateCardTitle(board, 'card-1', 'Updated title');

      const titleEl = board.querySelector('[data-card-id="card-1"] [data-blok-database-card-title]');

      expect(titleEl?.textContent).toBe('Updated title');
    });

    it('updateCardTitle falls back to i18n placeholder when title is empty', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [makeCard({ id: 'card-1', columnId: 'col-1', title: 'Has title' })];
      const board = view.createBoard(columns, () => cards);

      view.updateCardTitle(board, 'card-1', '');

      const titleEl = board.querySelector('[data-card-id="card-1"] [data-blok-database-card-title]');

      expect(titleEl?.textContent).toBe('tools.database.newPage');
    });

    it('updateCardTitle does nothing when card id is not found', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1' })];
      const cards = [makeCard({ id: 'card-1', columnId: 'col-1', title: 'Original' })];
      const board = view.createBoard(columns, () => cards);

      view.updateCardTitle(board, 'nonexistent', 'New');

      const titleEl = board.querySelector('[data-card-id="card-1"] [data-blok-database-card-title]');

      expect(titleEl?.textContent).toBe('Original');
    });

    it('removeColumn removes a column element by data-column-id', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-del', position: 'a0' })];
      const board = view.createBoard(columns, () => []);

      expect(board.querySelector('[data-column-id="col-del"]')).not.toBeNull();

      view.removeColumn(board, 'col-del');

      expect(board.querySelector('[data-column-id="col-del"]')).toBeNull();
    });
  });
});

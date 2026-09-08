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

/**
 * Every key maps to a distinct string, so a mutated key is visible in the DOM.
 * A pass-through mock cannot tell 'tools.database.addColumn' from a blank key
 * once the string is concatenated with a prefix.
 */
const createMockI18n = (): I18n => ({
  t: vi.fn((key: string) => `T(${key})`),
  has: vi.fn(() => true),
  getEnglishTranslation: vi.fn(() => ''),
  getLocale: vi.fn(() => 'en'),
});

const query = (root: ParentNode, selector: string): HTMLElement => {
  const node = root.querySelector(selector);

  if (!(node instanceof HTMLElement)) {
    throw new Error(`expected an HTMLElement for ${selector}`);
  }

  return node;
};

const idsOf = (root: ParentNode, selector: string, attribute: string): (string | null)[] =>
  Array.from(root.querySelectorAll(selector)).map((el) => el.getAttribute(attribute));

describe('DatabaseView — mutation coverage', () => {
  let i18n: I18n;

  beforeEach(() => {
    vi.clearAllMocks();
    i18n = createMockI18n();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('marker attribute values', () => {
    // Every data-blok-database-* marker is written with an EMPTY value. A selector
    // like [data-blok-database-card] matches on presence alone, so only reading
    // the value back distinguishes '' from a mutated payload.
    it('writes an empty value for every data-blok-database marker', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard(
        [makeColumn({ id: 'col-1', color: 'red' })],
        () => [makeCard({ id: 'card-1' })],
      );

      const area = query(board, '[data-blok-database-board]');
      const column = query(area, '[data-blok-database-column]');
      const header = query(column, '[data-blok-database-column-header]');
      const pill = query(header, '[data-blok-database-column-pill]');
      const cardsContainer = query(column, '[data-blok-database-cards]');
      const card = query(cardsContainer, '[data-blok-database-card]');

      expect({
        board: area.getAttribute('data-blok-database-board'),
        addColumn: query(area, '[data-blok-database-add-column]').getAttribute('data-blok-database-add-column'),
        column: column.getAttribute('data-blok-database-column'),
        header: header.getAttribute('data-blok-database-column-header'),
        pill: pill.getAttribute('data-blok-database-column-pill'),
        dot: query(pill, '[data-blok-database-column-dot]').getAttribute('data-blok-database-column-dot'),
        columnTitle: query(pill, '[data-blok-database-column-title]').getAttribute('data-blok-database-column-title'),
        columnCount: query(header, '[data-blok-database-column-count]').getAttribute('data-blok-database-column-count'),
        cards: cardsContainer.getAttribute('data-blok-database-cards'),
        addCard: query(column, '[data-blok-database-add-card]').getAttribute('data-blok-database-add-card'),
        card: card.getAttribute('data-blok-database-card'),
        cardTitle: query(card, '[data-blok-database-card-title]').getAttribute('data-blok-database-card-title'),
        deleteCard: query(card, '[data-blok-database-delete-card]').getAttribute('data-blok-database-delete-card'),
      }).toStrictEqual({
        board: '',
        addColumn: '',
        column: '',
        header: '',
        pill: '',
        dot: '',
        columnTitle: '',
        columnCount: '',
        cards: '',
        addCard: '',
        card: '',
        cardTitle: '',
        deleteCard: '',
      });
    });
  });

  describe('inline layout values', () => {
    // The values are the ones cssstyle reads back, not the ones assigned:
    // flex '1' normalises to '1 1 0%' and min-width '0' to '0px'.
    it('writes the exact inline layout values on wrapper, board area and cards container', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([makeColumn()], () => []);
      const area = query(board, '[data-blok-database-board]');
      const cardsContainer = query(area, '[data-blok-database-cards]');

      expect({
        wrapperDisplay: board.style.display,
        areaDisplay: area.style.display,
        areaOverflowX: area.style.overflowX,
        areaFlex: area.style.flex,
        areaMinWidth: area.style.minWidth,
        cardsMinHeight: cardsContainer.style.minHeight,
      }).toStrictEqual({
        wrapperDisplay: 'flex',
        areaDisplay: 'flex',
        areaOverflowX: 'auto',
        areaFlex: '1 1 0%',
        areaMinWidth: '0px',
        cardsMinHeight: '40px',
      });
    });
  });

  describe('translation keys', () => {
    it('labels the add-column and add-card buttons from their own keys', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([makeColumn()], () => []);

      expect({
        addColumn: query(board, '[data-blok-database-add-column]').textContent,
        addCard: query(board, '[data-blok-database-add-card]').textContent,
      }).toStrictEqual({
        addColumn: '+ T(tools.database.addColumn)',
        addCard: '+ T(tools.database.newPage)',
      });
    });

    it('falls back to the newPage key when a rendered card has an empty title', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([makeColumn()], () => [makeCard({ id: 'card-blank', title: '' })]);

      expect(query(board, '[data-card-id="card-blank"] [data-blok-database-card-title]').textContent)
        .toBe('T(tools.database.newPage)');
    });
  });

  describe('appendColumn', () => {
    it('appends at the end and never calls insertBefore when there is no add-column button', () => {
      const view = new DatabaseView({ readOnly: true, i18n });
      const board = view.createBoard([makeColumn({ id: 'col-existing' })], () => []);
      const area = query(board, '[data-blok-database-board]');
      // insertBefore(node, null) and appendChild(node) leave IDENTICAL DOM, so the
      // branch is only observable through which call the code makes.
      const insertBefore = vi.spyOn(area, 'insertBefore');

      view.appendColumn(board, makeColumn({ id: 'col-new', title: 'New Column' }));

      expect(insertBefore).not.toHaveBeenCalled();
      expect(idsOf(area, '[data-blok-database-column]', 'data-column-id')).toStrictEqual(['col-existing', 'col-new']);
      expect(area.lastElementChild?.getAttribute('data-column-id')).toBe('col-new');
    });

    it('appends a column that holds no cards', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => []);

      view.appendColumn(board, makeColumn({ id: 'col-new', title: 'New Column' }));

      const column = query(board, '[data-blok-database-column]');

      expect(query(column, '[data-blok-database-column-count]').textContent).toBe('0');
      expect(column.querySelectorAll('[data-blok-database-card]')).toHaveLength(0);
    });
  });

  describe('column count badge', () => {
    it('recounts the badge after appendCard and after removeCard', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard(
        [makeColumn({ id: 'col-1' })],
        () => [makeCard({ id: 'card-1' }), makeCard({ id: 'card-2', title: 'Second' })],
      );
      const cardsContainer = query(board, '[data-blok-database-cards]');
      const count = query(board, '[data-blok-database-column-count]');

      expect(count.textContent).toBe('2');

      view.appendCard(cardsContainer, makeCard({ id: 'card-3', title: 'Third' }));

      expect(idsOf(cardsContainer, '[data-blok-database-card]', 'data-card-id'))
        .toStrictEqual(['card-1', 'card-2', 'card-3']);
      expect(count.textContent).toBe('3');

      view.removeCard(board, 'card-2');

      expect(idsOf(cardsContainer, '[data-blok-database-card]', 'data-card-id'))
        .toStrictEqual(['card-1', 'card-3']);
      expect(count.textContent).toBe('2');
    });

    it('removes a card that has no cards container ancestor without recounting', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const wrapper = document.createElement('div');
      const orphan = document.createElement('div');

      orphan.setAttribute('data-card-id', 'orphan');
      wrapper.appendChild(orphan);

      expect(() => view.removeCard(wrapper, 'orphan')).not.toThrow();
      expect(wrapper.querySelector('[data-card-id="orphan"]')).toBeNull();
    });

    it('appends a card into a column that has no count badge', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const column = document.createElement('div');
      const cardsContainer = document.createElement('div');

      column.setAttribute('data-blok-database-column', '');
      cardsContainer.setAttribute('data-blok-database-cards', '');
      column.appendChild(cardsContainer);

      expect(() => view.appendCard(cardsContainer, makeCard({ id: 'card-1' }))).not.toThrow();
      expect(idsOf(cardsContainer, '[data-blok-database-card]', 'data-card-id')).toStrictEqual(['card-1']);
    });
  });

  describe('missing-node paths', () => {
    /*
     * Pins a real defect. `cardEl?.closest(...)` yields undefined when the card
     * is missing, and `undefined !== null` passes the guard, so
     * updateColumnCount(undefined) throws on `.closest`. Once the source uses
     * `?? null`, swap this for `.not.toThrow()`; the optional-chaining mutant
     * still dies, because it throws one line earlier on `.remove`.
     */
    it('pins current defect: removeCard with an unknown card id throws inside updateColumnCount', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([makeColumn({ id: 'col-1' })], () => [makeCard({ id: 'card-1' })]);
      let message = 'did not throw';

      try {
        view.removeCard(board, 'missing');
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      // Matched loosely on purpose: the engine owns the wording, we only own the
      // two nouns. Dropping the optional chain throws on `null` and `remove`.
      expect(message).toMatch(/undefined.*closest/);
      expect(board.querySelector('[data-card-id="card-1"]')).not.toBeNull();
    });

    it('leaves a card alone when it carries no title element', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const wrapper = document.createElement('div');
      const card = document.createElement('div');

      card.setAttribute('data-card-id', 'card-untitled');
      wrapper.appendChild(card);

      expect(() => view.updateCardTitle(wrapper, 'card-untitled', 'Renamed')).not.toThrow();
      expect(card.textContent).toBe('');
    });

    it('ignores removeColumn for an unknown column id', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([makeColumn({ id: 'col-1' })], () => []);

      expect(() => view.removeColumn(board, 'missing')).not.toThrow();
      expect(idsOf(board, '[data-blok-database-column]', 'data-column-id')).toStrictEqual(['col-1']);
    });
  });
});

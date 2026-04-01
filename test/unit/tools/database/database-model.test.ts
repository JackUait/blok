import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { KanbanData, KanbanColumnData, KanbanCardData } from '../../../../src/tools/database/types';
import { DatabaseModel } from '../../../../src/tools/database/database-model';

const makeColumn = (overrides: Partial<KanbanColumnData> = {}): KanbanColumnData => ({
  id: `col-${Math.random().toString(36).slice(2, 6)}`,
  title: 'Column',
  position: 'a0',
  ...overrides,
});

const makeCard = (overrides: Partial<KanbanCardData> = {}): KanbanCardData => ({
  id: `card-${Math.random().toString(36).slice(2, 6)}`,
  columnId: 'col-1',
  position: 'a0',
  title: 'Card',
  ...overrides,
});

const makeData = (overrides: Partial<KanbanData> = {}): KanbanData => ({
  columns: [],
  cardMap: {},
  ...overrides,
});

describe('DatabaseModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates model with default empty data (3 default columns)', () => {
      const model = new DatabaseModel();

      const columns = model.getOrderedColumns();

      expect(columns).toHaveLength(3);
      expect(columns[0].title).toBe('To Do');
      expect(columns[1].title).toBe('In Progress');
      expect(columns[2].title).toBe('Done');
      expect(columns[0].color).toBe('gray');
      expect(columns[2].color).toBe('green');
    });

    it('creates model from existing data', () => {
      const col = makeColumn({ id: 'col-1', title: 'Backlog', position: 'a0' });
      const card = makeCard({ id: 'card-1', columnId: 'col-1', position: 'a0', title: 'Task 1' });
      const data = makeData({
        columns: [col],
        cardMap: { 'card-1': card },
      });

      const model = new DatabaseModel(data);

      expect(model.getOrderedColumns()).toHaveLength(1);
      expect(model.getOrderedColumns()[0].title).toBe('Backlog');
      expect(model.getOrderedCards('col-1')).toHaveLength(1);
      expect(model.getOrderedCards('col-1')[0].title).toBe('Task 1');
    });

    it('snapshot returns deep copy (mutations do not leak)', () => {
      const model = new DatabaseModel();
      const snap1 = model.snapshot();

      snap1.columns[0].title = 'MUTATED';

      const snap2 = model.snapshot();

      expect(snap2.columns[0].title).not.toBe('MUTATED');
    });
  });

  describe('getOrderedCards()', () => {
    it('returns cards sorted by position', () => {
      const data = makeData({
        columns: [makeColumn({ id: 'col-1' })],
        cardMap: {
          'card-a': makeCard({ id: 'card-a', columnId: 'col-1', position: 'a2', title: 'Third' }),
          'card-b': makeCard({ id: 'card-b', columnId: 'col-1', position: 'a0', title: 'First' }),
          'card-c': makeCard({ id: 'card-c', columnId: 'col-1', position: 'a1', title: 'Second' }),
        },
      });

      const model = new DatabaseModel(data);
      const cards = model.getOrderedCards('col-1');

      expect(cards.map(c => c.title)).toEqual(['First', 'Second', 'Third']);
    });

    it('returns empty array for no cards', () => {
      const model = new DatabaseModel(makeData({
        columns: [makeColumn({ id: 'col-1' })],
      }));

      expect(model.getOrderedCards('col-1')).toEqual([]);
    });
  });

  describe('getOrderedColumns()', () => {
    it('returns columns sorted by position', () => {
      const data = makeData({
        columns: [
          makeColumn({ id: 'col-c', title: 'Third', position: 'a2' }),
          makeColumn({ id: 'col-a', title: 'First', position: 'a0' }),
          makeColumn({ id: 'col-b', title: 'Second', position: 'a1' }),
        ],
      });

      const model = new DatabaseModel(data);
      const columns = model.getOrderedColumns();

      expect(columns.map(c => c.title)).toEqual(['First', 'Second', 'Third']);
    });
  });

  describe('addCard()', () => {
    it('adds card to empty column', () => {
      const model = new DatabaseModel(makeData({
        columns: [makeColumn({ id: 'col-1' })],
      }));

      const card = model.addCard('col-1', 'New Card');

      expect(card.title).toBe('New Card');
      expect(card.columnId).toBe('col-1');
      expect(card.id).toBeTruthy();
      expect(model.getOrderedCards('col-1')).toHaveLength(1);
    });

    it('appends after existing cards with correct position ordering', () => {
      const model = new DatabaseModel(makeData({
        columns: [makeColumn({ id: 'col-1' })],
        cardMap: {
          'card-1': makeCard({ id: 'card-1', columnId: 'col-1', position: 'a0', title: 'Existing' }),
        },
      }));

      const newCard = model.addCard('col-1', 'Appended');
      const cards = model.getOrderedCards('col-1');

      expect(cards).toHaveLength(2);
      expect(cards[0].title).toBe('Existing');
      expect(cards[1].title).toBe('Appended');
      expect(newCard.position > 'a0').toBe(true);
    });
  });

  describe('moveCard()', () => {
    it('moves card to different column', () => {
      const model = new DatabaseModel(makeData({
        columns: [
          makeColumn({ id: 'col-1', position: 'a0' }),
          makeColumn({ id: 'col-2', position: 'a1' }),
        ],
        cardMap: {
          'card-1': makeCard({ id: 'card-1', columnId: 'col-1', position: 'a0', title: 'Mover' }),
        },
      }));

      model.moveCard('card-1', 'col-2', 'a0');

      expect(model.getOrderedCards('col-1')).toHaveLength(0);
      expect(model.getOrderedCards('col-2')).toHaveLength(1);
      expect(model.getOrderedCards('col-2')[0].columnId).toBe('col-2');
    });
  });

  describe('updateCard()', () => {
    it('updates card title', () => {
      const model = new DatabaseModel(makeData({
        columns: [makeColumn({ id: 'col-1' })],
        cardMap: {
          'card-1': makeCard({ id: 'card-1', columnId: 'col-1', title: 'Old Title' }),
        },
      }));

      model.updateCard('card-1', { title: 'New Title' });

      expect(model.getCard('card-1')?.title).toBe('New Title');
    });
  });

  describe('deleteCard()', () => {
    it('removes card from cardMap', () => {
      const model = new DatabaseModel(makeData({
        columns: [makeColumn({ id: 'col-1' })],
        cardMap: {
          'card-1': makeCard({ id: 'card-1', columnId: 'col-1' }),
        },
      }));

      model.deleteCard('card-1');

      expect(model.getCard('card-1')).toBeUndefined();
      expect(model.getOrderedCards('col-1')).toHaveLength(0);
    });
  });

  describe('addColumn()', () => {
    it('adds column with generated position', () => {
      const model = new DatabaseModel(makeData({
        columns: [makeColumn({ id: 'col-1', position: 'a0', title: 'Existing' })],
      }));

      const col = model.addColumn('New Column');

      expect(col.title).toBe('New Column');
      expect(col.id).toBeTruthy();
      const columns = model.getOrderedColumns();

      expect(columns).toHaveLength(2);
      expect(columns[1].title).toBe('New Column');
      expect(col.position > 'a0').toBe(true);
    });
  });

  describe('updateColumn()', () => {
    it('updates title and color', () => {
      const model = new DatabaseModel(makeData({
        columns: [makeColumn({ id: 'col-1', title: 'Old', color: 'gray' })],
      }));

      model.updateColumn('col-1', { title: 'New', color: 'blue' });

      const col = model.getColumn('col-1');

      expect(col?.title).toBe('New');
      expect(col?.color).toBe('blue');
    });
  });

  describe('moveColumn()', () => {
    it('updates column position (verify sort order changes)', () => {
      const model = new DatabaseModel(makeData({
        columns: [
          makeColumn({ id: 'col-a', title: 'Alpha', position: 'a0' }),
          makeColumn({ id: 'col-b', title: 'Beta', position: 'a1' }),
          makeColumn({ id: 'col-c', title: 'Gamma', position: 'a2' }),
        ],
      }));

      // Move Gamma to between Alpha and Beta
      model.moveColumn('col-c', 'a0V');

      const columns = model.getOrderedColumns();

      expect(columns.map(c => c.title)).toEqual(['Alpha', 'Gamma', 'Beta']);
    });
  });

  describe('deleteColumn()', () => {
    it('removes column AND cascades to delete its cards; returns deleted card IDs', () => {
      const model = new DatabaseModel(makeData({
        columns: [
          makeColumn({ id: 'col-1', position: 'a0' }),
          makeColumn({ id: 'col-2', position: 'a1' }),
        ],
        cardMap: {
          'card-1': makeCard({ id: 'card-1', columnId: 'col-1' }),
          'card-2': makeCard({ id: 'card-2', columnId: 'col-1' }),
          'card-3': makeCard({ id: 'card-3', columnId: 'col-2' }),
        },
      }));

      const deletedCardIds = model.deleteColumn('col-1');

      expect(deletedCardIds).toHaveLength(2);
      expect(deletedCardIds).toContain('card-1');
      expect(deletedCardIds).toContain('card-2');
      expect(model.getColumn('col-1')).toBeUndefined();
      expect(model.getOrderedColumns()).toHaveLength(1);
      expect(model.getCard('card-1')).toBeUndefined();
      expect(model.getCard('card-2')).toBeUndefined();
      // card-3 in col-2 should survive
      expect(model.getCard('card-3')).toBeDefined();
    });
  });

  describe('loadFromAdapter()', () => {
    it('replaces model state from flat cards array', () => {
      const model = new DatabaseModel();

      const columns: KanbanColumnData[] = [
        makeColumn({ id: 'col-x', title: 'Loaded', position: 'a0' }),
      ];
      const cards: KanbanCardData[] = [
        makeCard({ id: 'card-x', columnId: 'col-x', position: 'a0', title: 'Loaded Card' }),
        makeCard({ id: 'card-y', columnId: 'col-x', position: 'a1', title: 'Loaded Card 2' }),
      ];

      model.loadFromAdapter(columns, cards);

      // Default columns should be gone
      expect(model.getOrderedColumns()).toHaveLength(1);
      expect(model.getOrderedColumns()[0].title).toBe('Loaded');
      expect(model.getOrderedCards('col-x')).toHaveLength(2);
      expect(model.getOrderedCards('col-x')[0].title).toBe('Loaded Card');
    });
  });

  describe('positionBetween()', () => {
    it('generates key between two bounds', () => {
      const key = DatabaseModel.positionBetween('a0', 'a1');

      expect(key > 'a0').toBe(true);
      expect(key < 'a1').toBe(true);
    });

    it('generates first key with null bounds', () => {
      const key = DatabaseModel.positionBetween(null, null);

      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    });
  });

  describe('simple getters', () => {
    it('getCard returns card by id', () => {
      const card = makeCard({ id: 'card-1', columnId: 'col-1' });
      const model = new DatabaseModel(makeData({
        columns: [makeColumn({ id: 'col-1' })],
        cardMap: { 'card-1': card },
      }));

      expect(model.getCard('card-1')?.id).toBe('card-1');
      expect(model.getCard('nonexistent')).toBeUndefined();
    });

    it('getColumn returns column by id', () => {
      const model = new DatabaseModel(makeData({
        columns: [makeColumn({ id: 'col-1', title: 'Found' })],
      }));

      expect(model.getColumn('col-1')?.title).toBe('Found');
      expect(model.getColumn('nonexistent')).toBeUndefined();
    });

    it('getColumnCount returns number of columns', () => {
      const model = new DatabaseModel(makeData({
        columns: [
          makeColumn({ id: 'col-1' }),
          makeColumn({ id: 'col-2' }),
        ],
      }));

      expect(model.getColumnCount()).toBe(2);
    });
  });
});

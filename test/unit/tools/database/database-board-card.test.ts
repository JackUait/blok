import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseBoardView } from '../../../../src/tools/database/database-board-view';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition, SelectOption } from '../../../../src/tools/database/types';
import type { I18n } from '../../../../types';

const i18n = { t: (key: string) => key } as unknown as I18n;

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'status', name: 'Status', type: 'select', position: 'a1', config: { options: [] } },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a2' },
  { id: 'files', name: 'Files', type: 'files', position: 'a3' },
];

const boardView = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1', name: 'Board', type: 'board', position: 'a0', groupBy: 'status', sorts: [], filters: [], visibleProperties: [], ...overrides,
});

const options: SelectOption[] = [
  { id: 'o1', label: 'To do', position: 'a0' },
  { id: 'o2', label: 'Done', position: 'a1' },
];

const rows: Record<string, DatabaseRow[]> = {
  o1: [
    { id: 'r1', position: 'a0', properties: { title: 'One', notes: 'First note' } },
    { id: 'r2', position: 'a1', properties: { title: 'Two', notes: '' } },
  ],
  o2: [{ id: 'r3', position: 'a2', properties: { title: 'Three', files: [{ id: 'f1', url: 'https://example.com/a.png', name: 'a.png' }] } }],
};

const mount = (overrides: Partial<ConstructorParameters<typeof DatabaseBoardView>[0]> = {}): HTMLElement => {
  const board = new DatabaseBoardView({
    readOnly: false,
    i18n,
    options,
    getRows: (id) => rows[id] ?? [],
    titlePropertyId: 'title',
    view: boardView(),
    schema,
    bodyOf: () => [],
    locale: 'en-US',
    ...overrides,
  }).createView();

  document.body.appendChild(board);

  return board;
};

const card = (board: HTMLElement, rowId: string): HTMLElement => {
  const el = board.querySelector<HTMLElement>(`[data-blok-database-card][data-row-id="${rowId}"]`);

  if (el === null) {
    throw new Error(`no card ${rowId}`);
  }

  return el;
};

const key = (target: HTMLElement, name: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
};

describe('DatabaseBoardView card parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('properties on cards', () => {
    it('shows the view\'s visible properties and skips empty ones', () => {
      const board = mount({ view: boardView({ properties: [{ id: 'notes', visible: true }] }) });

      expect(card(board, 'r1').querySelector('[data-blok-database-card-property][data-property-id="notes"]')?.textContent).toContain('First note');
      expect(card(board, 'r2').querySelector('[data-blok-database-card-property]')).toBeNull();
    });

    it('marks each property with its wrap setting', () => {
      const board = mount({ view: boardView({ properties: [{ id: 'notes', visible: true, wrap: true }] }) });

      expect(card(board, 'r1').querySelector('[data-blok-database-card-property]')?.getAttribute('data-wrap')).toBe('true');
    });

    it('shows only the title when the board has no view settings, as before', () => {
      const board = mount({ view: undefined, schema: undefined });

      expect(card(board, 'r1').querySelector('[data-blok-database-card-property]')).toBeNull();
      expect(card(board, 'r1').querySelector('[data-blok-database-card-preview]')).toBeNull();
    });
  });

  describe('card size and preview', () => {
    it('marks the card size and sizes the columns by it', () => {
      const medium = mount();
      const mediumWidth = medium.querySelector<HTMLElement>('[data-blok-database-column]')?.style.minWidth;

      expect(medium.querySelector('[data-blok-database-board]')?.getAttribute('data-card-size')).toBe('medium');
      expect(mediumWidth).toBe('276px');
      document.body.innerHTML = '';

      const large = mount({ view: boardView({ cardSize: 'large' }) });

      expect(large.querySelector('[data-blok-database-board]')?.getAttribute('data-card-size')).toBe('large');
      expect(parseFloat(large.querySelector<HTMLElement>('[data-blok-database-column]')?.style.minWidth ?? '0')).toBeGreaterThan(276);
    });

    it('shows no preview until one is picked', () => {
      expect(mount().querySelector('[data-blok-database-card-preview]')).toBeNull();
    });

    it('shows a Files & media property as the preview, through the image gate', () => {
      const board = mount({ view: boardView({ cardPreview: 'property:files', fitImage: true }) });
      const img = card(board, 'r3').querySelector<HTMLImageElement>('[data-blok-database-card-preview] [data-blok-database-card-image]');

      expect(img?.getAttribute('src')).toBe('https://example.com/a.png');
      expect(card(board, 'r1').querySelector('[data-blok-database-card-preview]')?.hasAttribute('data-empty')).toBe(true);
      expect(board.querySelector('[data-blok-database-board]')?.hasAttribute('data-fit-image')).toBe(true);
    });

    it('drops an unsafe image URL', () => {
      const board = mount({
        view: boardView({ cardPreview: 'property:files' }),
        getRows: (id) => (id === 'o1' ? [{ id: 'r9', position: 'a0', properties: { title: 'X', files: 'javascript:alert(1)' } }] : []),
      });

      expect(card(board, 'r9').querySelector('[data-blok-database-card-preview]')?.hasAttribute('data-empty')).toBe(true);
      expect(card(board, 'r9').querySelector('[data-blok-database-card-image]')).toBeNull();
    });

    it('shows the page content preview from the row body', () => {
      const board = mount({
        view: boardView({ cardPreview: 'content' }),
        bodyOf: (rowId) => (rowId === 'r1' ? [{ type: 'paragraph', data: { text: 'Body text' } }] : []),
      });

      expect(card(board, 'r1').querySelector('[data-blok-database-card-preview]')?.textContent).toBe('Body text');
    });
  });

  describe('inline property edit', () => {
    it('edits a property in place without opening the card', () => {
      const onPropertyEdit = vi.fn();
      const board = mount({ view: boardView({ properties: [{ id: 'notes', visible: true }] }), onPropertyEdit });
      const opened = vi.fn();
      const property = card(board, 'r1').querySelector<HTMLElement>('[data-blok-database-card-property]');

      board.addEventListener('click', opened);
      property?.click();

      expect(onPropertyEdit).toHaveBeenCalledWith('r1', 'notes', property);
      expect(opened).not.toHaveBeenCalled();
    });

    it('opens the card instead when read-only', () => {
      const onPropertyEdit = vi.fn();
      const board = mount({ readOnly: true, view: boardView({ properties: [{ id: 'notes', visible: true }] }), onPropertyEdit });
      const opened = vi.fn();

      board.addEventListener('click', opened);
      card(board, 'r1').querySelector<HTMLElement>('[data-blok-database-card-property]')?.click();

      expect(onPropertyEdit).not.toHaveBeenCalled();
      expect(opened).toHaveBeenCalled();
    });
  });

  describe('keyboard', () => {
    it('makes one card tabbable and gives the cards their own keyboard', () => {
      const board = mount();
      const cards = [...board.querySelectorAll<HTMLElement>('[data-blok-database-card]')];

      expect(cards.map((c) => c.tabIndex)).toEqual([0, -1, -1]);
      expect([...board.querySelectorAll('[data-blok-database-cards]')].every((list) => list.hasAttribute('data-blok-keyboard-owner'))).toBe(true);
      // Only the card lists: editor keys such as undo still work elsewhere on the board.
      expect(board.querySelector('[data-blok-database-board]')?.hasAttribute('data-blok-keyboard-owner')).toBe(false);
    });

    it('moves down a column and across to the next column', () => {
      const board = mount();

      card(board, 'r1').focus();
      key(card(board, 'r1'), 'ArrowDown');
      expect(card(board, 'r2')).toHaveFocus();
      key(card(board, 'r2'), 'ArrowRight');
      expect(card(board, 'r3')).toHaveFocus();
      expect(card(board, 'r3').tabIndex).toBe(0);
      key(card(board, 'r3'), 'ArrowLeft');
      expect(card(board, 'r1')).toHaveFocus();
      key(card(board, 'r1'), 'ArrowUp');
      expect(card(board, 'r1')).toHaveFocus();
    });

    it('flips Left and Right in a right-to-left editor', () => {
      const board = mount();

      board.setAttribute('dir', 'rtl');
      card(board, 'r1').focus();
      key(card(board, 'r1'), 'ArrowLeft');
      expect(card(board, 'r3')).toHaveFocus();
    });

    it('opens a card on Enter', () => {
      const board = mount();
      const opened = vi.fn();

      board.addEventListener('click', opened);
      key(card(board, 'r2'), 'Enter');

      expect(opened).toHaveBeenCalledTimes(1);
      expect((opened.mock.calls[0][0] as MouseEvent).target).toBe(card(board, 'r2'));
    });
  });
});

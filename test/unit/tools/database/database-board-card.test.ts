import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseBoardView } from '../../../../src/tools/database/database-board-view';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition, SelectOption } from '../../../../src/tools/database/types';
import type { I18n } from '../../../../types';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { hover, shownHint } from './hint-harness';
import { IconPencilLine } from '../../../../src/components/icons';

const i18n = { t: (key: string) => key } as unknown as I18n;

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'status', name: 'Status', type: 'select', position: 'a1', config: { options: [] } },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a2' },
  { id: 'files', name: 'Files', type: 'files', position: 'a3' },
  { id: 'link', name: 'Link', type: 'url', position: 'a4' },
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
    { id: 'r1', position: 'a0', properties: { title: 'One', notes: 'First note', link: 'https://example.com' } },
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

    // research/35 §4: a card value hints its name, plus the description when there is one, left of the card.
    it('a value hints its name and description, or its name alone, after the hint delay', () => {
      destroyTooltip();
      vi.useFakeTimers();
      try {
        const board = mount({
          view: boardView({ properties: [{ id: 'notes', visible: true }, { id: 'link', visible: true }] }),
          schema: schema.map((p) => (p.id === 'notes' ? { ...p, description: 'Line one\nline two' } : p)),
        });
        const prop = (id: string): HTMLElement | null => card(board, 'r1').querySelector<HTMLElement>(`[data-blok-database-card-property][data-property-id="${id}"]`);

        expect(prop('notes')?.title).toBe('');
        hover(prop('notes'));
        vi.advanceTimersByTime(HINT_DELAY - 1);
        expect(shownHint()).toBeNull();
        vi.advanceTimersByTime(1);
        expect(shownHint()).toEqual({ text: 'NotesLine one\nline two', placement: 'left' });

        prop('notes')?.dispatchEvent(new MouseEvent('mouseleave'));
        vi.advanceTimersByTime(1000);
        hover(prop('link'));
        vi.advanceTimersByTime(HINT_DELAY);
        expect(shownHint()).toEqual({ text: 'Link', placement: 'left' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('in right-to-left text the value hint sits on the right, the inline-start side', () => {
      destroyTooltip();
      vi.useFakeTimers();
      try {
        const board = mount({ view: boardView({ properties: [{ id: 'notes', visible: true }] }) });

        board.style.direction = 'rtl';
        hover(card(board, 'r1').querySelector('[data-blok-database-card-property][data-property-id="notes"]'));
        vi.advanceTimersByTime(HINT_DELAY);
        expect(shownHint()?.placement).toBe('right');
      } finally {
        vi.useRealTimers();
      }
    });

    // research/20 §1d: a place keeps its own card; the property hint around it must not replace it.
    it('hovering a place value still shows the place card', () => {
      destroyTooltip();
      vi.useFakeTimers();
      try {
        const board = mount({
          view: boardView({ properties: [{ id: 'where', visible: true }] }),
          schema: [...schema, { id: 'where', name: 'Where', type: 'place', position: 'a5' }],
          getRows: () => [{ id: 'r1', position: 'a0', properties: { title: 'One', where: { name: 'Berlin', address: 'Germany' } } }],
        });
        const item = card(board, 'r1').querySelector<HTMLElement>('[data-blok-database-card-property][data-property-id="where"]');

        // The browser enters the item, then the cell inside it.
        hover(item);
        hover(item?.firstElementChild);
        vi.advanceTimersByTime(HINT_DELAY);
        expect(document.querySelector('[data-blok-testid="tooltip-content"] [data-blok-database-place-card]')).not.toBeNull();
        expect(document.querySelector('[data-blok-testid="tooltip-content"] [data-blok-database-header-hint]')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    // notion-spec-2 §21.7: a board card's checkbox shows the property name beside the box, checked or not.
    it('shows the property name beside a card checkbox', () => {
      const board = mount({
        view: boardView({ properties: [{ id: 'done', visible: true }] }),
        schema: [...schema, { id: 'done', name: 'Done', type: 'checkbox', position: 'a5' }],
        getRows: (): DatabaseRow[] => [{ id: 'r1', position: 'a0', properties: { title: 'One', done: true } }, { id: 'r2', position: 'a1', properties: { title: 'Two' } }],
      });

      for (const id of ['r1', 'r2']) {
        const cell = card(board, id).querySelector('[data-blok-database-cell="checkbox"]');

        expect(cell?.querySelector('[data-blok-database-checkbox-name]')?.textContent).toBe('Done');
        expect(cell?.querySelector('[data-blok-database-checkbox]')).not.toBeNull();
      }
    });

    // notion-spec-2 §21.7: a board card's file chip has the page glyph before the name.
    it('draws the file glyph in a card file chip', () => {
      const board = mount({ view: boardView({ properties: [{ id: 'files', visible: true }] }) });
      const chip = card(board, 'r3').querySelector('[data-blok-database-file-chip]');

      expect(chip?.firstElementChild?.hasAttribute('data-blok-database-file-chip-icon')).toBe(true);
      expect(chip?.textContent?.trim()).toBe('a.png');
    });

    // notion-spec-2 §21.7: a board card's URL hides the scheme and greys the path, as the table does.
    it('shows a card URL without its scheme, the path in its own span', () => {
      const board = mount({
        view: boardView({ properties: [{ id: 'link', visible: true }] }),
        getRows: () => [{ id: 'r1', position: 'a0', properties: { title: 'One', link: 'https://example.com/a/b' } }],
      });
      const link = card(board, 'r1').querySelector('[data-property-id="link"] [data-blok-database-cell-link]');

      expect(link?.textContent).toBe('example.com/a/b');
      expect(link?.querySelector('[data-blok-database-url-path]')?.textContent).toBe('/a/b');
      expect(link?.getAttribute('href')).toBe('https://example.com/a/b');
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

  // feel findings B08: Notion's card Edit is the small pencil on a line.
  it('draws the card Edit button with the pencil-on-a-line glyph', () => {
    const expected = document.createElement('div');

    expected.innerHTML = IconPencilLine;
    expect(card(mount(), 'r1').querySelector('[data-blok-database-edit-card]')?.innerHTML).toBe(expected.innerHTML);
  });

  // feel findings B16, research/12:54: the card buttons hint after the hint delay.
  it('hints Edit and the "•••" menu after the hint delay; the pencil hints Open in side peek while editing', () => {
    destroyTooltip();
    vi.useFakeTimers();
    try {
      const board = mount();
      const edit = card(board, 'r1').querySelector<HTMLElement>('[data-blok-database-edit-card]');
      const more = card(board, 'r1').querySelector<HTMLElement>('[data-blok-database-card-menu]');

      hover(edit);
      vi.advanceTimersByTime(HINT_DELAY - 1);
      expect(shownHint()).toBeNull();
      vi.advanceTimersByTime(1);
      expect(shownHint()?.text).toBe('tools.database.galleryCardEdit');
      edit?.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(HINT_DELAY);

      hover(more);
      vi.advanceTimersByTime(HINT_DELAY);
      expect(shownHint()?.text).toBe('tools.database.galleryCardMore');
      more?.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(HINT_DELAY);

      edit?.click();
      hover(edit);
      vi.advanceTimersByTime(HINT_DELAY);
      expect(shownHint()?.text).toBe('tools.page.openInSidePeek');
    } finally {
      vi.useRealTimers();
      destroyTooltip();
    }
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

    it('draws Small cards 180 and Large 320 wide, in 196 and 336 columns', () => {
      const small = mount({ view: boardView({ cardSize: 'small' }) });

      expect(small.querySelector<HTMLElement>('[data-blok-database-column]')?.style.minWidth).toBe('196px');
      document.body.innerHTML = '';
      expect(mount({ view: boardView({ cardSize: 'large' }) }).querySelector<HTMLElement>('[data-blok-database-column]')?.style.minWidth).toBe('336px');
    });

    it('shows no preview until one is picked', () => {
      expect(mount().querySelector('[data-blok-database-card-preview]')).toBeNull();
    });

    it('shows a Files & media property as the preview, through the image gate', () => {
      const board = mount({ view: boardView({ cardPreview: 'property:files', fitImage: true }) });
      const img = card(board, 'r3').querySelector<HTMLImageElement>('[data-blok-database-card-preview] [data-blok-database-card-image]');

      expect(img?.getAttribute('src')).toBe('https://example.com/a.png');
      expect(board.querySelector('[data-blok-database-board]')?.hasAttribute('data-fit-image')).toBe(true);
    });

    it('draws no preview area on a card whose Files & media property is empty (research/31 shot 51)', () => {
      const board = mount({ view: boardView({ cardPreview: 'property:files' }) });

      expect(card(board, 'r1').querySelector('[data-blok-database-card-preview]')).toBeNull();
      expect(card(board, 'r3').querySelector('[data-blok-database-card-preview]')).not.toBeNull();
    });

    it('drops an unsafe image URL', () => {
      const board = mount({
        view: boardView({ cardPreview: 'property:files' }),
        getRows: (id) => (id === 'o1' ? [{ id: 'r9', position: 'a0', properties: { title: 'X', files: 'javascript:alert(1)' } }] : []),
      });

      expect(card(board, 'r9').querySelector('[data-blok-database-card-preview]')?.hasAttribute('data-empty')).toBe(true);
      expect(card(board, 'r9').querySelector('[data-blok-database-card-image]')).toBeNull();
    });

    it('shows the row\'s own page cover over an image in the body', () => {
      const board = mount({
        view: boardView({ cardPreview: 'cover' }),
        getRows: (id) => (id === 'o1' ? [{ id: 'r1', position: 'a0', properties: { title: 'One' }, cover: 'https://example.com/page-cover.png' }] : []),
        bodyOf: () => [{ type: 'image', data: { url: 'https://example.com/body.png' } }],
      });

      expect(card(board, 'r1').querySelector('[data-blok-database-card-preview] [data-blok-database-card-image]')?.getAttribute('src'))
        .toBe('https://example.com/page-cover.png');
    });

    it('shows the page cover when the body has no image', () => {
      const board = mount({
        view: boardView({ cardPreview: 'cover' }),
        getRows: (id) => (id === 'o1' ? [{ id: 'r1', position: 'a0', properties: { title: 'One' }, cover: 'https://example.com/page-cover.png' }] : []),
      });
      const preview = card(board, 'r1').querySelector('[data-blok-database-card-preview]');

      expect(preview?.querySelector('[data-blok-database-card-image]')?.getAttribute('src')).toBe('https://example.com/page-cover.png');
      expect(preview?.hasAttribute('data-empty')).toBe(false);
    });

    it('falls back to the first body image when the row has no page cover', () => {
      const board = mount({
        view: boardView({ cardPreview: 'cover' }),
        bodyOf: (rowId) => (rowId === 'r1' ? [{ type: 'image', data: { url: 'https://example.com/body.png' } }] : []),
      });

      expect(card(board, 'r1').querySelector('[data-blok-database-card-image]')?.getAttribute('src')).toBe('https://example.com/body.png');
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

    // research/22 §3: a link on a card is followed; the card neither edits nor opens.
    it('a click on a url link follows it and edits nothing', () => {
      const onPropertyEdit = vi.fn();
      const board = mount({ view: boardView({ properties: [{ id: 'link', visible: true }] }), onPropertyEdit });
      const link = card(board, 'r1').querySelector<HTMLAnchorElement>('a[data-blok-database-cell-link]');
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });

      link?.dispatchEvent(event);

      expect(link?.href).toBe('https://example.com/');
      expect(event.defaultPrevented).toBe(false);
      expect(onPropertyEdit).not.toHaveBeenCalled();
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

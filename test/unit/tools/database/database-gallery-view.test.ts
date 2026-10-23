import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';

import { DatabaseGalleryView } from '../../../../src/tools/database/database-gallery-view';
import type { GalleryGroup, GalleryHandlers, DatabaseGalleryViewOptions } from '../../../../src/tools/database/database-gallery-view';
import type { BodyBlock } from '../../../../src/tools/database/row-body';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { hover, shownHint } from './hint-harness';

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'p-stage', name: 'Stage', type: 'select', position: 'a2', config: { options: [
    { id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' },
  ] } },
  { id: 'p-link', name: 'Link', type: 'url', position: 'a3' },
];

const row = (id: string, title: string, extra: DatabaseRow['properties'] = {}): DatabaseRow =>
  ({ id, position: id, properties: { 'p-title': title, ...extra } });

const galleryView = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1', name: 'Gallery', type: 'gallery', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...overrides,
});

const makeHandlers = (): GalleryHandlers => ({
  openRow: vi.fn(),
  addRow: vi.fn(),
  moveRow: vi.fn(),
  loadMore: vi.fn(),
});

const i18n = { t: (key: string) => key } as unknown as DatabaseGalleryViewOptions['i18n'];

const single = (rows: DatabaseRow[], total = rows.length): GalleryGroup[] => [{ key: '', label: '', rows, total }];

interface Mounted {
  root: HTMLElement;
  handlers: GalleryHandlers;
  view: DatabaseGalleryView;
}

const mount = (overrides: Partial<DatabaseGalleryViewOptions> = {}): Mounted => {
  const handlers = makeHandlers();
  const view = new DatabaseGalleryView({
    readOnly: false,
    i18n,
    view: galleryView(),
    schema,
    groups: single([row('r1', 'Alpha', { 'p-notes': 'first' }), row('r2', 'Bravo')]),
    grouped: false,
    titlePropertyId: 'p-title',
    bodyOf: () => [],
    handlers,
    ...overrides,
  });
  const root = view.createView();

  document.body.appendChild(root);

  return { root, handlers, view };
};

const cards = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-blok-database-gallery-card]')];
const titles = (root: HTMLElement): Array<string | null> =>
  cards(root).map((card) => card.querySelector('[data-blok-database-gallery-title]')?.textContent ?? null);

const rect = (el: HTMLElement, left: number, top: number, width = 100, height = 100): void => {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
  });
};

const pointer = (type: string, target: EventTarget, x: number, y: number): void => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
};

describe('DatabaseGalleryView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders one card per row, in view order, in a list', () => {
    const { root } = mount();

    expect(titles(root)).toEqual(['Alpha', 'Bravo']);
    expect(cards(root).map((card) => card.getAttribute('data-row-id'))).toEqual(['r1', 'r2']);
    expect(root.querySelector('[data-blok-database-gallery-grid]')?.getAttribute('role')).toBe('list');
    expect(cards(root)[0].getAttribute('role')).toBe('listitem');
  });

  it('marks the card size and fit image on the root', () => {
    const { root } = mount({ view: galleryView({ cardSize: 'large', fitImage: true }) });

    expect(root.getAttribute('data-card-size')).toBe('large');
    expect(root.hasAttribute('data-fit-image')).toBe(true);
    expect(mount().root.getAttribute('data-card-size')).toBe('medium');
    expect(mount().root.hasAttribute('data-fit-image')).toBe(false);
  });

  describe('card preview', () => {
    const image: BodyBlock = { type: 'image', data: { url: 'https://example.com/cover.png' } };
    const text: BodyBlock = { type: 'paragraph', data: { text: 'Body line' } };

    it('shows the page content by default', () => {
      const { root } = mount({ bodyOf: (rowId) => (rowId === 'r1' ? [text] : []) });
      const preview = cards(root)[0].querySelector('[data-blok-database-gallery-preview]');

      expect(preview?.getAttribute('data-preview')).toBe('content');
      expect(preview?.textContent).toBe('Body line');
    });

    it('shows the first image of the body as the cover', () => {
      const { root } = mount({ view: galleryView({ cardPreview: 'cover' }), bodyOf: () => [text, image] });
      const img = cards(root)[0].querySelector('img');

      expect(img?.getAttribute('src')).toBe('https://example.com/cover.png');
      expect(img?.getAttribute('alt')).toBe('');
    });

    it('shows the row\'s own page cover over an image in the body', () => {
      const { root } = mount({
        view: galleryView({ cardPreview: 'cover' }),
        groups: single([{ ...row('r1', 'Alpha'), cover: 'https://example.com/page-cover.png' }]),
        bodyOf: () => [text, image],
      });

      expect(cards(root)[0].querySelector('img')?.getAttribute('src')).toBe('https://example.com/page-cover.png');
    });

    it('shows the page cover when the body has no image', () => {
      const { root } = mount({
        view: galleryView({ cardPreview: 'cover' }),
        groups: single([{ ...row('r1', 'Alpha'), cover: 'https://example.com/page-cover.png' }]),
      });
      const preview = cards(root)[0].querySelector('[data-blok-database-gallery-preview]');

      expect(preview?.querySelector('img')?.getAttribute('src')).toBe('https://example.com/page-cover.png');
      expect(preview?.hasAttribute('data-empty')).toBe(false);
    });

    it('never loads a script URL page cover, and falls back to the body image', () => {
      const { root } = mount({
        view: galleryView({ cardPreview: 'cover' }),
        groups: single([{ ...row('r1', 'Alpha'), cover: 'javascript:alert(1)' }]),
        bodyOf: () => [image],
      });
      const imgs = [...cards(root)[0].querySelectorAll('img')];

      expect(imgs.map((img) => img.getAttribute('src'))).toEqual(['https://example.com/cover.png']);
    });

    it('shows a property value as the image', () => {
      const { root } = mount({
        view: galleryView({ cardPreview: 'property:p-link' }),
        groups: single([row('r1', 'Alpha', { 'p-link': 'https://example.com/p.png' })]),
      });

      expect(cards(root)[0].querySelector('img')?.getAttribute('src')).toBe('https://example.com/p.png');
    });

    it('reads the first file of a files value', () => {
      const { root } = mount({
        view: galleryView({ cardPreview: 'property:p-link' }),
        groups: single([row('r1', 'Alpha', { 'p-link': [{ name: 'a.png', url: 'https://example.com/f.png' }] as never })]),
      });

      expect(cards(root)[0].querySelector('img')?.getAttribute('src')).toBe('https://example.com/f.png');
    });

    it('never loads a script URL from a property as the image', () => {
      const { root } = mount({
        view: galleryView({ cardPreview: 'property:p-link' }),
        groups: single([row('r1', 'Alpha', { 'p-link': 'javascript:alert(1)' })]),
      });

      expect(cards(root)[0].querySelector('img')).toBeNull();
      expect(cards(root)[0].querySelector('[data-blok-database-gallery-preview]')?.hasAttribute('data-empty')).toBe(true);
    });

    it('keeps an empty preview box when the preview property is empty (research/08 empty gallery cover)', () => {
      const { root } = mount({
        view: galleryView({ cardPreview: 'property:p-link' }),
        groups: single([row('r1', 'Alpha', {})]),
      });

      expect(cards(root)[0].querySelector('[data-blok-database-gallery-preview]')?.hasAttribute('data-empty')).toBe(true);
    });

    it('leaves out the preview when set to none', () => {
      const { root } = mount({ view: galleryView({ cardPreview: 'none' }), bodyOf: () => [image] });

      expect(cards(root)[0].querySelector('[data-blok-database-gallery-preview]')).toBeNull();
    });

    it('draws an empty preview box when there is nothing to show', () => {
      const { root } = mount({ view: galleryView({ cardPreview: 'cover' }) });
      const preview = cards(root)[0].querySelector('[data-blok-database-gallery-preview]');

      expect(preview).not.toBeNull();
      expect(preview?.hasAttribute('data-empty')).toBe(true);
    });
  });

  it('hides the card name when the title property is hidden', () => {
    const { root } = mount({ view: galleryView({ properties: [{ id: 'p-title', visible: false }] }) });

    expect(cards(root)[0].querySelector('[data-blok-database-gallery-title]')).toBeNull();
    expect(cards(root)[0].getAttribute('aria-label')).toBe('Alpha');
  });

  it('shows the visible properties under the title, in view order, and wraps them on request', () => {
    const properties = [{ id: 'p-title', visible: true }, { id: 'p-stage', visible: true }, { id: 'p-notes', visible: true }];
    const { root } = mount({
      view: galleryView({ properties, wrapCells: true }),
      groups: single([row('r1', 'Alpha', { 'p-notes': 'first', 'p-stage': 'o-idea' })]),
    });
    const props = [...cards(root)[0].querySelectorAll<HTMLElement>('[data-blok-database-gallery-property]')];

    expect(props.map((p) => p.getAttribute('data-property-id'))).toEqual(['p-stage', 'p-notes']);
    expect(props.every((p) => p.getAttribute('data-wrap') === 'true')).toBe(true);
    expect(props[0].textContent).toBe('Idea');
  });

  // research/35 §4: a card value hints its name, plus the description when there is one, left of the card.
  describe('property value hints', () => {
    beforeEach(() => {
      destroyTooltip();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows the name and the description, or the name alone, after the hint delay', () => {
      const properties = [{ id: 'p-title', visible: true }, { id: 'p-stage', visible: true }, { id: 'p-notes', visible: true }];
      const { root } = mount({
        view: galleryView({ properties }),
        schema: schema.map((p) => (p.id === 'p-stage' ? { ...p, description: 'Where it is' } : p)),
        groups: single([row('r1', 'Alpha', { 'p-notes': 'first', 'p-stage': 'o-idea' })]),
      });
      const prop = (id: string): HTMLElement | null => cards(root)[0].querySelector<HTMLElement>(`[data-blok-database-gallery-property][data-property-id="${id}"]`);

      expect(prop('p-stage')?.title).toBe('');
      hover(prop('p-stage'));
      vi.advanceTimersByTime(HINT_DELAY - 1);
      expect(shownHint()).toBeNull();
      vi.advanceTimersByTime(1);
      expect(shownHint()).toEqual({ text: 'StageWhere it is', placement: 'left' });

      prop('p-stage')?.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(1000);
      hover(prop('p-notes'));
      vi.advanceTimersByTime(HINT_DELAY);
      expect(shownHint()).toEqual({ text: 'Notes', placement: 'left' });
    });
  });

  it('skips empty property values on a card', () => {
    const properties = [{ id: 'p-title', visible: true }, { id: 'p-notes', visible: true }];
    const { root } = mount({ view: galleryView({ properties }) });

    expect(cards(root)[1].querySelectorAll('[data-blok-database-gallery-property]')).toHaveLength(0);
  });

  it('opens a card on click and on Enter', () => {
    const { root, handlers } = mount();

    cards(root)[1].click();
    cards(root)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(handlers.openRow).toHaveBeenNthCalledWith(1, 'r2');
    expect(handlers.openRow).toHaveBeenNthCalledWith(2, 'r1');
  });

  // research/22 §3: a link on a card is followed; the card does not open.
  it('a click on a url link follows it and does not open the card', () => {
    const properties = [{ id: 'p-title', visible: true }, { id: 'p-link', visible: true }];
    const { root, handlers } = mount({
      view: galleryView({ properties }),
      groups: single([row('r1', 'Alpha', { 'p-link': 'https://example.com' })]),
    });
    const link = cards(root)[0].querySelector<HTMLAnchorElement>('a[data-blok-database-cell-link]');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    link?.dispatchEvent(event);

    expect(link?.href).toBe('https://example.com/');
    expect(event.defaultPrevented).toBe(false);
    expect(handlers.openRow).not.toHaveBeenCalled();
  });

  it('adds a row from the trailing "+ New" card', () => {
    const { root, handlers } = mount();
    const add = root.querySelector<HTMLElement>('[data-blok-database-gallery-new]');

    expect(add?.parentElement?.lastElementChild).toBe(add);
    // findings-listgallery L14: Notion's tile reads "New page".
    expect(add?.textContent?.trim()).toBe('tools.database.newPage');
    add?.click();

    expect(handlers.addRow).toHaveBeenCalledWith(null);
  });

  it('has no "+ New" card when read-only, and still opens cards', () => {
    const { root, handlers } = mount({ readOnly: true });

    expect(root.querySelector('[data-blok-database-gallery-new]')).toBeNull();
    cards(root)[0].click();
    expect(handlers.openRow).toHaveBeenCalledWith('r1');
  });

  it('draws one section per group, each with its own "+ New"', () => {
    const groups: GalleryGroup[] = [
      { key: 'o-idea', label: 'Idea', option: { id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' }, rows: [row('r1', 'Alpha')], total: 1 },
      { key: 'none', label: 'No Stage', rows: [row('r2', 'Bravo')], total: 1 },
    ];
    const { root, handlers } = mount({ groups, grouped: true });
    const sections = [...root.querySelectorAll<HTMLElement>('[data-blok-database-gallery-group]')];

    expect(sections.map((s) => s.getAttribute('data-group-key'))).toEqual(['o-idea', 'none']);
    expect(sections[0].querySelector('[data-blok-database-option-pill]')?.textContent).toBe('Idea');
    expect(sections[1].querySelector('[data-blok-database-gallery-group-label]')?.textContent).toBe('No Stage');
    sections[1].querySelector<HTMLElement>('[data-blok-database-gallery-new]')?.click();
    expect(handlers.addRow).toHaveBeenCalledWith('none');
  });

  it('offers "Load more" when the group holds more rows than it shows', () => {
    const { root, handlers } = mount({ groups: single([row('r1', 'Alpha')], 30) });
    const more = root.querySelector<HTMLElement>('[data-blok-database-gallery-load-more]');

    expect(more).not.toBeNull();
    more?.click();
    expect(handlers.loadMore).toHaveBeenCalledWith('');
    expect(mount().root.querySelector('[data-blok-database-gallery-load-more]')).toBeNull();
  });

  describe('drag to reorder', () => {
    const three = (): GalleryGroup[] => single([row('r1', 'Alpha'), row('r2', 'Bravo'), row('r3', 'Charlie')]);

    /** Three cards in one row: r1 at 0, r2 at 120, r3 at 240. */
    const layOut = (root: HTMLElement): HTMLElement[] => {
      const all = cards(root);

      all.forEach((card, i) => rect(card, i * 120, 0));

      return all;
    };

    it('moves a card after the card it is dropped on the far half of', () => {
      const { root, handlers } = mount({ groups: three() });
      const [first] = layOut(root);

      pointer('pointerdown', first, 10, 10);
      pointer('pointermove', document, 200, 10);
      pointer('pointermove', document, 210, 10);
      pointer('pointerup', document, 210, 10);

      expect(handlers.moveRow).toHaveBeenCalledWith({ rowId: 'r1', afterRowId: 'r2', beforeRowId: 'r3', groupKey: '', fromGroupKey: '' });
      expect(handlers.openRow).not.toHaveBeenCalled();
    });

    it('moves a card before the card it is dropped on the near half of, across rows', () => {
      const { root, handlers } = mount({ groups: three() });
      const all = cards(root);

      rect(all[0], 0, 0);
      rect(all[1], 120, 0);
      rect(all[2], 0, 120);
      pointer('pointerdown', all[2], 10, 130);
      pointer('pointermove', document, 130, 10);
      pointer('pointerup', document, 130, 10);

      expect(handlers.moveRow).toHaveBeenCalledWith({ rowId: 'r3', afterRowId: 'r1', beforeRowId: 'r2', groupKey: '', fromGroupKey: '' });
    });

    it('shows where the card will land while dragging and clears it after', () => {
      const { root } = mount({ groups: three() });
      const [first, , last] = layOut(root);

      pointer('pointerdown', first, 10, 10);
      pointer('pointermove', document, 250, 10);
      expect(last.getAttribute('data-drop')).toBe('before');
      expect(first.hasAttribute('data-dragging')).toBe(true);
      pointer('pointerup', document, 250, 10);
      expect(last.hasAttribute('data-drop')).toBe(false);
      expect(first.hasAttribute('data-dragging')).toBe(false);
    });

    it('drops a card into an empty group', () => {
      const groups: GalleryGroup[] = [
        { key: 'g1', label: 'One', rows: [row('r1', 'Alpha'), row('r2', 'Bravo')], total: 2 },
        { key: 'g2', label: 'Two', rows: [], total: 0 },
      ];
      const { root, handlers } = mount({ groups, grouped: true });
      const [first] = layOut(root);
      const empty = root.querySelector<HTMLElement>('[data-blok-database-gallery-grid][data-group-key="g2"]');

      if (empty === null) throw new Error('no empty grid');
      rect(empty, 0, 300, 600, 120);
      pointer('pointerdown', first, 10, 10);
      pointer('pointermove', document, 50, 340);
      expect(empty.getAttribute('data-drop')).toBe('inside');
      pointer('pointerup', document, 50, 340);

      expect(empty.hasAttribute('data-drop')).toBe(false);
      expect(handlers.moveRow).toHaveBeenCalledWith({ rowId: 'r1', afterRowId: null, beforeRowId: null, groupKey: 'g2', fromGroupKey: 'g1' });
    });

    it('cancels on Escape', () => {
      const { root, handlers } = mount({ groups: three() });
      const [first] = layOut(root);

      pointer('pointerdown', first, 10, 10);
      pointer('pointermove', document, 250, 10);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      pointer('pointerup', document, 250, 10);

      expect(handlers.moveRow).not.toHaveBeenCalled();
    });

    it('still opens the next clicked card after a drag that ended outside the gallery', async () => {
      const { root, handlers } = mount({ groups: three() });
      const [first, second] = layOut(root);

      pointer('pointerdown', first, 10, 10);
      pointer('pointermove', document, 900, 900);
      pointer('pointerup', document, 900, 900);
      await new Promise((resolve) => setTimeout(resolve, 0));
      second.click();

      expect(handlers.openRow).toHaveBeenCalledWith('r2');
    });

    it('treats a press without movement as a click', () => {
      const { root, handlers } = mount({ groups: three() });
      const [first] = layOut(root);

      pointer('pointerdown', first, 10, 10);
      pointer('pointerup', document, 11, 10);
      first.click();

      expect(handlers.moveRow).not.toHaveBeenCalled();
      expect(handlers.openRow).toHaveBeenCalledWith('r1');
    });

    it('does not drag in a sorted view (D7) or when read-only', () => {
      const sorted = mount({ groups: three(), view: galleryView({ sorts: [{ propertyId: 'p-title', direction: 'asc' }] }) });
      const [first] = layOut(sorted.root);

      pointer('pointerdown', first, 10, 10);
      pointer('pointermove', document, 250, 10);
      pointer('pointerup', document, 250, 10);
      expect(sorted.handlers.moveRow).not.toHaveBeenCalled();

      const readOnly = mount({ groups: three(), readOnly: true });
      const [card] = layOut(readOnly.root);

      pointer('pointerdown', card, 10, 10);
      pointer('pointermove', document, 250, 10);
      pointer('pointerup', document, 250, 10);
      expect(readOnly.handlers.moveRow).not.toHaveBeenCalled();
    });

    it('reports the drag as interacting until the drop', () => {
      const { root, view } = mount({ groups: three() });
      const [first] = layOut(root);

      pointer('pointerdown', first, 10, 10);
      pointer('pointermove', document, 250, 10);
      expect(view.interacting).toBe(true);
      pointer('pointerup', document, 250, 10);
      expect(view.interacting).toBe(false);
    });

    it('stops listening to the document once destroyed', () => {
      const { root, view, handlers } = mount({ groups: three() });
      const [first] = layOut(root);

      pointer('pointerdown', first, 10, 10);
      pointer('pointermove', document, 250, 10);
      view.destroy();
      pointer('pointerup', document, 250, 10);

      expect(handlers.moveRow).not.toHaveBeenCalled();
    });
  });

  describe('keyboard selection (research/16 §3a)', () => {
    const SELECTED = 'data-blok-database-row-selected';
    const four = (): GalleryGroup[] => single([row('r1', 'Alpha'), row('r2', 'Bravo'), row('r3', 'Charlie'), row('r4', 'Delta')]);
    const selected = (root: HTMLElement): string[] =>
      cards(root).filter((card) => card.hasAttribute(SELECTED)).map((card) => card.getAttribute('data-row-id') ?? '');

    /** Stands in for the tool: paints what it is told to select, as paintRowSelection does. */
    const mountSelectable = (overrides: Partial<DatabaseGalleryViewOptions> = {}): Mounted & {
      selectRows: Mock<(rowIds: string[]) => void>;
      pickRow: Mock<(rowId: string, range: boolean, order: string[]) => void>;
      renameRow: Mock<(rowId: string, title: string) => void>;
    } => {
      const paint = (ids: string[]): void => {
        document.querySelectorAll<HTMLElement>('[data-blok-database-gallery-card]').forEach((card) => {
          card.toggleAttribute(SELECTED, ids.includes(card.getAttribute('data-row-id') ?? ''));
        });
      };
      const selectRows = vi.fn<(rowIds: string[]) => void>(paint);
      const pickRow = vi.fn<(rowId: string, range: boolean, order: string[]) => void>();
      const renameRow = vi.fn<(rowId: string, title: string) => void>();
      const handlers: GalleryHandlers = { ...makeHandlers(), selectRows, pickRow, renameRow };
      const view = new DatabaseGalleryView({
        readOnly: false, i18n, view: galleryView(), schema, groups: four(), grouped: false, titlePropertyId: 'p-title',
        bodyOf: () => [], handlers, ...overrides,
      });
      const root = view.createView();

      document.body.appendChild(root);

      return { root, view, handlers, selectRows, pickRow, renameRow };
    };

    const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });

      target.dispatchEvent(event);

      return event;
    };

    it('owns its keyboard and can hold focus without being a tab stop', () => {
      const { root } = mountSelectable();

      expect(root.getAttribute('tabindex')).toBe('-1');
      expect(root.hasAttribute('data-blok-keyboard-owner')).toBe(true);
    });

    it('picks its own cards, so core leaves a Shift-click on a card to it', () => {
      const { root } = mountSelectable();

      expect(root.hasAttribute('data-blok-selection-owner')).toBe(true);
    });

    it('ArrowDown with nothing selected selects the first card; Down and Up move one card in reading order and stop at the ends', () => {
      const { root } = mountSelectable();

      press(root, 'ArrowDown');
      expect(selected(root)).toEqual(['r1']);
      press(root, 'ArrowDown');
      press(root, 'ArrowDown');
      expect(selected(root)).toEqual(['r3']);
      press(root, 'ArrowDown');
      press(root, 'ArrowDown');
      expect(selected(root)).toEqual(['r4']);
      press(root, 'ArrowUp');
      expect(selected(root)).toEqual(['r3']);
      press(root, 'ArrowUp');
      press(root, 'ArrowUp');
      press(root, 'ArrowUp');
      expect(selected(root)).toEqual(['r1']);
    });

    it('any arrow with nothing selected selects the first card', () => {
      for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp']) {
        const { root, view } = mountSelectable();

        press(root, key);
        expect(selected(root)).toEqual(['r1']);
        view.destroy();
        root.remove();
      }
    });

    it('moves across groups in reading order', () => {
      const groups: GalleryGroup[] = [
        { key: 'a', label: 'A', rows: [row('r1', 'Alpha')], total: 1 },
        { key: 'b', label: 'B', rows: [row('r2', 'Bravo')], total: 1 },
      ];
      const { root } = mountSelectable({ groups, grouped: true });

      press(root, 'ArrowDown');
      press(root, 'ArrowDown');
      expect(selected(root)).toEqual(['r2']);
    });

    it('Left and Right do nothing while a card is selected', () => {
      const { root, selectRows } = mountSelectable();

      press(root, 'ArrowDown');
      press(root, 'ArrowDown');
      selectRows.mockClear();

      const right = press(root, 'ArrowRight');
      const left = press(root, 'ArrowLeft');

      expect(selectRows).not.toHaveBeenCalled();
      expect(selected(root)).toEqual(['r2']);
      expect(right.defaultPrevented && left.defaultPrevented).toBe(true);
    });

    it('Shift+Up and Shift+Down extend the selection from where it started', () => {
      const { root } = mountSelectable();

      press(root, 'ArrowDown');
      press(root, 'ArrowDown');
      press(root, 'ArrowDown');
      press(root, 'ArrowUp', { shiftKey: true });
      expect(selected(root)).toEqual(['r2', 'r3']);
      press(root, 'ArrowUp', { shiftKey: true });
      expect(selected(root)).toEqual(['r1', 'r2', 'r3']);
      press(root, 'ArrowDown', { shiftKey: true });
      expect(selected(root)).toEqual(['r2', 'r3']);
    });

    it('resumes from the card selected last once the selection is cleared', () => {
      const { root, selectRows } = mountSelectable();

      press(root, 'ArrowDown');
      press(root, 'ArrowDown');
      selectRows([]);
      press(root, 'ArrowDown');

      expect(selected(root)).toEqual(['r2']);
    });

    it('Enter on the selected card renames its title in place, without opening it', () => {
      const { root, handlers, renameRow } = mountSelectable();

      press(root, 'ArrowDown');
      press(root, 'ArrowDown');
      press(root, 'Enter');

      const input = cards(root)[1].querySelector<HTMLInputElement>('input');

      expect(input).not.toBeNull();
      expect(input).toHaveFocus();
      expect(input?.value).toBe('Bravo');
      expect(input?.placeholder).toBe('tools.database.cardNamePlaceholder');
      expect(selected(root)).toEqual([]);
      expect(handlers.openRow).not.toHaveBeenCalled();

      if (input === null) return;
      input.value = 'Bravo 2';
      press(input, 'Enter');

      expect(renameRow).toHaveBeenCalledWith('r2', 'Bravo 2');
      expect(selected(root)).toEqual(['r2']);
      expect(root).toHaveFocus();
    });

    it('Escape from the rename keeps the title and selects the card again', () => {
      const { root, renameRow } = mountSelectable();

      press(root, 'ArrowDown');
      press(root, 'Enter');

      const input = cards(root)[0].querySelector<HTMLInputElement>('input');

      if (input === null) throw new Error('no rename input');
      input.value = 'Changed';
      press(input, 'Escape');

      expect(renameRow).not.toHaveBeenCalled();
      expect(titles(root)[0]).toBe('Alpha');
      expect(selected(root)).toEqual(['r1']);
      expect(root).toHaveFocus();
    });

    it('Enter with several cards selected opens the last one clicked, with no rename (research/22 §2)', () => {
      for (const [first, last] of [['r3', 'r1'], ['r1', 'r3']]) {
        const { root, view, handlers, pickRow } = mountSelectable();
        const click = (rowId: string): void => {
          cards(root).find((card) => card.getAttribute('data-row-id') === rowId)?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
        };

        pickRow.mockImplementation((rowId) => {
          const ids = new Set(selected(root));

          ids.add(rowId);
          cards(root).forEach((card) => card.toggleAttribute(SELECTED, ids.has(card.getAttribute('data-row-id') ?? '')));
        });
        click(first);
        click(last);
        const enter = press(root, 'Enter');

        expect(handlers.openRow).toHaveBeenCalledWith(last);
        expect(handlers.openRow).toHaveBeenCalledTimes(1);
        expect(enter.defaultPrevented).toBe(true);
        expect(root.querySelector('input')).toBeNull();
        view.destroy();
        root.remove();
      }
    });

    it('Home, End, PageUp and PageDown are left to the page scroll and keep the selection (research/22 §2)', () => {
      const { root, selectRows } = mountSelectable();

      press(root, 'ArrowDown');
      press(root, 'ArrowDown');
      selectRows.mockClear();

      for (const key of ['Home', 'End', 'PageUp', 'PageDown']) {
        expect(press(root, key).defaultPrevented).toBe(false);
      }
      expect(selectRows).not.toHaveBeenCalled();
      expect(selected(root)).toEqual(['r2']);
    });

    it('Enter does nothing while the card name is hidden', () => {
      const { root, handlers } = mountSelectable({ view: galleryView({ properties: [{ id: 'p-title', visible: false }] }) });

      press(root, 'ArrowDown');
      press(root, 'Enter');

      expect(root.querySelector('input')).toBeNull();
      expect(handlers.openRow).not.toHaveBeenCalled();
    });

    it('leaves undo and redo to the editor, which handles them after the gallery', () => {
      const { root } = mountSelectable();

      const undo = press(root, 'z', { metaKey: true });
      const redo = press(cards(root)[0], 'Z', { ctrlKey: true, shiftKey: true });

      expect(undo.defaultPrevented).toBe(false);
      expect(redo.defaultPrevented).toBe(false);
    });

    it('Space on a card does nothing, and still presses "+ New"', () => {
      const { root, handlers } = mountSelectable();

      press(root, 'ArrowDown');
      press(cards(root)[0], ' ');
      press(root, ' ');
      expect(handlers.openRow).not.toHaveBeenCalled();
      expect(root.querySelector('input')).toBeNull();

      const add = root.querySelector<HTMLElement>('[data-blok-database-gallery-new]');

      if (add === null) throw new Error('no + New');
      press(add, ' ');
      expect(handlers.addRow).toHaveBeenCalledWith(null);
    });

    it('Enter on a Tab-focused card still opens it', () => {
      const { root, handlers } = mountSelectable();

      cards(root)[2].focus();
      press(cards(root)[2], 'Enter');

      expect(handlers.openRow).toHaveBeenCalledWith('r3');
    });

    it('Cmd, Ctrl or Shift-click picks the card instead of opening it, in the order the cards are drawn', () => {
      const { root, handlers, pickRow } = mountSelectable();

      cards(root)[1].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
      cards(root)[3].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      cards(root)[0].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));

      expect(handlers.openRow).not.toHaveBeenCalled();
      expect(pickRow).toHaveBeenNthCalledWith(1, 'r2', false, ['r1', 'r2', 'r3', 'r4']);
      expect(pickRow).toHaveBeenNthCalledWith(2, 'r4', true, ['r1', 'r2', 'r3', 'r4']);
      expect(pickRow).toHaveBeenNthCalledWith(3, 'r1', false, ['r1', 'r2', 'r3', 'r4']);
    });

    it('a Cmd, Ctrl or Shift-click pick takes focus from the text, so Down moves the pick next (research/22 §2)', () => {
      for (const init of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }]) {
        const { root, view, pickRow } = mountSelectable();
        const text = document.createElement('div');

        text.contentEditable = 'true';
        document.body.appendChild(text);
        text.focus();
        pickRow.mockImplementation((rowId) => {
          cards(root).forEach((card) => card.toggleAttribute(SELECTED, card.getAttribute('data-row-id') === rowId));
        });

        cards(root)[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));

        expect(root).toHaveFocus();
        press(root, 'ArrowDown');
        expect(selected(root)).toEqual(['r3']);
        view.destroy();
        root.remove();
        text.remove();
      }
    });

    it('Enter after a single Shift, Cmd or Ctrl-click opens that card and never renames it (research/23 §8)', () => {
      for (const init of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }]) {
        const { root, view, handlers, pickRow } = mountSelectable();

        pickRow.mockImplementation((rowId) => {
          cards(root).forEach((card) => card.toggleAttribute(SELECTED, card.getAttribute('data-row-id') === rowId));
        });
        cards(root)[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
        const enter = press(document.activeElement instanceof HTMLElement ? document.activeElement : document.body, 'Enter');

        expect(root.querySelector('input')).toBeNull();
        expect(handlers.openRow).toHaveBeenCalledExactlyOnceWith('r2');
        expect(enter.defaultPrevented).toBe(true);
        view.destroy();
        root.remove();
      }
    });

    it('a Cmd-click pick moved on with the arrows is an arrow pick: Enter renames (research/16 §3a)', () => {
      const { root, handlers, pickRow } = mountSelectable();

      pickRow.mockImplementation((rowId) => {
        cards(root).forEach((card) => card.toggleAttribute(SELECTED, card.getAttribute('data-row-id') === rowId));
      });
      cards(root)[1].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
      press(root, 'ArrowDown');
      press(root, 'Enter');

      expect(cards(root)[2].querySelector('input')).not.toBeNull();
      expect(handlers.openRow).not.toHaveBeenCalled();
    });

    describe('closing a peek (research/23 §8)', () => {
      const openFromPick = (): ReturnType<typeof mountSelectable> => {
        const mounted = mountSelectable();

        mounted.pickRow.mockImplementation((rowId) => {
          cards(mounted.root).forEach((card) => card.toggleAttribute(SELECTED, card.getAttribute('data-row-id') === rowId));
        });
        cards(mounted.root)[1].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
        press(mounted.root, 'Enter');
        // The peek takes focus.
        document.body.focus();
        mounted.root.blur();

        return mounted;
      };

      it('a peek opened from a selection gives focus back to the gallery, so the first Down moves on', () => {
        const { root, view, handlers } = openFromPick();

        expect(handlers.openRow).toHaveBeenCalledExactlyOnceWith('r2');
        view.rowPageClosed();

        expect(root).toHaveFocus();
        expect(selected(root)).toEqual(['r2']);
        press(root, 'ArrowDown');
        expect(selected(root)).toEqual(['r3']);
        view.destroy();
        root.remove();
      });

      it('selects the cards again when the selection was cleared while the peek was open', () => {
        const { root, view, selectRows } = openFromPick();

        cards(root).forEach((card) => card.removeAttribute(SELECTED));
        view.rowPageClosed();

        expect(selectRows).toHaveBeenLastCalledWith(['r2']);
        expect(selected(root)).toEqual(['r2']);
        expect(root).toHaveFocus();
        view.destroy();
        root.remove();
      });

      it('a peek opened by a plain click selects nothing and takes no focus when it closes', () => {
        const { root, view, handlers, selectRows } = mountSelectable();

        cards(root)[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(handlers.openRow).toHaveBeenCalledExactlyOnceWith('r2');
        view.rowPageClosed();

        expect(selectRows).not.toHaveBeenCalled();
        expect(selected(root)).toEqual([]);
        expect(root).not.toHaveFocus();
        view.destroy();
        root.remove();
      });

      it('a plain click after a keyboard open forgets the selection it came from', () => {
        const { root, view, handlers, selectRows } = openFromPick();

        cards(root).forEach((card) => card.removeAttribute(SELECTED));
        selectRows.mockClear();
        cards(root)[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(handlers.openRow).toHaveBeenLastCalledWith('r3');
        view.rowPageClosed();

        expect(selectRows).not.toHaveBeenCalled();
        expect(root).not.toHaveFocus();
        view.destroy();
        root.remove();
      });
    });

    it('selects nothing without the selection handlers (read-only)', () => {
      const { root } = mount({ readOnly: true });

      press(root, 'ArrowDown');
      expect(selected(root)).toEqual([]);
      expect(root.hasAttribute('tabindex')).toBe(false);
    });
  });

  describe('card hover buttons (research/12 §3, research/16 §3a)', () => {
    const edit = (card: HTMLElement): HTMLElement | null => card.querySelector('[data-blok-database-edit-card]');
    const more = (card: HTMLElement): HTMLElement | null => card.querySelector('[data-blok-database-card-menu]');

    it('Tab goes card, Edit, then "Rename, delete, move to and more…", then the next card', () => {
      const { root } = mount();
      const stops = [...root.querySelectorAll<HTMLElement>('[tabindex], button')]
        .filter((el) => el.tabIndex >= 0)
        .map((el) => el.getAttribute('data-row-id') !== null && el.matches('[data-blok-database-gallery-card]')
          ? `card:${el.getAttribute('data-row-id')}`
          : el.getAttribute('aria-label'));

      expect(stops.slice(0, 6)).toEqual([
        'card:r1', 'tools.database.galleryCardEdit', 'tools.database.galleryCardMore',
        'card:r2', 'tools.database.galleryCardEdit', 'tools.database.galleryCardMore',
      ]);
    });

    it('Edit renames the card title in place, without opening it', () => {
      const renameRow = vi.fn();
      const { root, handlers } = mount({ handlers: { ...makeHandlers(), renameRow } });
      const button = edit(cards(root)[0]);

      button?.click();
      const input = cards(root)[0].querySelector<HTMLInputElement>('input');

      expect(input).toHaveFocus();
      expect(handlers.openRow).not.toHaveBeenCalled();
      if (input === null) return;
      input.value = 'Alpha 2';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(renameRow).toHaveBeenCalledWith('r1', 'Alpha 2');
    });

    it('"•••" and Enter on a focused button never open the card: the tool opens the row menu', () => {
      const { root, handlers } = mount();
      const button = more(cards(root)[0]);

      expect(button?.getAttribute('data-row-id')).toBe('r1');
      button?.click();
      button?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      expect(handlers.openRow).not.toHaveBeenCalled();
    });

    it('a press on a button never drags the card', () => {
      const { root, handlers } = mount();
      const button = more(cards(root)[0]);

      if (button === null) throw new Error('no ••• button');
      rect(cards(root)[1], 200, 0);
      pointer('pointerdown', button, 10, 10);
      pointer('pointermove', document, 250, 50);
      pointer('pointerup', document, 250, 50);

      expect(handlers.moveRow).not.toHaveBeenCalled();
    });

    it('has no Edit while the card name is hidden, and no buttons when read-only', () => {
      const hidden = mount({ view: galleryView({ properties: [{ id: 'p-title', visible: false }] }) });

      expect(edit(cards(hidden.root)[0])).toBeNull();
      expect(more(cards(hidden.root)[0])).not.toBeNull();
      hidden.root.remove();

      const { root } = mount({ readOnly: true });

      expect(root.querySelector('[data-blok-database-card-actions]')).toBeNull();
    });
  });

  it('updates a card title in place', () => {
    const { root, view } = mount();

    view.updateRowTitle(root, 'r2', 'Renamed');

    expect(titles(root)).toEqual(['Alpha', 'Renamed']);
  });
});

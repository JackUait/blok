import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DatabaseGalleryView } from '../../../../src/tools/database/database-gallery-view';
import type { GalleryGroup, GalleryHandlers, DatabaseGalleryViewOptions } from '../../../../src/tools/database/database-gallery-view';
import type { BodyBlock } from '../../../../src/tools/database/row-body';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

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

  it('adds a row from the trailing "+ New" card', () => {
    const { root, handlers } = mount();
    const add = root.querySelector<HTMLElement>('[data-blok-database-gallery-new]');

    expect(add?.parentElement?.lastElementChild).toBe(add);
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

    it('cancels on Escape', () => {
      const { root, handlers } = mount({ groups: three() });
      const [first] = layOut(root);

      pointer('pointerdown', first, 10, 10);
      pointer('pointermove', document, 250, 10);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      pointer('pointerup', document, 250, 10);

      expect(handlers.moveRow).not.toHaveBeenCalled();
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

  it('updates a card title in place', () => {
    const { root, view } = mount();

    view.updateRowTitle(root, 'r2', 'Renamed');

    expect(titles(root)).toEqual(['Alpha', 'Renamed']);
  });
});

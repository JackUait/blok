import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';
import { pageLayoutOf } from '../../../../src/tools/database/page-layout';
import type { PageLayoutOp } from '../../../../src/tools/database/page-layout';

vi.mock('../../../../src/blok', () => ({
  Blok: vi.fn(function stubBlok() {
    return {
      isReady: Promise.resolve(),
      save: vi.fn().mockResolvedValue({ blocks: [] }),
      destroy: vi.fn(),
    };
  }),
}));

const SCHEMA: PropertyDefinition[] = [
  { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
  { id: 'prop-owner', name: 'Owner', type: 'person', position: 'a1' },
  { id: 'prop-created', name: 'Created', type: 'createdTime', position: 'a2', date: { dateFormat: 'year_month_day', timeFormat: 'hidden' } },
  { id: 'prop-secret', name: 'Secret', type: 'text', position: 'a3', pageVisibility: 'hidden' },
  { id: 'prop-maybe', name: 'Maybe', type: 'text', position: 'a4', pageVisibility: 'hideWhenEmpty' },
  { id: 'prop-id', name: 'Code', type: 'uniqueId', position: 'a5' },
];

const ROW: DatabaseRow = {
  id: 'row-1',
  position: 'a0',
  properties: { 'prop-title': 'Card', 'prop-owner': [{ id: 'u1' }], 'prop-id': 4 },
  meta: { createdAt: new Date(2026, 9, 9, 12).getTime() },
};

const createOptions = (overrides: Partial<CardDrawerOptions> = {}): CardDrawerOptions => {
  const wrapper = document.createElement('div');

  document.body.appendChild(wrapper);

  return {
    wrapper,
    readOnly: false,
    titlePropertyId: 'prop-title',
    schema: SCHEMA,
    onTitleChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onClose: vi.fn(),
    onPropertyValueChange: vi.fn(),
    cellContext: () => ({ people: [{ id: 'u1', name: 'Ada Lovelace' }], locale: 'en-US' }),
    ...overrides,
  };
};

const valueOf = (options: CardDrawerOptions, propertyId: string): HTMLElement | null =>
  options.wrapper.querySelector<HTMLElement>(`[data-blok-database-drawer-prop-value][data-property-id="${propertyId}"]`);

describe('DatabaseCardDrawer — Phase 2 properties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows people by name from the host directory', () => {
    const options = createOptions();

    new DatabaseCardDrawer(options).open(ROW);

    expect(valueOf(options, 'prop-owner')?.textContent).toBe('Ada Lovelace');
  });

  it('shows the created time from row metadata in the property date format', () => {
    const options = createOptions();

    new DatabaseCardDrawer(options).open(ROW);

    expect(valueOf(options, 'prop-created')?.textContent).toBe('2026/10/09');
  });

  it('hides an always-hidden property, and a hide-when-empty one while it is empty', () => {
    const options = createOptions();

    new DatabaseCardDrawer(options).open(ROW);

    expect(valueOf(options, 'prop-secret')).toBeNull();
    expect(valueOf(options, 'prop-maybe')).toBeNull();
  });

  // research/09 §5b L91-92: one hidden property reads in the singular.
  it('reads 1 more property, then Hide 1 property', () => {
    const options = createOptions();

    new DatabaseCardDrawer(options).open({ ...ROW, properties: { ...ROW.properties, 'prop-maybe': 'x' } });
    const reveal = (): HTMLElement | null => options.wrapper.querySelector<HTMLElement>('[data-blok-database-drawer-hidden-props]');

    expect(reveal()?.textContent).toBe('1 more property');
    reveal()?.click();

    expect(reveal()?.textContent).toBe('Hide 1 property');
  });

  it('shows a hide-when-empty property once it has a value', () => {
    const options = createOptions();

    new DatabaseCardDrawer(options).open({ ...ROW, properties: { ...ROW.properties, 'prop-maybe': 'x' } });

    expect(valueOf(options, 'prop-maybe')?.textContent).toBe('x');
  });

  it('does not offer to edit a read-only property', () => {
    const options = createOptions();

    new DatabaseCardDrawer(options).open(ROW);

    expect(valueOf(options, 'prop-created')?.getAttribute('role')).toBeNull();
    expect(valueOf(options, 'prop-id')?.getAttribute('role')).toBeNull();
  });

  it('opens the property menu from a property label', () => {
    const onOpenPropertyMenu = vi.fn();
    const options = createOptions({ onOpenPropertyMenu });

    new DatabaseCardDrawer(options).open(ROW);
    const label = options.wrapper.querySelector<HTMLElement>('[data-blok-database-drawer-prop-label][data-property-id="prop-owner"]');

    label?.click();

    // No layout lever here, so the menu gets no Customize layout. It opens under the 160px label box (R07).
    expect(onOpenPropertyMenu).toHaveBeenCalledWith('prop-owner', label?.parentElement, undefined, {});
    expect(label?.parentElement?.hasAttribute('data-blok-database-drawer-prop-head')).toBe(true);
  });

  // feel/findings-rowpage R07: Comment shows for a filled value (Checkbox), not for an empty Number or Text (research/09:93).
  it('hands the property menu a Comment only for a filled value with the comment lever', () => {
    const onOpenPropertyMenu = vi.fn();
    const onCommentProperty = vi.fn();
    const options = createOptions({ onOpenPropertyMenu, onCommentProperty });

    new DatabaseCardDrawer(options).open(ROW);
    const labelOf = (id: string): HTMLElement | null => options.wrapper.querySelector<HTMLElement>(`[data-blok-database-drawer-prop-label][data-property-id="${id}"]`);

    labelOf('prop-owner')?.click();
    const extras = onOpenPropertyMenu.mock.calls.at(-1)?.[3] as { onComment?: () => void };

    extras.onComment?.();
    expect(onCommentProperty).toHaveBeenCalledWith('row-1', 'prop-owner', valueOf(options, 'prop-owner'));

    labelOf('prop-created')?.click();
    labelOf('prop-id')?.click();
    expect(onOpenPropertyMenu.mock.calls.at(-1)?.[3]).toHaveProperty('onComment');
  });

  // A rename from the row page menu shows on its label at once.
  it('a new schema renames the open page labels in place', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);

    drawer.open(ROW);
    drawer.setSchema(SCHEMA.map((p) => (p.id === 'prop-owner' ? { ...p, name: 'Lead' } : p)));

    expect(options.wrapper.querySelector('[data-blok-database-drawer-prop-label][data-property-id="prop-owner"]')?.textContent).toBe('Lead');
  });

  it('hands no Comment for an empty value', () => {
    const onOpenPropertyMenu = vi.fn();
    const options = createOptions({ onOpenPropertyMenu, onCommentProperty: vi.fn() });

    new DatabaseCardDrawer(options).open({ ...ROW, properties: { 'prop-title': 'Card' } });
    options.wrapper.querySelector<HTMLElement>('[data-blok-database-drawer-prop-label][data-property-id="prop-owner"]')?.click();

    expect(onOpenPropertyMenu.mock.calls.at(-1)?.[3]).toEqual({});
  });

  // feel/findings-rowpage R13: a plus glyph, then "Add a property", with no typed "+".
  it('draws Add a property as a plus glyph and the words', () => {
    const options = createOptions({ i18n: { t: (key: string) => (key === 'tools.database.addProperty' ? '+ Add a property' : key) } as never });

    new DatabaseCardDrawer(options).open(ROW);
    const add = options.wrapper.querySelector<HTMLElement>('[data-blok-database-drawer-add-prop]');

    expect(add?.querySelector('svg')).not.toBeNull();
    expect(add?.textContent?.trim()).toBe('Add a property');
  });

  it('adds a property named in the name field', () => {
    const onAddProperty = vi.fn();
    const options = createOptions({ onAddProperty, hasPeople: true });

    new DatabaseCardDrawer(options).open(ROW);
    const add = options.wrapper.querySelector<HTMLElement>('[data-blok-database-drawer-add-prop]');

    expect(add?.textContent?.trim()).toBe('tools.database.addProperty');
    add?.click();
    const field = document.querySelector<HTMLInputElement>('[data-blok-database-property-name-input]');

    if (field === null) throw new Error('no name field');
    field.value = 'Reviewer';
    document.querySelector<HTMLElement>('[data-blok-database-property-type-option="person"]')?.click();

    expect(onAddProperty).toHaveBeenCalledWith('person', 'Reviewer');
  });
});

// feel/findings-rowpage R09: a property row's glyph turns into a ⋮⋮ handle on hover; dragging it reorders the page's properties.
describe('DatabaseCardDrawer — property drag handle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const rowOf = (options: CardDrawerOptions, id: string): HTMLElement => {
    const row = valueOf(options, id)?.closest<HTMLElement>('[data-blok-database-drawer-prop-row]');

    if (row === null || row === undefined) throw new Error(`no row ${id}`);

    return row;
  };

  it('drags Owner above Code and writes the new group order', () => {
    const onPageLayoutChange = vi.fn();
    const options = createOptions({ onPageLayoutChange });

    new DatabaseCardDrawer(options).open(ROW);
    ['prop-id', 'prop-created', 'prop-owner'].forEach((id, i) => {
      vi.spyOn(rowOf(options, id), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100 + i * 38, 600, 34));
    });
    const handle = rowOf(options, 'prop-owner').querySelector<HTMLElement>('[data-blok-database-drawer-prop-handle]');

    expect(handle?.getAttribute('aria-hidden')).toBe('true');
    handle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 190 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 10, clientY: 105 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 105 }));

    const op = onPageLayoutChange.mock.calls.at(-1)?.[0] as PageLayoutOp;
    const placements = op(pageLayoutOf(SCHEMA[0])).placements;

    expect(placements.map((p) => p.id).slice(0, 3)).toEqual(['prop-owner', 'prop-id', 'prop-created']);
    expect(placements.every((p) => p.place === 'group')).toBe(true);
  });

  it('a click on the handle opens the property menu, as Notion', () => {
    const onOpenPropertyMenu = vi.fn();
    const options = createOptions({ onOpenPropertyMenu, onPageLayoutChange: vi.fn() });

    new DatabaseCardDrawer(options).open(ROW);
    const handle = rowOf(options, 'prop-owner').querySelector<HTMLElement>('[data-blok-database-drawer-prop-handle]');

    handle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 190 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 190 }));
    handle?.click();

    expect(onOpenPropertyMenu).toHaveBeenCalledWith('prop-owner', handle?.parentElement, expect.any(Function), {});
  });

  it('has no handle when the page layout cannot change', () => {
    const options = createOptions();

    new DatabaseCardDrawer(options).open(ROW);

    expect(rowOf(options, 'prop-owner').querySelector('[data-blok-database-drawer-prop-handle]')).toBeNull();
  });
});

describe('DatabaseCardDrawer — page header and body start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
    // jsdom has no matchMedia; the emoji picker reads the theme from it.
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  const head = (options: CardDrawerOptions): HTMLElement | null => options.wrapper.querySelector<HTMLElement>('[data-blok-database-drawer-page-head]');

  // feel/findings-rowpage R10: Add icon · Add cover · Customize layout, each with its glyph.
  it('orders the hover row Add icon, Add cover, Customize layout, each with a glyph', () => {
    const options = createOptions({ onIconChange: vi.fn(), onCoverChange: vi.fn(), onPageLayoutChange: vi.fn() });

    new DatabaseCardDrawer(options).open(ROW);
    const buttons = [...(head(options)?.querySelectorAll<HTMLElement>(':scope > button') ?? [])];

    expect(buttons.map((b) => [...b.attributes].map((a) => a.name).find((n) => n.startsWith('data-blok-database-drawer-')))).toEqual([
      'data-blok-database-drawer-add-icon', 'data-blok-database-drawer-add-cover', 'data-blok-database-drawer-customize',
    ]);
    expect(buttons.every((b) => b.querySelector('svg') !== null)).toBe(true);
  });

  // feel/findings-rowpage R33: Add icon sets a random emoji at once.
  it('Add icon sets an emoji at once', async () => {
    const onIconChange = vi.fn();
    const options = createOptions({ onIconChange, i18n: { t: (key: string) => key, getLocale: () => 'en' } as never });

    new DatabaseCardDrawer(options).open(ROW);
    head(options)?.querySelector<HTMLElement>('[data-blok-database-drawer-add-icon]')?.click();
    await vi.waitFor(() => expect(onIconChange).toHaveBeenCalled());

    expect(onIconChange.mock.calls[0]?.[0]).toBe('row-1');
    expect(typeof onIconChange.mock.calls[0]?.[1]).toBe('string');
    expect(onIconChange.mock.calls[0]?.[1]).not.toBe('');
    await vi.waitFor(() => expect(document.querySelector('[data-blok-emoji-picker]')).not.toBeNull());
  });

  // feel/findings-rowpage R29: a file chip starts with the 20px page glyph, as in the table.
  it('draws the page glyph in a file chip', () => {
    const files: PropertyDefinition = { id: 'prop-files', name: 'Files', type: 'files', position: 'a9' };
    const options = createOptions({ schema: [...SCHEMA, files] });

    new DatabaseCardDrawer(options).open({ ...ROW, properties: { ...ROW.properties, 'prop-files': [{ id: 'f1', name: 'report.pdf', url: 'https://example.com/report.pdf' }] } });

    expect(valueOf(options, 'prop-files')?.querySelector('[data-blok-database-file-chip] > [data-blok-database-file-chip-icon]:first-child')).not.toBeNull();
  });

  // feel/findings-rowpage R25: the empty title reads "New page".
  it('the title placeholder is New page', () => {
    const options = createOptions({ i18n: { t: (key: string) => (key === 'tools.database.layoutNewPage' ? 'New page' : key) } as never });

    new DatabaseCardDrawer(options).open(ROW);

    expect(options.wrapper.querySelector<HTMLTextAreaElement>('[data-blok-database-drawer-title]')?.placeholder).toBe('New page');
  });

  // feel/findings-rowpage R24: Enter in the title scrolls the body's first block into view.
  it('Enter in the title scrolls the caret block into view', async () => {
    const block = document.createElement('div');
    const scroll = vi.fn();

    block.tabIndex = 0;
    block.scrollIntoView = scroll;
    const options = createOptions({
      rowBody: {
        attach: (_rowId, host) => {
          host.appendChild(block);

          return true;
        },
        detach: vi.fn(),
        start: () => block.focus(),
      },
    });

    new DatabaseCardDrawer(options).open(ROW);
    options.wrapper.querySelector('[data-blok-database-drawer-title]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((resolve) => {
      requestAnimationFrame(() => resolve(undefined));
    });

    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
  });
});

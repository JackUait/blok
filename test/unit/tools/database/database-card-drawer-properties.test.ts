import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';
import { pageLayoutOf } from '../../../../src/tools/database/page-layout';
import type { PageLayoutOp } from '../../../../src/tools/database/page-layout';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { hover, shownHint } from './hint-harness';

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

// A peek left open is closed by the next test's open, and that close's slide
// fallback timer can fire after the file's window is gone. Destroy each one.
const drawers: DatabaseCardDrawer[] = [];
const createDrawer = (options: CardDrawerOptions): DatabaseCardDrawer => {
  const drawer = new DatabaseCardDrawer(options);

  drawers.push(drawer);

  return drawer;
};

afterEach(() => {
  drawers.splice(0).forEach((drawer) => drawer.destroy());
});

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

    createDrawer(options).open(ROW);

    expect(valueOf(options, 'prop-owner')?.textContent).toBe('Ada Lovelace');
  });

  it('shows the created time from row metadata in the property date format', () => {
    const options = createOptions();

    createDrawer(options).open(ROW);

    expect(valueOf(options, 'prop-created')?.textContent).toBe('2026/10/09');
  });

  it('hides an always-hidden property, and a hide-when-empty one while it is empty', () => {
    const options = createOptions();

    createDrawer(options).open(ROW);

    expect(valueOf(options, 'prop-secret')).toBeNull();
    expect(valueOf(options, 'prop-maybe')).toBeNull();
  });

  // research/09 §5b L91-92: one hidden property reads in the singular.
  it('reads 1 more property, then Hide 1 property', () => {
    const options = createOptions();

    createDrawer(options).open({ ...ROW, properties: { ...ROW.properties, 'prop-maybe': 'x' } });
    const reveal = (): HTMLElement | null => options.wrapper.querySelector<HTMLElement>('[data-blok-database-drawer-hidden-props]');

    expect(reveal()?.textContent).toBe('1 more property');
    reveal()?.click();

    expect(reveal()?.textContent).toBe('Hide 1 property');
  });

  it('shows a hide-when-empty property once it has a value', () => {
    const options = createOptions();

    createDrawer(options).open({ ...ROW, properties: { ...ROW.properties, 'prop-maybe': 'x' } });

    expect(valueOf(options, 'prop-maybe')?.textContent).toBe('x');
  });

  it('does not offer to edit a read-only property', () => {
    const options = createOptions();

    createDrawer(options).open(ROW);

    expect(valueOf(options, 'prop-created')?.getAttribute('role')).toBeNull();
    expect(valueOf(options, 'prop-id')?.getAttribute('role')).toBeNull();
  });

  it('opens the property menu from a property label', () => {
    const onOpenPropertyMenu = vi.fn();
    const options = createOptions({ onOpenPropertyMenu });

    createDrawer(options).open(ROW);
    const label = options.wrapper.querySelector<HTMLElement>('[data-blok-database-drawer-prop-label][data-property-id="prop-owner"]');

    label?.click();

    // No layout lever here, so the menu gets no Customize layout. It opens under the 160px label box (R07).
    expect(onOpenPropertyMenu).toHaveBeenCalledWith('prop-owner', label?.parentElement, undefined, {});
    expect(label?.parentElement?.hasAttribute('data-blok-database-drawer-prop-head')).toBe(true);
  });

  // research/09 §3 L57: picking a type adds the property and switches to its Edit property panel.
  it('opens the Edit property panel under the new property after an add', () => {
    const onOpenPropertyMenu = vi.fn();
    const added: PropertyDefinition = { id: 'prop-new', name: 'Score', type: 'number', position: 'z9' };
    const onOpenAddProperty = vi.fn();
    const options = createOptions({ onOpenPropertyMenu, onOpenAddProperty });
    const drawer = createDrawer(options);

    onOpenAddProperty.mockImplementation((_anchor: HTMLElement, onAdded?: (id: string, ownSetup?: boolean) => void) => {
      drawer.refreshSchema([...SCHEMA, added]);
      onAdded?.('prop-new', false);
    });
    drawer.open(ROW);
    options.wrapper.querySelector<HTMLElement>('[data-blok-database-drawer-add-prop]')?.click();
    const head = options.wrapper.querySelector('[data-blok-database-drawer-prop-label][data-property-id="prop-new"]')?.parentElement;

    expect(head?.hasAttribute('data-blok-database-drawer-prop-head')).toBe(true);
    expect(onOpenPropertyMenu).toHaveBeenCalledWith('prop-new', head, undefined, { edit: true });
  });

  it('leaves a property that opens its own setup (Relation, AI Autofill) to it', () => {
    const onOpenPropertyMenu = vi.fn();
    const added: PropertyDefinition = { id: 'prop-new', name: 'Summary', type: 'text', position: 'z9' };
    const onOpenAddProperty = vi.fn();
    const options = createOptions({ onOpenPropertyMenu, onOpenAddProperty });
    const drawer = createDrawer(options);

    onOpenAddProperty.mockImplementation((_anchor: HTMLElement, onAdded?: (id: string, ownSetup?: boolean) => void) => {
      drawer.refreshSchema([...SCHEMA, added]);
      onAdded?.('prop-new', true);
    });
    drawer.open(ROW);
    options.wrapper.querySelector<HTMLElement>('[data-blok-database-drawer-add-prop]')?.click();

    expect(onOpenPropertyMenu).not.toHaveBeenCalled();
  });

  // feel/findings-rowpage R07: Comment shows for a filled value (Checkbox), not for an empty Number or Text (research/09:93).
  it('hands the property menu a Comment only for a filled value with the comment lever', () => {
    const onOpenPropertyMenu = vi.fn();
    const onCommentProperty = vi.fn();
    const options = createOptions({ onOpenPropertyMenu, onCommentProperty });

    createDrawer(options).open(ROW);
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
    const drawer = createDrawer(options);

    drawer.open(ROW);
    drawer.setSchema(SCHEMA.map((p) => (p.id === 'prop-owner' ? { ...p, name: 'Lead' } : p)));

    expect(options.wrapper.querySelector('[data-blok-database-drawer-prop-label][data-property-id="prop-owner"]')?.textContent).toBe('Lead');
  });

  // Show as Ring, chosen from the row page menu, draws there at once.
  it('a new schema redraws a value whose display changed, keeping its slot', () => {
    const schema: PropertyDefinition[] = [...SCHEMA, { id: 'prop-score', name: 'Score', type: 'number', position: 'a6' }];
    const options = createOptions({ schema });
    const drawer = createDrawer(options);

    drawer.open({ ...ROW, properties: { ...ROW.properties, 'prop-score': 40 } });
    const slot = valueOf(options, 'prop-score');

    expect(slot?.querySelector('[data-blok-database-number-ring]')).toBeNull();
    drawer.setSchema(schema.map((p) => (p.id === 'prop-score' ? { ...p, number: { showAs: 'ring' } } : p)));

    expect(valueOf(options, 'prop-score')).toBe(slot);
    expect(slot?.querySelector('[data-blok-database-number-ring]')).not.toBeNull();
  });

  it('hands no Comment for an empty value', () => {
    const onOpenPropertyMenu = vi.fn();
    const options = createOptions({ onOpenPropertyMenu, onCommentProperty: vi.fn() });

    createDrawer(options).open({ ...ROW, properties: { 'prop-title': 'Card' } });
    options.wrapper.querySelector<HTMLElement>('[data-blok-database-drawer-prop-label][data-property-id="prop-owner"]')?.click();

    expect(onOpenPropertyMenu.mock.calls.at(-1)?.[3]).toEqual({});
  });

  // feel/findings-rowpage R13: a plus glyph, then "Add a property", with no typed "+".
  it('draws Add a property as a plus glyph and the words', () => {
    const options = createOptions({ i18n: { t: (key: string) => (key === 'tools.database.addProperty' ? '+ Add a property' : key) } as never });

    createDrawer(options).open(ROW);
    const add = options.wrapper.querySelector<HTMLElement>('[data-blok-database-drawer-add-prop]');

    expect(add?.querySelector('svg')).not.toBeNull();
    expect(add?.textContent?.trim()).toBe('Add a property');
  });

  it('adds a property named in the name field', () => {
    const onAddProperty = vi.fn();
    const options = createOptions({ onAddProperty, hasPeople: true });

    createDrawer(options).open(ROW);
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

    createDrawer(options).open(ROW);
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

    createDrawer(options).open(ROW);
    const handle = rowOf(options, 'prop-owner').querySelector<HTMLElement>('[data-blok-database-drawer-prop-handle]');

    handle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 190 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 190 }));
    handle?.click();

    expect(onOpenPropertyMenu).toHaveBeenCalledWith('prop-owner', handle?.parentElement, expect.any(Function), {});
  });

  it('has no handle when the page layout cannot change', () => {
    const options = createOptions();

    createDrawer(options).open(ROW);

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

    createDrawer(options).open(ROW);
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

    createDrawer(options).open(ROW);
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

    createDrawer(options).open({ ...ROW, properties: { ...ROW.properties, 'prop-files': [{ id: 'f1', name: 'report.pdf', url: 'https://example.com/report.pdf' }] } });

    expect(valueOf(options, 'prop-files')?.querySelector('[data-blok-database-file-chip] > [data-blok-database-file-chip-icon]:first-child')).not.toBeNull();
  });

  // notion-spec-2 §21.4: in the side peek a cut file name shows in full below the chip.
  it('hovering a file chip whose name is cut shows the full name below it', () => {
    destroyTooltip();
    vi.useFakeTimers();
    try {
      const files: PropertyDefinition = { id: 'prop-files', name: 'Files', type: 'files', position: 'a9' };
      const options = createOptions({ schema: [...SCHEMA, files] });

      createDrawer(options).open({ ...ROW, properties: { ...ROW.properties, 'prop-files': [{ id: 'f1', name: 'Quarterly report for the whole team.pdf', url: 'https://example.com/a.pdf' }] } });
      const chip = valueOf(options, 'prop-files')?.querySelector<HTMLElement>('[data-blok-database-file-chip]');
      const link = chip?.querySelector<HTMLElement>('[data-blok-database-cell-link]');

      if (chip === null || chip === undefined || link === null || link === undefined) throw new Error('no file chip');
      Object.defineProperty(link, 'scrollWidth', { configurable: true, value: 260 });
      Object.defineProperty(link, 'clientWidth', { configurable: true, value: 148 });
      hover(chip);
      vi.advanceTimersByTime(HINT_DELAY);

      expect(shownHint()).toEqual({ text: 'Quarterly report for the whole team.pdf', placement: 'bottom' });
    } finally {
      destroyTooltip();
      vi.useRealTimers();
    }
  });

  // notion-spec-2 §21.4: the side peek shows only the name hint on a file chip, not Blok's white link card.
  describe('file chip link in the side peek', () => {
    const files: PropertyDefinition = { id: 'prop-files', name: 'Files', type: 'files', position: 'a9' };
    const openWithFile = (): { options: CardDrawerOptions; link: HTMLAnchorElement } => {
      const options = createOptions({ schema: [...SCHEMA, files] });

      createDrawer(options).open({ ...ROW, properties: { ...ROW.properties, 'prop-files': [{ id: 'f1', name: 'report.pdf', url: 'https://example.com/report.pdf' }] } });
      const link = valueOf(options, 'prop-files')?.querySelector<HTMLAnchorElement>('[data-blok-database-file-chip] a[data-blok-database-cell-link]');

      if (link === null || link === undefined) throw new Error('no file link');

      return { options, link };
    };
    const filesEditor = (): Element | null => document.querySelector('[data-blok-database-cell-editor]');

    it('the link sits in a link owner, so core shows no link card and opens nothing on a click', () => {
      // Core's link hover card and link click skip a link inside a link owner.
      expect(openWithFile().link.closest('[data-blok-link-owner]')).not.toBeNull();
    });

    // notion-spec-2 §24.2: a plain click on a peek file chip does nothing visible.
    it('a plain click on the chip link opens no box and does not follow the link', () => {
      const { link } = openWithFile();
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });

      link.dispatchEvent(click);

      expect(filesEditor()).toBeNull();
      expect(click.defaultPrevented).toBe(true);
    });

    it('a plain click on the chip glyph opens no box', () => {
      const { link } = openWithFile();
      const glyph = link.closest('[data-blok-database-file-chip]')?.querySelector('[data-blok-database-file-chip-icon]');

      if (glyph === null || glyph === undefined) throw new Error('no chip glyph');
      glyph.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(filesEditor()).toBeNull();
    });

    it('a click beside the chips opens the files box', () => {
      const { options } = openWithFile();

      valueOf(options, 'prop-files')?.click();

      expect(filesEditor()).not.toBeNull();
    });

    it('a Cmd-click on the chip link follows it and opens no box', () => {
      const { link } = openWithFile();
      const click = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });

      link.dispatchEvent(click);

      expect(filesEditor()).toBeNull();
      expect(click.defaultPrevented).toBe(false);
    });
  });

  // feel/findings-rowpage R25: the empty title reads "New page".
  it('the title placeholder is New page', () => {
    const options = createOptions({ i18n: { t: (key: string) => (key === 'tools.database.layoutNewPage' ? 'New page' : key) } as never });

    createDrawer(options).open(ROW);

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

    createDrawer(options).open(ROW);
    options.wrapper.querySelector('[data-blok-database-drawer-title]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((resolve) => {
      requestAnimationFrame(() => resolve(undefined));
    });

    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
  });
});

// notion-spec-2 §15.1: an option pill names its option above it, 6px off, centred.
describe('DatabaseCardDrawer — option pill hints', () => {
  const OPTIONS = [
    { id: 'opt-red', label: 'Red', color: 'red', position: 'a0' },
    { id: 'opt-ocean', label: 'Ocean', color: 'blue', position: 'a1' },
  ] as const;
  const PILL_SCHEMA: PropertyDefinition[] = [
    { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
    { id: 'prop-select', name: 'Select', type: 'select', position: 'a1', config: { options: [...OPTIONS] } },
    { id: 'prop-multi', name: 'Multi-select', type: 'multiSelect', position: 'a2', config: { options: [...OPTIONS] } },
    { id: 'prop-status', name: 'Status', type: 'status', position: 'a3', config: { options: [...OPTIONS] } },
  ];
  const PILL_ROW: DatabaseRow = {
    id: 'row-1',
    position: 'a0',
    properties: { 'prop-title': 'Card', 'prop-select': 'opt-red', 'prop-multi': ['opt-red', 'opt-ocean'], 'prop-status': 'opt-ocean' },
  };

  const shownHint = (): { text: string; placement: string | null; top: string } | null => {
    const wrapper = document.querySelector<HTMLElement>('[data-blok-testid="tooltip"]');

    return wrapper?.getAttribute('data-blok-shown') === 'true'
      ? { text: document.querySelector('[data-blok-testid="tooltip-content"]')?.textContent ?? '', placement: wrapper.getAttribute('data-blok-placement'), top: wrapper.style.top }
      : null;
  };

  const pillsOf = (options: CardDrawerOptions, propertyId: string): HTMLElement[] =>
    [...(valueOf(options, propertyId)?.querySelectorAll<HTMLElement>('[data-blok-database-option-pill]') ?? [])];

  const hover = (pill: HTMLElement): void => {
    vi.spyOn(pill, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 1000, y: 361, width: 40, height: 20 }));
    pill.dispatchEvent(new MouseEvent('mouseenter'));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
    destroyTooltip();
    vi.useFakeTimers();
  });

  afterEach(() => {
    destroyTooltip();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it.each([
    ['prop-select', 0, 'Red'],
    ['prop-multi', 0, 'Red'],
    ['prop-multi', 1, 'Ocean'],
  ])('hovering a %s pill shows its option name 6px above it, after the hint delay', (propertyId, index, name) => {
    const options = createOptions({ schema: PILL_SCHEMA });

    createDrawer(options).open(PILL_ROW);
    const pill = pillsOf(options, propertyId)[index];

    hover(pill);
    vi.advanceTimersByTime(HINT_DELAY - 1);
    expect(shownHint()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(shownHint()).toEqual({ text: name, placement: 'top', top: '355px' });
  });

  it('focus alone shows no pill hint', () => {
    const options = createOptions({ schema: PILL_SCHEMA });

    createDrawer(options).open(PILL_ROW);
    const pill = pillsOf(options, 'prop-select')[0];

    pill.dispatchEvent(new FocusEvent('focus'));
    vi.advanceTimersByTime(HINT_DELAY * 2);
    expect(shownHint()).toBeNull();
  });

  // Notion was measured on Select and Multi-select only.
  it('a status pill has no hint', () => {
    const options = createOptions({ schema: PILL_SCHEMA });

    createDrawer(options).open(PILL_ROW);
    const [pill] = pillsOf(options, 'prop-status');

    expect(pill).toBeDefined();
    hover(pill);
    vi.advanceTimersByTime(HINT_DELAY * 2);
    expect(shownHint()).toBeNull();
  });
});

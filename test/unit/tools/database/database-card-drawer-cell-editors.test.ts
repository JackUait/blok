import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { DatabaseRow, PropertyDefinition, SelectOption } from '../../../../src/tools/database/types';

vi.mock('../../../../src/blok', () => ({
  Blok: vi.fn(function stubBlok() {
    return {
      isReady: Promise.resolve(),
      save: vi.fn().mockResolvedValue({ blocks: [] }),
      destroy: vi.fn(),
    };
  }),
}));

const STATUS_OPTIONS: SelectOption[] = [
  { id: 'opt-a', label: 'Not started', color: 'gray', position: 'a0' },
  { id: 'opt-b', label: 'Done', color: 'green', position: 'a1' },
];

const SCHEMA: PropertyDefinition[] = [
  { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
  { id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: STATUS_OPTIONS } },
  { id: 'prop-score', name: 'Score', type: 'number', position: 'a2' },
  { id: 'prop-done', name: 'Done', type: 'checkbox', position: 'a3' },
];

const makeRow = (properties: DatabaseRow['properties'] = {}): DatabaseRow => ({
  id: 'row-1',
  position: 'a0',
  properties: { 'prop-title': 'Card', ...properties },
});

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
    onOptionsChange: vi.fn(),
    ...overrides,
  };
};

const valueOf = (options: CardDrawerOptions, propertyId: string): HTMLElement => {
  const el = options.wrapper.querySelector<HTMLElement>(`[data-blok-database-drawer-prop-value][data-property-id="${propertyId}"]`);

  if (el === null) {
    throw new Error(`no value for ${propertyId}`);
  }

  return el;
};

const editor = (): HTMLElement | null => document.querySelector('[data-blok-database-cell-editor]');

describe('DatabaseCardDrawer — cell editors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a value is a button that opens the editor for its type', () => {
    const options = createOptions();

    new DatabaseCardDrawer(options).open(makeRow({ 'prop-score': 3 }));
    const value = valueOf(options, 'prop-score');

    expect(value.getAttribute('role')).toBe('button');
    value.click();

    expect(editor()?.querySelector('[data-blok-database-cell-input="number"]')).not.toBeNull();
  });

  it('commits through onPropertyValueChange and shows the new value in place', () => {
    const options = createOptions();

    new DatabaseCardDrawer(options).open(makeRow({ 'prop-score': 3 }));
    valueOf(options, 'prop-score').click();
    const input = editor()?.querySelector<HTMLInputElement>('input');

    if (input === null || input === undefined) {
      throw new Error('no input');
    }
    input.value = '12';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(options.onPropertyValueChange).toHaveBeenCalledWith('row-1', 'prop-score', 12);
    expect(valueOf(options, 'prop-score').textContent).toBe('12');
  });

  it('a checkbox flips on click with no popover', () => {
    const options = createOptions();

    new DatabaseCardDrawer(options).open(makeRow({ 'prop-done': false }));
    valueOf(options, 'prop-done').click();

    expect(options.onPropertyValueChange).toHaveBeenCalledWith('row-1', 'prop-done', true);
    expect(editor()).toBeNull();
    expect(valueOf(options, 'prop-done').querySelector('[data-blok-database-checkbox]')?.getAttribute('data-state')).toBe('checked');
  });

  it('Space on a focused value opens it, as a button does', () => {
    const options = createOptions();

    new DatabaseCardDrawer(options).open(makeRow({ 'prop-done': true }));
    valueOf(options, 'prop-done').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));

    expect(options.onPropertyValueChange).toHaveBeenCalledWith('row-1', 'prop-done', false);
  });

  it('one Escape closes the editor and leaves the drawer open', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);

    drawer.open(makeRow({ 'prop-score': 3 }));
    valueOf(options, 'prop-score').click();
    const input = editor()?.querySelector('input');

    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(editor()?.isConnected ?? false).toBe(false);
    expect(drawer.isOpen).toBe(true);
  });

  // research/22 §3: Escape saves a typed number, and closes only the editor.
  it('Escape saves a typed number in place and leaves the drawer open', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);

    drawer.open(makeRow({ 'prop-score': 40 }));
    valueOf(options, 'prop-score').click();
    const input = editor()?.querySelector<HTMLInputElement>('input');

    if (input === null || input === undefined) {
      throw new Error('no input');
    }
    input.value = '401';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(options.onPropertyValueChange).toHaveBeenCalledWith('row-1', 'prop-score', 401);
    expect(valueOf(options, 'prop-score').textContent).toBe('401');
    expect(editor()?.isConnected ?? false).toBe(false);
    expect(drawer.isOpen).toBe(true);
  });

  it('pressing inside the editor does not close the drawer', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);

    drawer.open(makeRow({ 'prop-score': 3 }));
    valueOf(options, 'prop-score').click();
    editor()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(drawer.isOpen).toBe(true);
  });

  it('select pills keep the drawer pill attribute and paint through data-color, with no dot', () => {
    const options = createOptions();

    new DatabaseCardDrawer(options).open(makeRow({ 'prop-status': 'opt-b' }));
    const pill = valueOf(options, 'prop-status').querySelector<HTMLElement>('[data-blok-database-drawer-prop-pill]');

    expect(pill?.getAttribute('data-color')).toBe('green');
    expect(pill?.hasAttribute('data-blok-database-option-pill')).toBe(true);
    expect(pill?.querySelector('[data-blok-database-drawer-prop-dot]')).toBeNull();
    expect(pill?.style.backgroundColor).toBe('');
  });

  it('option edits go out with the saved labels, not the localized ones shown', () => {
    const shown: PropertyDefinition[] = SCHEMA.map((p) => (p.id === 'prop-status'
      ? { ...p, config: { options: STATUS_OPTIONS.map((o) => (o.id === 'opt-a' ? { ...o, label: 'Не начато' } : o)) } }
      : p));
    const options = createOptions({ schema: shown, savedOptionsOf: () => STATUS_OPTIONS });

    new DatabaseCardDrawer(options).open(makeRow());
    valueOf(options, 'prop-status').click();
    const search = editor()?.querySelector<HTMLInputElement>('[data-blok-database-select-search]');

    if (search === null || search === undefined) {
      throw new Error('no search');
    }
    search.value = 'Blocked';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    const sent: SelectOption[] = vi.mocked(options.onOptionsChange ?? vi.fn()).mock.calls[0]?.[1] ?? [];

    expect(sent.find((o) => o.id === 'opt-a')?.label).toBe('Not started');
    expect(sent.some((o) => o.label === 'Blocked')).toBe(true);
    expect(options.onOptionsChange).toHaveBeenCalledWith('prop-status', sent);
  });

  it('read-only values are plain text: no button, no editor', () => {
    const options = createOptions({ readOnly: true });

    new DatabaseCardDrawer(options).open(makeRow({ 'prop-score': 3 }));
    const value = valueOf(options, 'prop-score');

    expect(value.hasAttribute('role')).toBe(false);
    value.click();

    expect(editor()).toBeNull();
    expect(options.onPropertyValueChange).not.toHaveBeenCalled();
  });

  it('closing the drawer closes an open editor', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);

    drawer.open(makeRow({ 'prop-score': 3 }));
    valueOf(options, 'prop-score').click();
    drawer.close();

    expect(editor()?.isConnected ?? false).toBe(false);
  });

  it('shows Empty for a missing value', () => {
    const options = createOptions();

    new DatabaseCardDrawer(options).open(makeRow());

    expect(valueOf(options, 'prop-score').textContent).toBe('tools.database.cellEmpty');
  });
});

// research/22 §3: url, email and phone on the row page.
describe('DatabaseCardDrawer — link values', () => {
  const LINK_SCHEMA: PropertyDefinition[] = [
    { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
    { id: 'prop-link', name: 'Link', type: 'url', position: 'a1' },
    { id: 'prop-mail', name: 'Mail', type: 'email', position: 'a2' },
    { id: 'prop-tel', name: 'Tel', type: 'phone', position: 'a3' },
  ];
  const filled = { 'prop-link': 'https://example.com', 'prop-mail': 'a@b.co', 'prop-tel': '+1 555 0100' };
  const linkIn = (options: CardDrawerOptions, propertyId: string): HTMLAnchorElement => {
    const el = valueOf(options, propertyId).querySelector<HTMLAnchorElement>('a[data-blok-database-cell-link]');

    if (el === null) throw new Error(`no link in ${propertyId}`);

    return el;
  };
  const actionIn = (options: CardDrawerOptions, propertyId: string, label: string): HTMLButtonElement | null =>
    valueOf(options, propertyId).querySelector<HTMLButtonElement>(`[data-blok-database-drawer-prop-actions] button[aria-label="${label}"]`);
  const clickOn = (target: Element): MouseEvent => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    target.dispatchEvent(event);

    return event;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it.each([
    ['prop-link', 'https://example.com/'],
    ['prop-mail', 'mailto:a@b.co'],
    ['prop-tel', 'tel:+15550100'],
  ])('%s: a click on the link follows it in a new tab and opens no editor', (propertyId, href) => {
    const options = createOptions({ schema: LINK_SCHEMA });

    new DatabaseCardDrawer(options).open(makeRow(filled));
    const link = linkIn(options, propertyId);
    const event = clickOn(link);

    expect(event.defaultPrevented).toBe(false);
    expect(editor()).toBeNull();
    expect(link.href).toBe(href);
    expect(link.target).toBe('_blank');
    expect(link.hasAttribute('data-blok-link-owner')).toBe(true);
  });

  it('a click beside the link opens the editor holding the full value', () => {
    const options = createOptions({ schema: LINK_SCHEMA });

    new DatabaseCardDrawer(options).open(makeRow(filled));
    clickOn(valueOf(options, 'prop-link'));

    expect(editor()?.querySelector<HTMLInputElement>('[data-blok-database-cell-input="url"]')?.value).toBe('https://example.com');
  });

  it('a filled link value offers Comment and Copy to Clipboard, and no pencil', () => {
    const options = createOptions({ schema: LINK_SCHEMA, onCommentProperty: vi.fn() });

    new DatabaseCardDrawer(options).open(makeRow(filled));

    for (const propertyId of ['prop-link', 'prop-mail', 'prop-tel']) {
      expect(actionIn(options, propertyId, 'tools.database.tableComment')).not.toBeNull();
      expect(actionIn(options, propertyId, 'tools.database.cellCopy')).not.toBeNull();
      expect(valueOf(options, propertyId).querySelectorAll('[data-blok-database-drawer-prop-actions] button')).toHaveLength(2);
      expect(valueOf(options, propertyId).hasAttribute('data-link')).toBe(true);
    }
  });

  it('an empty link value has no buttons, and Comment needs the host hook', () => {
    const options = createOptions({ schema: LINK_SCHEMA });

    new DatabaseCardDrawer(options).open(makeRow({ 'prop-link': 'https://example.com' }));

    expect(valueOf(options, 'prop-mail').querySelector('[data-blok-database-drawer-prop-actions]')).toBeNull();
    expect(valueOf(options, 'prop-mail').hasAttribute('data-link')).toBe(false);
    expect(actionIn(options, 'prop-link', 'tools.database.tableComment')).toBeNull();
    expect(actionIn(options, 'prop-link', 'tools.database.cellCopy')).not.toBeNull();
  });

  it('Copy writes the full value, toasts, and opens no editor', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();

    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const options = createOptions({ schema: LINK_SCHEMA, notify });

    new DatabaseCardDrawer(options).open(makeRow(filled));
    const copy = actionIn(options, 'prop-tel', 'tools.database.cellCopy');

    if (copy === null) throw new Error('no copy button');
    clickOn(copy);
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('+1 555 0100');
    expect(notify).toHaveBeenCalledWith('tools.database.cellCopied');
    expect(editor()).toBeNull();
  });

  it('Comment hands the row, the property and the value to the host', () => {
    const onCommentProperty = vi.fn();
    const options = createOptions({ schema: LINK_SCHEMA, onCommentProperty });

    new DatabaseCardDrawer(options).open(makeRow(filled));
    const comment = actionIn(options, 'prop-mail', 'tools.database.tableComment');

    if (comment === null) throw new Error('no comment button');
    clickOn(comment);

    expect(onCommentProperty).toHaveBeenCalledWith('row-1', 'prop-mail', valueOf(options, 'prop-mail'));
    expect(editor()).toBeNull();
  });

  it('the buttons survive a commit that repaints the value', () => {
    const options = createOptions({ schema: LINK_SCHEMA });

    new DatabaseCardDrawer(options).open(makeRow(filled));
    clickOn(valueOf(options, 'prop-link'));
    const input = editor()?.querySelector<HTMLInputElement>('input');

    if (input === null || input === undefined) throw new Error('no input');
    input.value = 'https://example.org';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(actionIn(options, 'prop-link', 'tools.database.cellCopy')).not.toBeNull();
  });

  it.each([
    ['text', { id: 'prop-note', name: 'Note', type: 'text', position: 'a4' }],
    ['number', { id: 'prop-note', name: 'Note', type: 'number', position: 'a4' }],
    ['select', { id: 'prop-note', name: 'Note', type: 'select', position: 'a4', config: { options: STATUS_OPTIONS } }],
    ['date', { id: 'prop-note', name: 'Note', type: 'date', position: 'a4' }],
  ] satisfies Array<[string, PropertyDefinition]>)('the %s editor opens over its value, not below it, as measured', (_type, def) => {
    const options = createOptions({ schema: [...SCHEMA, def] });

    new DatabaseCardDrawer(options).open(makeRow());
    const value = valueOf(options, 'prop-note');

    vi.spyOn(value, 'getBoundingClientRect').mockReturnValue(new DOMRect(50, 100, 435, 30));
    value.click();
    const box = editor()?.closest<HTMLElement>('[data-blok-popover]');

    expect(box?.style.top).toBe('99px');
    expect(box?.style.left).toBe('49px');
  });

  it('the Place editor opens over its value and takes its width, as measured (research/35:348, research/36:139)', () => {
    const where: PropertyDefinition = { id: 'prop-where', name: 'Where', type: 'place', position: 'a4' };
    const options = createOptions({ schema: [...SCHEMA, where] });

    new DatabaseCardDrawer(options).open(makeRow());
    const value = valueOf(options, 'prop-where');

    vi.spyOn(value, 'getBoundingClientRect').mockReturnValue(new DOMRect(50, 100, 435, 30));
    value.click();
    const box = editor()?.closest<HTMLElement>('[data-blok-popover]');

    expect(box?.style.top).toBe('99px');
    expect(box?.style.left).toBe('49px');
    expect(box?.style.getPropertyValue('--width')).toBe('435px');
  });
});

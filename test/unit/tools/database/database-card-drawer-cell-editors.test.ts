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

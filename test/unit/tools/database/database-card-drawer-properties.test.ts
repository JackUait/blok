import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';

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

    expect(onOpenPropertyMenu).toHaveBeenCalledWith('prop-owner', label);
  });

  it('adds a property named in the name field', () => {
    const onAddProperty = vi.fn();
    const options = createOptions({ onAddProperty, hasPeople: true });

    new DatabaseCardDrawer(options).open(ROW);
    const add = options.wrapper.querySelector<HTMLElement>('[data-blok-database-drawer-add-prop]');

    expect(add?.textContent).toBe('tools.database.addProperty');
    add?.click();
    const field = document.querySelector<HTMLInputElement>('[data-blok-database-property-name-input]');

    if (field === null) throw new Error('no name field');
    field.value = 'Reviewer';
    document.querySelector<HTMLElement>('[data-blok-database-property-type-option="person"]')?.click();

    expect(onAddProperty).toHaveBeenCalledWith('person', 'Reviewer');
  });
});

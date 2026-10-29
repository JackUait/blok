import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { renderCellValue, openCellEditor } from '../../../../../src/tools/database/cells';
import type { CellContext } from '../../../../../src/tools/database/cells/types';
import type { PropertyDefinition } from '../../../../../src/tools/database/types';
import { makeAnchor, makeEditorContext } from './helpers';

const ctx = (overrides: Partial<CellContext> = {}): CellContext => ({
  i18n: { t: (key: string) => key },
  readOnly: false,
  locale: 'en-US',
  ...overrides,
});

const formula: PropertyDefinition = { id: 'fx', name: 'Double', type: 'formula', position: 'a0', formula: { expression: '1' } };
const rollup: PropertyDefinition = {
  id: 'ro', name: 'Total', type: 'rollup', position: 'a1', rollup: { relationPropertyId: 'rel', targetPropertyId: 'n', function: 'sum' },
};
const relation: PropertyDefinition = { id: 'rel', name: 'Related', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db' } };

describe('renderCellValue — computed property types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('draws a formula as its result type, with the property number format', () => {
    const cell = renderCellValue(formula, 1234.5, ctx({
      valueProperty: (p) => ({ ...p, type: 'number', number: { format: 'dollar' } }),
    }));

    expect(cell.textContent).toBe('$1,234.50');
    expect(cell.getAttribute('data-blok-database-cell')).toBe('formula');
  });

  it('draws a rollup percent as a percent', () => {
    const cell = renderCellValue(rollup, 0.5, ctx({ valueProperty: (p) => ({ ...p, type: 'number', number: { format: 'percent' } }) }));

    expect(cell.textContent).toBe('50%');
  });

  describe('Show original of a Number (notion-spec-2 §13)', () => {
    const list: PropertyDefinition = { ...rollup, rollup: { relationPropertyId: 'rel', targetPropertyId: 'n', function: 'show_original' } };
    const asList = (number: NonNullable<PropertyDefinition['number']>) => ctx({ valueProperty: (p) => ({ ...p, type: 'text', number }) });

    it('formats each number on its own, comma separated', () => {
      const cell = renderCellValue(list, '50, 1234.5', asList({ format: 'dollar', decimals: 2 }));

      expect(cell.textContent).toBe('$50.00, $1,234.50');
      expect(cell.hasAttribute('data-blok-database-number-list')).toBe(true);
    });

    it('draws each number with its own bar, and no comma', () => {
      const cell = renderCellValue(list, '50, 200', asList({ showAs: 'bar', color: 'green' }));
      const items = [...cell.querySelectorAll('[data-blok-database-number-item]')];

      expect(items.map((item) => item.querySelector('[data-blok-database-number-text]')?.textContent)).toEqual(['50', '200']);
      expect(items.map((item) => (item.querySelector<HTMLElement>('[data-blok-database-number-bar]'))?.style.getPropertyValue('--blok-database-number-fill'))).toEqual(['50%', '100%']);
      expect(cell.textContent).toBe('50200');
    });

    it('draws only the rings when Show number is off', () => {
      const cell = renderCellValue(list, '25, 75', asList({ showAs: 'ring', showNumber: false }));

      expect(cell.querySelectorAll('[data-blok-database-number-ring]')).toHaveLength(2);
      expect(cell.querySelector('[data-blok-database-number-text]')).toBeNull();
    });

    it('leaves a list with no number settings as text', () => {
      const cell = renderCellValue(list, '12, 34', ctx({ valueProperty: (p) => ({ ...p, type: 'text' }) }));

      expect(cell.textContent).toBe('12, 34');
      expect(cell.hasAttribute('data-blok-database-number-list')).toBe(false);
    });

    it('shows an empty list as empty', () => {
      const cell = renderCellValue(list, '', asList({ format: 'dollar' }));

      expect(cell.textContent).toBe('');
      expect(cell.hasAttribute('data-empty')).toBe(true);
    });
  });

  it('falls back to text without a value property', () => {
    expect(renderCellValue(formula, 'abc', ctx()).textContent).toBe('abc');
  });

  it('draws each related row as a chip with its title', () => {
    const titles: Record<string, string> = { r1: 'Alpha', r2: 'Bravo' };
    const cell = renderCellValue(relation, [{ id: 'r1' }, { id: 'r2' }], ctx({ relationTitle: (_p, id) => titles[id] }));
    const chips = [...cell.querySelectorAll('[data-blok-database-relation-chip]')];

    expect(chips.map((chip) => chip.textContent)).toEqual(['Alpha', 'Bravo']);
    expect(chips.map((chip) => chip.getAttribute('data-row-id'))).toEqual(['r1', 'r2']);
  });

  // notion-spec-2 §18.1: a 20x20 page icon box, then the title, which carries the underline.
  it('draws each related row as an empty page icon and its title', () => {
    const cell = renderCellValue(relation, [{ id: 'r1' }], ctx({ relationTitle: () => 'Alpha' }));
    const chip = cell.querySelector('[data-blok-database-relation-chip]');
    const [icon, title] = [...(chip?.children ?? [])];

    expect(icon?.hasAttribute('data-blok-database-relation-chip-icon')).toBe(true);
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.querySelectorAll('path')).toHaveLength(2);
    expect(title?.hasAttribute('data-blok-database-relation-chip-title')).toBe(true);
    expect(title?.textContent).toBe('Alpha');
  });

  it('names an untitled related row', () => {
    const cell = renderCellValue(relation, [{ id: 'r1' }], ctx({ relationTitle: () => '' }));

    expect(cell.textContent).toBe('tools.database.relationUntitled');
  });

  it('opens a related row from its chip without opening the cell', () => {
    const openRelated = vi.fn();
    const cell = renderCellValue(relation, [{ id: 'r1' }], ctx({ relationTitle: () => 'Alpha', openRelated }));
    const outer = vi.fn();

    document.body.appendChild(cell);
    cell.addEventListener('click', outer);
    cell.querySelector<HTMLElement>('[data-blok-database-relation-chip]')?.click();

    expect(openRelated).toHaveBeenCalledWith(relation, 'r1');
    expect(outer).not.toHaveBeenCalled();
  });

  it('opens no editor for a formula or a rollup', () => {
    const onCommit = vi.fn();

    expect(openCellEditor(formula, 2, makeAnchor(), makeEditorContext({ onCommit })).isOpen).toBe(false);
    expect(openCellEditor(rollup, 2, makeAnchor(), makeEditorContext({ onCommit })).isOpen).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

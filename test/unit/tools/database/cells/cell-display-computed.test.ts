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

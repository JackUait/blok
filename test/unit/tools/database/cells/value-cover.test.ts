import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import type { CellEditorContext } from '../../../../../src/tools/database/cells/types';
import type { PropertyDefinition, PropertyType } from '../../../../../src/tools/database/types';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import { makeAnchor, makeEditorContext, makeProperty } from './helpers';

/** The row page's value cell, as notion-spec §7 measures it: 434x34 at (1002, 434) → editor at 1001, 435 wide. */
const CELL = { x: 100, y: 200, width: 434, height: 34 };

const cellAnchor = (): HTMLButtonElement => {
  const anchor = makeAnchor();

  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(CELL.x, CELL.y, CELL.width, CELL.height));

  return anchor;
};

const popoverRoot = (): HTMLElement => {
  const root = document.querySelector<HTMLElement>('[data-blok-popover-custom-class~="blok-database-cell-editor"]');

  if (root === null) {
    throw new Error('no editor popover');
  }

  return root;
};

const box = (): { left: number; top: number; width: number } => {
  const root = popoverRoot();

  return {
    left: parseFloat(root.style.left),
    top: parseFloat(root.style.top),
    width: parseFloat(root.style.getPropertyValue('--width')),
  };
};

describe('cell editors over a row page value', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1512);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(717);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const widthTracking: PropertyType[] = ['text', 'number', 'url', 'select', 'status', 'multiSelect', 'person', 'files', 'relation'];

  /** Person needs people and relation its target to open at all. */
  const propertyOf = (type: PropertyType): PropertyDefinition => (type === 'relation'
    ? { ...makeProperty(type), relation: { targetDatabaseId: 'db' } }
    : makeProperty(type));
  const extras: Partial<CellEditorContext> = { people: [], relationCandidates: () => [] };

  it.each(widthTracking)('%s opens 1px left of the value, level with its top, its right edge on the value\'s', (type) => {
    openCellEditor(propertyOf(type), undefined, cellAnchor(), makeEditorContext({ ...extras, coverCell: 'value' }));

    expect(box()).toEqual({ left: CELL.x - 1, top: CELL.y, width: CELL.width + 1 });
  });

  it('date keeps its 248px picker over the value', () => {
    openCellEditor(makeProperty('date'), undefined, cellAnchor(), makeEditorContext({ coverCell: 'value' }));

    expect(box()).toEqual({ left: CELL.x - 1, top: CELL.y, width: 248 });
  });

  it('marks the popover as a value editor, so its peek-only look applies', () => {
    openCellEditor(makeProperty('text'), undefined, cellAnchor(), makeEditorContext({ coverCell: 'value' }));

    expect(popoverRoot().getAttribute('data-blok-popover-custom-class')?.split(' ')).toContain('blok-database-value-editor');
  });

  it('a table cell keeps its own geometry: 1px past the cell\'s top-left corner, as wide as the cell', () => {
    openCellEditor(makeProperty('text'), undefined, cellAnchor(), makeEditorContext({ coverCell: true }));

    expect(box()).toEqual({ left: CELL.x - 1, top: CELL.y - 1, width: CELL.width });
    expect(popoverRoot().getAttribute('data-blok-popover-custom-class')?.split(' ')).not.toContain('blok-database-value-editor');
  });
});

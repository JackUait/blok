/*
 * The corner drag may only shrink the outer table over EMPTY trailing rows and
 * columns. jsdom has no layout for the drag's geometry walk, so the drag class
 * is mocked to capture the guards the real table hands it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import type { TableCornerDragOptions } from '../../../../src/tools/table/table-corner-drag';
import type { OutputBlockData } from '../../../../types';

const captured = vi.hoisted(() => ({ options: [] as unknown[] }));

vi.mock('../../../../src/tools/table/table-corner-drag', () => ({
  TableCornerDrag: class {
    public constructor(options: unknown) {
      captured.options.push(options);
    }

    public destroy = vi.fn();
    public syncPosition = vi.fn();
    public attachScrollContainer = vi.fn();
    public setDisplay = vi.fn();
    public setInteractive = vi.fn();
  },
}));

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
}

const isCornerDragOptions = (value: unknown): value is TableCornerDragOptions =>
  typeof value === 'object' && value !== null && 'gridEl' in value && 'canRemoveLastRow' in value;

// Inner table in outer cell (0, 0) with EMPTY cells; the outer table's last
// row and last column both hold content.
const blocks: OutputBlockData[] = [
  {
    id: 'outer',
    type: 'table',
    data: {
      withHeadings: false,
      content: [
        [{ blocks: ['inner'] }, { blocks: ['right'] }],
        [{ blocks: ['bottom-left'] }, { blocks: ['bottom-right'] }],
      ],
    },
    content: ['inner', 'right', 'bottom-left', 'bottom-right'],
  },
  {
    id: 'inner',
    type: 'table',
    parent: 'outer',
    data: {
      withHeadings: false,
      content: [
        [{ blocks: ['i00'] }, { blocks: ['i01'] }],
        [{ blocks: ['i10'] }, { blocks: ['i11'] }],
      ],
    },
    content: ['i00', 'i01', 'i10', 'i11'],
  },
  ...['i00', 'i01', 'i10', 'i11'].map(id => ({ id, type: 'paragraph', parent: 'inner', data: { text: '' } })),
  { id: 'right', type: 'paragraph', parent: 'outer', data: { text: 'right' } },
  { id: 'bottom-left', type: 'paragraph', parent: 'outer', data: { text: 'bottom-left' } },
  { id: 'bottom-right', type: 'paragraph', parent: 'outer', data: { text: '' } },
];

describe('outer corner drag guards beside a nested table in row 0', () => {
  let holder: HTMLDivElement;
  let editor: TestEditor | null = null;

  const outerGuards = (): TableCornerDragOptions => {
    const outerGrid = holder.querySelector('[data-blok-id="outer"] table');
    const options = captured.options.filter(isCornerDragOptions).filter(candidate => candidate.gridEl === outerGrid).at(-1);

    if (!options) {
      throw new Error('outer corner drag was never constructed');
    }

    return options;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    captured.options.length = 0;
    holder = document.createElement('div');
    document.body.appendChild(holder);
    editor = new Blok({
      holder,
      tools: { table: Table, paragraph: Paragraph },
      data: { blocks },
    });
    await editor.isReady;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('refuses to remove the outer last row that holds content', () => {
    expect(outerGuards().canRemoveLastRow()).toBe(false);
  });

  it('refuses to remove the outer last column that holds content', () => {
    expect(outerGuards().canRemoveLastColumn()).toBe(false);
  });
});

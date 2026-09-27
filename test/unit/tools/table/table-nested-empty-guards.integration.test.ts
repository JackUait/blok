import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import type { OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

// A filled table nested in outer cell (0, 0): its rows and cells sit before
// the outer table's own later rows and columns in document order.
const nestedFixture = (innerIds: string[][]): OutputBlockData[] => [
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
      content: innerIds.map(row => row.map(id => ({ blocks: [id] }))),
    },
    content: innerIds.flat(),
  },
  ...innerIds.flat().map(id => ({ id, type: 'paragraph', parent: 'inner', data: { text: id } })),
  ...['right', 'bottom-left', 'bottom-right'].map(id => ({ id, type: 'paragraph', parent: 'outer', data: { text: id } })),
];

// Three columns so inner cells carry the column index a drag adds to the outer table.
const INNER_IDS = [
  ['i00', 'i01', 'i02'],
  ['i10', 'i11', 'i12'],
  ['i20', 'i21', 'i22'],
];

describe('outer table add controls beside a nested table in row 0', () => {
  let holder: HTMLDivElement;
  let editor: TestEditor | null = null;

  const nextFrame = (): Promise<void> => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

  const grid = (id: string): HTMLTableElement => {
    const element = holder.querySelector<HTMLTableElement>(`[data-blok-id="${id}"] table`);

    if (!element) {
      throw new Error(`table ${id} is missing`);
    }

    return element;
  };

  const outerButton = (kind: 'row' | 'col'): HTMLElement => {
    const button = Array.from(holder.querySelectorAll<HTMLElement>(`[data-blok-table-add-${kind}]`))
      .find(candidate => candidate.closest('[data-blok-id]')?.getAttribute('data-blok-id') === 'outer');

    if (!button) {
      throw new Error(`outer add-${kind} button is missing`);
    }

    button.setPointerCapture = (): void => {};
    button.releasePointerCapture = (): void => {};

    return button;
  };

  const pointer = (type: string, x: number, y: number): Event =>
    Object.assign(new Event(type, { bubbles: true }), { clientX: x, clientY: y, pointerId: 1 });

  const outerRowCount = (): number => grid('outer').tBodies[0].rows.length;
  const outerColCount = (): number => grid('outer').querySelectorAll(':scope > colgroup > col').length;

  const boot = async (blocks: OutputBlockData[]): Promise<void> => {
    editor = new Blok({
      holder,
      tools: { table: Table, paragraph: Paragraph },
      data: { blocks },
    }) as unknown as TestEditor;
    await editor.isReady;
    await nextFrame();
    await nextFrame();

    if (!grid('outer').contains(grid('inner'))) {
      throw new Error('inner table is not mounted in the outer cell');
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('takes back the empty row a drag added when the pointer returns', async () => {
    await boot(nestedFixture(INNER_IDS));
    const button = outerButton('row');

    // jsdom has no layout, so a row step is the 30px fallback.
    button.dispatchEvent(pointer('pointerdown', 0, 0));
    button.dispatchEvent(pointer('pointermove', 0, 30));

    expect(outerRowCount()).toBe(3);

    button.dispatchEvent(pointer('pointermove', 0, 0));
    button.dispatchEvent(pointer('pointerup', 0, 0));

    expect(outerRowCount()).toBe(2);
    expect(grid('inner').tBodies[0].rows).toHaveLength(3);
  });

  it('takes back the empty column a drag added when the pointer returns', async () => {
    await boot(nestedFixture(INNER_IDS));
    const button = outerButton('col');

    // jsdom widths are 0, so a column step is the 100px fallback.
    button.dispatchEvent(pointer('pointerdown', 0, 0));
    button.dispatchEvent(pointer('pointermove', 100, 0));

    expect(outerColCount()).toBe(3);

    button.dispatchEvent(pointer('pointermove', 0, 0));
    button.dispatchEvent(pointer('pointerup', 0, 0));

    expect(outerColCount()).toBe(2);
    expect(grid('inner').tBodies[0].rows[0].cells).toHaveLength(3);
  });

  it('sizes a new outer column from the outer cells, not the nested ones', async () => {
    const original = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-blok-table-cell')) {
        return new DOMRect(0, 0, this.closest('[data-blok-id="inner"]') ? 50 : 300, 20);
      }

      return original.call(this);
    });
    // Two inner columns match the outer column count, so an inner row reads as a plain outer row.
    await boot(nestedFixture([['i00', 'i01'], ['i10', 'i11']]));

    const button = outerButton('col');

    button.dispatchEvent(pointer('pointerdown', 0, 0));
    button.dispatchEvent(pointer('pointerup', 0, 0));

    const saved = await editor?.save();

    expect(saved?.blocks.find(block => block.id === 'outer')?.data.colWidths).toEqual([300, 300, 150]);
  });

  it('adds an outer row without adding blocks to the nested table', async () => {
    await boot(nestedFixture(INNER_IDS));
    const button = outerButton('row');

    button.dispatchEvent(pointer('pointerdown', 0, 0));
    button.dispatchEvent(pointer('pointerup', 0, 0));

    expect(outerRowCount()).toBe(3);

    const saved = await editor?.save();
    const inner = saved?.blocks.find(block => block.id === 'inner');

    const content: unknown = inner?.data.content;
    const cellIds = Array.isArray(content)
      ? content.map((row: unknown) => (Array.isArray(row) ? row.map((cell: unknown) => (typeof cell === 'object' && cell !== null && 'blocks' in cell ? cell.blocks : undefined)) : row))
      : content;

    expect(cellIds).toEqual(INNER_IDS.map(row => row.map(id => [id])));
    expect(saved?.blocks.filter(block => block.parent === 'inner').map(block => block.id)).toEqual(INNER_IDS.flat());
  });
});

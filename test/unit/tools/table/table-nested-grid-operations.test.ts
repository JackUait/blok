import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import type { TableConfig, TableData } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions, OutputBlockData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  blocks: API['blocks'];
}

const tables = new Map<string, Table>();

class TrackedTable extends Table {
  constructor(options: BlockToolConstructorOptions<TableData, TableConfig>) {
    super(options);
    tables.set(options.block?.id ?? '', this);
  }
}

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
        [{ blocks: ['i20'] }, { blocks: ['i21'] }],
      ],
    },
    content: ['i00', 'i01', 'i10', 'i11', 'i20', 'i21'],
  },
  ...['i00', 'i01', 'i10', 'i11', 'i20', 'i21'].map(id => ({
    id,
    type: 'paragraph',
    parent: 'inner',
    data: { text: id },
  })),
  { id: 'right', type: 'paragraph', parent: 'outer', data: { text: 'Right' } },
  { id: 'bottom-left', type: 'paragraph', parent: 'outer', data: { text: 'Bottom left' } },
  { id: 'bottom-right', type: 'paragraph', parent: 'outer', data: { text: 'Bottom right' } },
];

describe('outer table edits beside a nested table', () => {
  let holder: HTMLDivElement;
  let editor: TestEditor | null;

  const table = (id: string): HTMLTableElement => {
    const element = holder.querySelector<HTMLTableElement>(`[data-blok-id="${id}"] table`);

    if (!element) {
      throw new Error(`table ${id} is missing`);
    }

    return element;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    tables.clear();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    editor = new Blok({
      holder,
      tools: { table: TrackedTable, paragraph: Paragraph },
      data: { blocks },
    }) as unknown as TestEditor;
    await editor.isReady;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    if (!table('outer').contains(table('inner'))) {
      throw new Error('inner table is not mounted inside the outer table');
    }
  });

  afterEach(() => {
    editor?.destroy();
    holder.remove();
    vi.restoreAllMocks();
  });

  it('grows the outer rows for a multi-row paste without changing the inner grid', () => {
    const target = table('outer').tBodies[0].rows[1].cells[1];

    target.setAttribute('tabindex', '0');
    target.focus();

    const event = new Event('paste', { bubbles: true, cancelable: true });

    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (type: string): string => type === 'text/html'
          ? '<table><tbody><tr><td>Top</td></tr><tr><td>Bottom</td></tr></tbody></table>'
          : '',
      },
    });
    target.dispatchEvent(event);

    expect(table('outer').tBodies[0].rows).toHaveLength(3);
    expect(table('outer').tBodies[0].rows[1].cells[1].textContent).toBe('Top');
    expect(table('outer').tBodies[0].rows[2].cells[1].textContent).toBe('Bottom');
    expect(table('inner').tBodies[0].rows[2].cells[1].textContent).toBe('i21');
  });

  it('adds an outer column without adding cells to nested rows', () => {
    const outer = table('outer');
    const button = Array.from(outer.closest('[data-blok-tool="table"]')?.children ?? [])
      .find((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-blok-table-add-col'));

    if (!button) {
      throw new Error('outer add-column button is missing');
    }

    button.setPointerCapture = vi.fn();
    button.releasePointerCapture = vi.fn();
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

    expect(table('inner').tBodies[0].rows[0].cells).toHaveLength(2);
    expect(table('inner').tBodies[0].rows[2].cells).toHaveLength(2);
    expect(table('outer').tBodies[0].rows[0].cells).toHaveLength(3);
    expect(table('outer').tBodies[0].rows[1].cells).toHaveLength(3);
  });

  it('colors an outer row without coloring the nested row with the same coordinates', async () => {
    const outerWrapper = table('outer').closest('[data-blok-tool="table"]');
    const grip = Array.from(outerWrapper?.querySelectorAll<HTMLElement>('[data-blok-table-grip-row="1"]') ?? [])
      .find(element => element.closest('[data-blok-tool="table"]') === outerWrapper);

    if (!grip) {
      throw new Error('outer row grip is missing');
    }

    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    const color = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-popover-item]'))
      .find(item => item.querySelector('[data-blok-popover-item-title]')?.textContent === 'Color');

    if (!color) {
      throw new Error('row color action is missing');
    }

    color.click();
    await new Promise<void>(resolve => setTimeout(resolve, 150));

    const swatch = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-blok-testid^="cell-color-swatch-backgroundColor-"]'
    )).find(element => !element.getAttribute('data-blok-testid')?.endsWith('-default'));

    if (!swatch) {
      throw new Error('row color swatch is missing');
    }

    swatch.click();

    expect(table('inner').tBodies[0].rows[1].cells[0].style.backgroundColor).toBe('');
    expect(table('outer').tBodies[0].rows[1].cells[0].style.backgroundColor).not.toBe('');
  });

  it('deletes an outer column without deleting nested cells', () => {
    const outerTool = tables.get('outer');

    if (!outerTool) {
      throw new Error('outer table tool is missing');
    }

    outerTool.deleteColumnWithCleanup(1);

    expect(table('inner').tBodies[0].rows[0].cells).toHaveLength(2);
    expect(table('inner').tBodies[0].rows[2].cells).toHaveLength(2);
    expect(table('outer').tBodies[0].rows[0].cells).toHaveLength(1);
    expect(table('outer').tBodies[0].rows[1].cells).toHaveLength(1);
  });

});

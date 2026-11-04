// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { Blok } from '../../../../src/blok';
import type { Core } from '../../../../src/components/core';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import { Paragraph, Table } from '../../../../src/tools';
import type { OutputBlockData, OutputData } from '../../../../types';

class BootedEditor extends Blok {
  public moduleGraph: BlokModules | undefined;

  public override exportAPI(core: Core): void {
    this.moduleGraph = core.moduleInstances;
    super.exportAPI(core);
  }
}

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  moduleGraph: BlokModules | undefined;
}

const editors: TestEditor[] = [];

const bootTable = async (rows: number, cols: number): Promise<TestEditor> => {
  const holder = document.createElement('div');
  const ids = Array.from({ length: rows * cols }, (_, i) => `c${i}`);

  document.body.appendChild(holder);
  const editor = new BootedEditor({
    holder,
    data: {
      blocks: [
        {
          id: 't',
          type: 'table',
          data: { withHeadings: false, content: Array.from({ length: rows }, (_, r) => ids.slice(r * cols, (r + 1) * cols).map(id => ({ blocks: [id] }))) },
          content: ids,
        },
        ...ids.map(id => ({ id, type: 'paragraph', data: { text: id }, parent: 't' })),
      ],
    },
    tools: { paragraph: { class: Paragraph }, table: { class: Table } },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const click = (selector: string): void => {
  const element = document.querySelector<HTMLElement>(selector);

  if (element === null) {
    throw new Error(`no ${selector}`);
  }
  element.click();
};

/** Opens full screen and commits a new size from the size card. */
const resize = (rows: number, cols: number): void => {
  click('[data-blok-table-fullscreen-toggle]');
  click('[data-blok-table-fullscreen-size]');

  const inputs = document.querySelectorAll<HTMLInputElement>('[data-blok-table-fullscreen-size-editor] input');

  inputs[0].value = String(cols);
  inputs[1].value = String(rows);
  click('[data-blok-table-fullscreen-size-done]');
};

const tableOrder = (editor: TestEditor): Y.Array<string> => {
  const order: unknown = editor.moduleGraph?.YjsManager.getBlockById('t')?.get('contentIds');

  if (!(order instanceof Y.Array)) {
    throw new Error('the table has no contentIds array');
  }

  return order as Y.Array<string>;
};

const cellIds = (table: OutputBlockData): string[][] => {
  const content = (table.data as { content: Array<Array<{ blocks: string[] }>> }).content;

  return content.map(row => row.flatMap(cell => cell.blocks));
};

describe('table resize from the size card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no Web Animations; full screen reads them when it opens and closes.
    if (!('getAnimations' in Element.prototype)) {
      Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
    }
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('writes new cells into the table\'s child order once per run, however many columns it adds', async () => {
    const writesFor = async (cols: number): Promise<number> => {
      const editor = await bootTable(2, 2);
      const order = tableOrder(editor);
      const original = Y.Array.prototype.insert;
      const writes = { count: 0 };

      vi.spyOn(Y.Array.prototype, 'insert').mockImplementation(function (this: Y.Array<unknown>, index: number, content: unknown[]) {
        if (this === order) {
          writes.count++;
        }
        original.call(this, index, content);
      });

      resize(2, cols);
      vi.restoreAllMocks();
      editors.splice(0).forEach((done) => done.destroy());
      document.body.innerHTML = '';

      return writes.count;
    };

    expect(await writesFor(12)).toBe(await writesFor(4));
  });

  it('gives every new cell one block, saved in grid order', async () => {
    const editor = await bootTable(2, 2);

    resize(4, 5);

    const saved = await editor.save();
    const table = saved.blocks.find(block => block.id === 't');

    if (table === undefined) {
      throw new Error('no table saved');
    }

    const grid = cellIds(table);
    const children = saved.blocks.filter(block => block.parent === 't').map(block => block.id);

    expect(grid.map(row => row.length)).toEqual([5, 5, 5, 5]);
    expect(children).toEqual(grid.flat());
    expect(table.content).toEqual(grid.flat());
    expect(tableOrder(editor).toArray()).toEqual(grid.flat());
    expect(grid[0].slice(0, 2)).toEqual(['c0', 'c1']);
    expect(grid[1].slice(0, 2)).toEqual(['c2', 'c3']);
  });
  it('finds each new cell\'s row without counting the rows again for every cell', async () => {
    const readsFor = async (cols: number): Promise<number> => {
      await bootTable(2, 2);
      const body = document.querySelector('[data-blok-tool="table"] tbody');
      const children = Object.getOwnPropertyDescriptor(Element.prototype, 'children')?.get;

      if (body === null || children === undefined) {
        throw new Error('no table body');
      }

      const reads = { count: 0 };

      Object.defineProperty(body, 'children', {
        configurable: true,
        get(this: Element) {
          reads.count++;
          const list: HTMLCollection = children.call(this);

          return list;
        },
      });

      resize(10, cols);
      editors.splice(0).forEach((done) => done.destroy());
      document.body.innerHTML = '';

      return reads.count;
    };

    // Same rows, 120 more cells: reading the rows once per new cell would add 120 or more.
    expect(await readsFor(16)).toBeLessThan(await readsFor(4) + 10);
  });
});

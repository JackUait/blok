import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';


import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import { ColumnList } from '../../../../src/tools/column-list';
import { Column } from '../../../../src/tools/column';
import type { OutputBlockData, OutputData } from '../../../../types';

interface SaveableBlok {
  save(): Promise<OutputData>;
  destroy(): void;
}

const isSaveableBlok = (candidate: unknown): candidate is SaveableBlok => {
  const withSave = candidate as { save?: unknown; destroy?: unknown };

  return typeof withSave.save === 'function' && typeof withSave.destroy === 'function';
};

describe('table inside a column: legacy string cells must not destroy hierarchy', () => {
  let holder: HTMLElement;

  beforeEach(() => {
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    vi.restoreAllMocks();
  });

  it('keeps the column hierarchy after rendering a legacy string-cell table', async () => {
    const initial: OutputBlockData[] = [
      { id: 'p1', type: 'paragraph', data: { text: 'before' } },
      { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['t1'] },
      {
        id: 't1',
        type: 'table',
        parent: 'c1',
        data: {
          withHeadings: false,
          content: [['A', 'B'], ['C', 'D']],
        },
      },
      { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p3'] },
      { id: 'p3', type: 'paragraph', data: { text: 'right' }, parent: 'c2' },
      { id: 'p2', type: 'paragraph', data: { text: 'after' } },
    ];

    const blok = new Blok({
      holder,
      tools: {
        table: Table,
        column_list: ColumnList,
        column: Column,
        paragraph: Paragraph,
      },
      data: { blocks: initial },
    });

    await blok.isReady;

    // The public save() lands on the instance only after isReady (prototype swap).
    if (!isSaveableBlok(blok)) {
      throw new Error('editor did not expose save() after isReady');
    }

    const saved = await blok.save();
    const byId = new Map(saved.blocks.map((block: OutputBlockData) => [block.id, block]));

    const cl1 = byId.get('cl1');
    const c1 = byId.get('c1');
    const c2 = byId.get('c2');
    const p2 = byId.get('p2');
    const t1 = byId.get('t1');

    expect(cl1?.content).toEqual(['c1', 'c2']);
    expect(c1?.parent).toBe('cl1');
    expect(c2?.parent).toBe('cl1');
    expect(c1?.content).toEqual(['t1']);
    expect(t1?.parent).toBe('c1');
    expect(p2?.parent).toBeUndefined();

    blok.destroy();
  });
});

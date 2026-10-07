/**
 * Data-loss probes: a table loaded through async `persistence.load` via the
 * React adapter (real core) — boot snapshots, later edits, and teardown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';
import { BlokEditor } from '../src';
import type { UseBlokConfig } from '../src';
import type { Blok, OutputData } from '@/types';
import { Paragraph } from '../../../src/tools/paragraph';
import { Table } from '../../../src/tools/table/index';
import { blockTextAsHtml } from '../../../test/unit/helpers/saved-as-html';

const TOOLS: UseBlokConfig['tools'] = { paragraph: { class: Paragraph }, table: { class: Table } };

const DOC: OutputData = {
  blocks: [
    { id: 'tbl', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['c00'] }, { blocks: ['c01'] }], [{ blocks: ['c10'] }, { blocks: ['c11'] }]] } },
    { id: 'c00', type: 'paragraph', data: { text: 'a' }, parent: 'tbl' },
    { id: 'c01', type: 'paragraph', data: { text: 'b' }, parent: 'tbl' },
    { id: 'c10', type: 'paragraph', data: { text: 'c' }, parent: 'tbl' },
    { id: 'c11', type: 'paragraph', data: { text: 'd' }, parent: 'tbl' },
  ],
};

const savedGrid = (doc: OutputData): string[][] => {
  const table = doc.blocks.find((b) => b.type === 'table');
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));

  return (table?.data as { content: Array<Array<{ blocks: string[] }>> }).content.map((row) =>
    row.map((cell) => cell.blocks.map((id) => byId.has(id) ? String(blockTextAsHtml(byId.get(id))) : `<missing ${id}>`).join('|'))
  );
};

const typeInto = (root: HTMLElement, blockId: string, text: string): void => {
  const editable = root.querySelector<HTMLElement>(`[data-blok-id="${blockId}"] [data-blok-tool="paragraph"]`);

  if (editable === null) {
    throw new Error(`no editable for ${blockId}`);
  }
  editable.textContent = text;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text.slice(-1) }));
};

const flush = async (ms: number): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};

const mountWithPersistence = (save: (data: OutputData) => void): { root: () => HTMLElement; ready: () => Blok | null; unmount: () => void } => {
  let instance: Blok | null = null;
  const persistence = {
    load: () => new Promise<OutputData>((resolve) => setTimeout(() => resolve(structuredClone(DOC)), 150)),
    save: async (data: OutputData) => {
      save(structuredClone(data));
    },
  };
  const { getByTestId, unmount } = render(
    <BlokEditor data-testid="ed" tools={TOOLS} persistence={persistence} onReady={(e) => { instance = e; }} />
  );

  return { root: () => getByTestId('ed'), ready: () => instance, unmount };
};

describe('table loaded through persistence (React adapter, real core)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await flush(0);
    vi.restoreAllMocks();
  });

  it('boot writes nothing, and the loaded table renders whole', async () => {
    const save = vi.fn();
    const ed = mountWithPersistence(save);

    await waitFor(() => expect(ed.ready()).not.toBeNull(), { timeout: 5000 });
    await waitFor(() => expect(ed.root().querySelectorAll('[data-blok-table-cell]')).toHaveLength(4), { timeout: 5000 });
    await flush(1200);

    expect(save.mock.calls.map((c) => savedGrid(c[0] as OutputData))).toStrictEqual([]);
    expect(savedGrid(await (ed.ready() as Blok).save())).toStrictEqual([['a', 'b'], ['c', 'd']]);
    ed.unmount();
  });

  it('a later cell edit reaches persistence.save with the whole table', async () => {
    const save = vi.fn();
    const ed = mountWithPersistence(save);

    await waitFor(() => expect(ed.root().querySelectorAll('[data-blok-table-cell]')).toHaveLength(4), { timeout: 5000 });
    await flush(600);
    act(() => typeInto(ed.root(), 'c11', 'd-edited'));
    await flush(1500);

    expect(save.mock.calls.length).toBeGreaterThan(0);
    expect(savedGrid(save.mock.calls.at(-1)?.[0] as OutputData)).toStrictEqual([['a', 'b'], ['c', 'd-edited']]);
    ed.unmount();
  });

  it('a cell edit right before unmount still reaches persistence.save', async () => {
    const save = vi.fn();
    const ed = mountWithPersistence(save);

    await waitFor(() => expect(ed.root().querySelectorAll('[data-blok-table-cell]')).toHaveLength(4), { timeout: 5000 });
    await flush(600);
    act(() => typeInto(ed.root(), 'c11', 'd-last'));
    await flush(50);
    ed.unmount();
    await flush(1500);

    expect(save.mock.calls.map((c) => savedGrid(c[0] as OutputData)[1][1])).toContain('d-last');
  });
});

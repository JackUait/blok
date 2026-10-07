import { afterEach, describe, expect, it, vi } from 'vitest';
import { blocksToMarkdown } from '../../../../../src/view';
import type { OutputBlockData, OutputData } from '../../../../../types';
import { boot, settle, viewTable, type Booted } from './roundtrip-harness';

/** Lift blocks a legacy collapse folded into `data.body.blocks` back to the top level. */
const flatten = (out: OutputData | undefined): OutputData | undefined => {
  if (out === undefined) {
    return undefined;
  }
  const walk = (blocks: OutputBlockData[]): OutputBlockData[] => blocks.flatMap(b => {
    const body = (b.data as { body?: { blocks?: OutputBlockData[] } }).body?.blocks;

    return [b, ...(Array.isArray(body) ? walk(body) : [])];
  });

  return { ...out, blocks: walk(out.blocks) };
};

// Legacy output stays HTML until task A3.
const LEGACY_HTML = { allowHtml: true };

const cellTexts = (out: OutputData | undefined): string[][] | undefined =>
  viewTable(flatten(out), 0, LEGACY_HTML)?.grid.map(row => row.map(cell => cell.texts.join(' | ')));

/** A legacy list makes the document "legacy", so save collapses to the legacy model. */
const legacyDocWithNestedTable = (): OutputData => ({
  blocks: [
    { id: 'l', type: 'list', data: { style: 'unordered', items: [{ content: 'one', items: [] }, { content: 'two', items: [] }] } },
    { id: 'tg', type: 'toggle', data: { text: 'Toggle' }, content: ['t'] },
    { id: 't', type: 'table', parent: 'tg', data: { withHeadings: true, content: [[{ blocks: ['a'], color: '#fbecdd' }, { blocks: ['b'] }]] }, content: ['a', 'b'] },
    { id: 'a', type: 'paragraph', parent: 't', data: { text: 'A' } },
    { id: 'b', type: 'paragraph', parent: 't', data: { text: 'B' } },
  ] as OutputBlockData[],
});

describe('extra round trips', () => {
  let booted: Booted | null = null;

  afterEach(() => {
    booted?.editor.destroy();
    booted?.holder.remove();
    booted = null;
    vi.restoreAllMocks();
  });

  for (const dataModel of ['auto', 'legacy'] as const) {
    it(`legacy-detected doc, table inside a toggle, dataModel ${dataModel}: save → render → save`, async () => {
      booted = await boot(legacyDocWithNestedTable(), { dataModel });
      const first = await booted.editor.save();

      expect(booted.onError).not.toHaveBeenCalled();
      expect(cellTexts(first)).toEqual([['paragraph:A', 'paragraph:B']]);

      await booted.editor.blocks.render(first as OutputData);
      await settle();
      const second = await booted.editor.save();

      expect(booted.onError).not.toHaveBeenCalled();
      expect(cellTexts(second)).toEqual([['paragraph:A', 'paragraph:B']]);
      expect(viewTable(flatten(second), 0, LEGACY_HTML)?.grid[0][0].color).toBe('#fbecdd');
    });

    it(`dataModel ${dataModel}: a legacy list's items all survive load → save`, async () => {
      booted = await boot(legacyDocWithNestedTable(), { dataModel });
      const out = flatten(await booted.editor.save());
      const items = (out?.blocks ?? []).filter(b => b.type === 'list')
        .flatMap(b => ((b.data as { items?: Array<{ content: string }> }).items ?? []).map(i => i.content));

      expect(items).toEqual(['one', 'two']);
    });
  }

  it('read-only: the table still shows its cell text right after blocks.update', async () => {
    booted = await boot({
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'] }, { blocks: ['b'] }]] } },
        { id: 'a', type: 'paragraph', parent: 't', data: { text: 'Alpha' } },
        { id: 'b', type: 'paragraph', parent: 't', data: { text: 'Bravo' } },
      ] as OutputBlockData[],
    }, { readOnly: true });
    await booted.editor.blocks.update('t', { withHeadings: true, content: [[{ blocks: ['a'] }, { blocks: ['b'] }]] });
    await settle();

    const cells = Array.from(booted.holder.querySelectorAll('[data-blok-table-cell]'), c => (c.textContent ?? '').trim());

    expect(cells).toEqual(['Alpha', 'Bravo']);
  });

  it('blocksToMarkdown emits a toggle child inside a cell once', () => {
    const md = blocksToMarkdown({
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['tg'] }, { blocks: ['b'] }]] }, content: ['tg', 'b'] },
        { id: 'tg', type: 'toggle', parent: 't', data: { text: 'Toggle' }, content: ['k'] },
        { id: 'k', type: 'paragraph', parent: 'tg', data: { text: 'Kidtext' } },
        { id: 'b', type: 'paragraph', parent: 't', data: { text: 'B' } },
      ] as OutputBlockData[],
    });

    expect(md.match(/Kidtext/g)).toHaveLength(1);
  });
});

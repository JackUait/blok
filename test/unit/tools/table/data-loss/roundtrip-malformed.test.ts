import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputBlockData, OutputData } from '../../../../../types';
import { allTexts, boot, settle, viewTable, type Booted } from './roundtrip-harness';

const table = (content: unknown[][], extra: Record<string, unknown> = {}, tableBlockExtra: Partial<OutputBlockData> = {}): OutputBlockData => ({
  id: 't',
  type: 'table',
  data: { withHeadings: false, withHeadingColumn: false, content, ...extra },
  ...tableBlockExtra,
});

const para = (id: string, text: string, parent?: string): OutputBlockData => ({
  id,
  type: 'paragraph',
  data: { text },
  ...(parent !== undefined ? { parent } : {}),
});

const cellTexts = (out: OutputData | undefined): string[][] | undefined =>
  viewTable(out)?.grid.map(row => row.map(cell => cell.texts.join(' | ')));

describe('malformed table data: what a load → save keeps', () => {
  let booted: Booted | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted?.editor.destroy();
    booted?.holder.remove();
    booted = null;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const loadAndSave = async (data: OutputData, readOnly = false): Promise<OutputData | undefined> => {
    vi.stubEnv('NODE_ENV', 'production');
    booted = await boot(data, { readOnly });

    if (readOnly) {
      await booted.editor.readOnly.set(false);
      await settle();
    }

    return booted.editor.save();
  };

  for (const readOnly of [false, true]) {
    const mode = readOnly ? 'read-only boot → edit' : 'edit boot';

    it(`${mode}: a block id listed in two cells keeps its text once`, async () => {
      const out = await loadAndSave({
        blocks: [
          table([[{ blocks: ['a'] }, { blocks: ['a'] }]]),
          para('a', 'A', 't'),
        ],
      }, readOnly);

      expect(allTexts(out).filter(t => t === 'paragraph:A')).toHaveLength(1);
    });

    it(`${mode}: a cell referencing a missing block keeps the rest of the row`, async () => {
      const out = await loadAndSave({
        blocks: [
          table([[{ blocks: ['missing', 'a'] }, { blocks: ['b'] }]]),
          para('a', 'A', 't'),
          para('b', 'B', 't'),
        ],
      }, readOnly);

      expect(cellTexts(out)).toEqual([['paragraph:A', 'paragraph:B']]);
    });

    it(`${mode}: a referenced cell block that has NO parent field keeps its text in the cell`, async () => {
      const out = await loadAndSave({
        blocks: [
          table([[{ blocks: ['a'] }, { blocks: ['b'] }]]),
          para('a', 'A'),
          para('b', 'B'),
        ],
      }, readOnly);

      expect(cellTexts(out)).toEqual([['paragraph:A', 'paragraph:B']]);
    });

    it(`${mode}: a child of the table that no cell references keeps its text`, async () => {
      const out = await loadAndSave({
        blocks: [
          table([[{ blocks: ['a'] }, { blocks: ['b'] }]]),
          para('a', 'A', 't'),
          para('b', 'B', 't'),
          para('ghost', 'Ghost', 't'),
        ],
      }, readOnly);

      expect(allTexts(out)).toContain('paragraph:Ghost');
      expect(cellTexts(out)).toEqual([['paragraph:A', 'paragraph:B']]);
    });

    it(`${mode}: the hierarchical content[] of the table lists a child no cell has`, async () => {
      const out = await loadAndSave({
        blocks: [
          table([[{ blocks: ['a'] }, { blocks: ['b'] }]], {}, { content: ['a', 'b', 'ghost'] }),
          para('a', 'A'),
          para('b', 'B'),
          para('ghost', 'Ghost'),
        ],
      }, readOnly);

      expect(allTexts(out)).toContain('paragraph:Ghost');
      expect(cellTexts(out)).toEqual([['paragraph:A', 'paragraph:B']]);
    });

    it(`${mode}: ragged rows keep every cell`, async () => {
      const out = await loadAndSave({
        blocks: [
          table([[{ blocks: ['a'] }, { blocks: ['b'] }, { blocks: ['c'] }], [{ blocks: ['d'] }]]),
          para('a', 'A', 't'),
          para('b', 'B', 't'),
          para('c', 'C', 't'),
          para('d', 'D', 't'),
        ],
      }, readOnly);

      expect(cellTexts(out)).toEqual([['paragraph:A', 'paragraph:B', 'paragraph:C'], ['paragraph:D', 'paragraph:', 'paragraph:']]);
    });

    it(`${mode}: blocks stored in a merge-covered cell keep their text`, async () => {
      const out = await loadAndSave({
        blocks: [
          table([
            [{ blocks: ['a'], colspan: 2 }, { blocks: ['y'], mergedInto: [0, 0] }],
            [{ blocks: ['c'] }, { blocks: ['d'] }],
          ]),
          para('a', 'A', 't'),
          para('y', 'Covered', 't'),
          para('c', 'C', 't'),
          para('d', 'D', 't'),
        ],
      }, readOnly);

      expect(allTexts(out)).toContain('paragraph:Covered');
    });

    it(`${mode}: colWidths whose length does not match the column count`, async () => {
      const out = await loadAndSave({
        blocks: [
          table([[{ blocks: ['a'] }, { blocks: ['b'] }]], { colWidths: [100, 200, 300] }),
          para('a', 'A', 't'),
          para('b', 'B', 't'),
        ],
      }, readOnly);

      expect(cellTexts(out)).toEqual([['paragraph:A', 'paragraph:B']]);
    });

    it(`${mode}: a merge whose covered cells are missing their mergedInto`, async () => {
      const out = await loadAndSave({
        blocks: [
          table([
            [{ blocks: ['a'], colspan: 2 }, { blocks: ['b'] }],
            [{ blocks: ['c'] }, { blocks: ['d'] }],
          ]),
          para('a', 'A', 't'),
          para('b', 'B', 't'),
          para('c', 'C', 't'),
          para('d', 'D', 't'),
        ],
      }, readOnly);

      expect(allTexts(out)).toEqual(['paragraph:A', 'paragraph:B', 'paragraph:C', 'paragraph:D']);
    });

    it(`${mode}: a cell with a {blocks:[], text} fallback keeps that text`, async () => {
      const out = await loadAndSave({
        blocks: [
          table([[{ blocks: [], text: 'Fallback text' }, { blocks: ['b'] }]]),
          para('b', 'B', 't'),
        ],
      }, readOnly);

      expect(cellTexts(out)).toEqual([['paragraph:Fallback text', 'paragraph:B']]);
    });

    it(`${mode}: two tables, the second referencing the first's block id`, async () => {
      const out = await loadAndSave({
        blocks: [
          table([[{ blocks: ['a'] }, { blocks: ['b'] }]]),
          para('a', 'A', 't'),
          para('b', 'B', 't'),
          { id: 't2', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'] }, { blocks: ['e'] }]] } },
          para('e', 'E', 't2'),
        ],
      }, readOnly);

      // Not a loss: the second table gets its own copy of A.
      expect(allTexts(out)).toEqual(['paragraph:A', 'paragraph:A', 'paragraph:B', 'paragraph:E']);
      expect(cellTexts(out)).toEqual([['paragraph:A', 'paragraph:B']]);
    });

    it(`${mode}: nested table inside a cell keeps its cells`, async () => {
      const out = await loadAndSave({
        blocks: [
          table([[{ blocks: ['inner'] }, { blocks: ['b'] }]]),
          { id: 'inner', type: 'table', parent: 't', data: { withHeadings: false, content: [[{ blocks: ['x'] }, { blocks: ['y'] }]] } },
          para('x', 'X', 'inner'),
          para('y', 'Y', 'inner'),
          para('b', 'B', 't'),
        ],
      }, readOnly);

      expect(allTexts(out)).toEqual(['paragraph:B', 'paragraph:X', 'paragraph:Y']);
      expect(cellTexts(out)?.[0][1]).toBe('paragraph:B');
      expect(viewTable(out, 1)?.grid.map(r => r.map(c => c.texts.join('|')))).toEqual([['paragraph:X', 'paragraph:Y']]);
    });
  }
});

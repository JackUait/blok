import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputBlockData, OutputData } from '../../../../../types';
import { allTexts, boot, settle, viewTable, type Booted } from './roundtrip-harness';

const cellTexts = (out: OutputData | undefined, index = 0): string[][] | undefined =>
  viewTable(out, index)?.grid.map(row => row.map(cell => cell.texts.join(' | ')));

const grid = [
  [{ blocks: ['a'], colspan: 2, color: '#fbecdd' }, { blocks: [], mergedInto: [0, 0] }],
  [{ blocks: ['c'] }, { blocks: ['d'] }],
];

const scenarios: Record<string, () => OutputData> = {
  'children listed before the table': () => ({
    blocks: [
      { id: 'a', type: 'paragraph', parent: 't', data: { text: 'A' } },
      { id: 'c', type: 'paragraph', parent: 't', data: { text: 'C' } },
      { id: 'd', type: 'paragraph', parent: 't', data: { text: 'D' } },
      { id: 't', type: 'table', data: { withHeadings: false, content: grid } },
    ] as OutputBlockData[],
  }),
  'table inside a toggle': () => ({
    blocks: [
      { id: 'tg', type: 'toggle', data: { text: 'Toggle' }, content: ['t'] },
      { id: 't', type: 'table', parent: 'tg', data: { withHeadings: false, content: grid }, content: ['a', 'c', 'd'] },
      { id: 'a', type: 'paragraph', parent: 't', data: { text: 'A' } },
      { id: 'c', type: 'paragraph', parent: 't', data: { text: 'C' } },
      { id: 'd', type: 'paragraph', parent: 't', data: { text: 'D' } },
    ] as OutputBlockData[],
  }),
  'table inside a callout': () => ({
    blocks: [
      { id: 'co', type: 'callout', data: { emoji: '', textColor: null, backgroundColor: null }, content: ['t'] },
      { id: 't', type: 'table', parent: 'co', data: { withHeadings: false, content: grid }, content: ['a', 'c', 'd'] },
      { id: 'a', type: 'paragraph', parent: 't', data: { text: 'A' } },
      { id: 'c', type: 'paragraph', parent: 't', data: { text: 'C' } },
      { id: 'd', type: 'paragraph', parent: 't', data: { text: 'D' } },
    ] as OutputBlockData[],
  }),
};

describe('table placement in the tree survives load → save', () => {
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

  for (const [name, make] of Object.entries(scenarios)) {
    for (const flow of ['edit', 'ro→edit', 'edit→ro→edit', 'render(saved)'] as const) {
      it(`${name}: ${flow}`, async () => {
        booted = await boot(make(), { readOnly: flow === 'ro→edit' });

        if (flow === 'ro→edit') {
          await booted.editor.readOnly.set(false);
          await settle();
        }
        if (flow === 'edit→ro→edit') {
          await booted.editor.readOnly.set(true);
          await settle();
          await booted.editor.readOnly.set(false);
          await settle();
        }
        if (flow === 'render(saved)') {
          const first = await booted.editor.save();

          await booted.editor.blocks.render(first as OutputData);
          await settle();
        }

        const out = await booted.editor.save();

        expect(booted.onError).not.toHaveBeenCalled();
        expect(cellTexts(out)).toEqual([['paragraph:A', ''], ['paragraph:C', 'paragraph:D']]);
        expect(viewTable(out)?.grid[0][0].color).toBe('#fbecdd');
        expect(allTexts(out).filter(t => t.startsWith('paragraph:'))).toEqual(['paragraph:A', 'paragraph:C', 'paragraph:D']);
        const table = out?.blocks.find(b => b.type === 'table');
        const expectedParent = make().blocks.find(b => b.id === 't')?.parent;

        expect(table?.parent).toBe(expectedParent);
      });
    }
  }

  it('a toggle with children inside a cell keeps its children', async () => {
    booted = await boot({
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['tg'] }, { blocks: ['b'] }]] }, content: ['tg', 'b'] },
        { id: 'tg', type: 'toggle', parent: 't', data: { text: 'Toggle' }, content: ['k'] },
        { id: 'k', type: 'paragraph', parent: 'tg', data: { text: 'Kid' } },
        { id: 'b', type: 'paragraph', parent: 't', data: { text: 'B' } },
      ] as OutputBlockData[],
    });
    await booted.editor.readOnly.set(true);
    await settle();
    await booted.editor.readOnly.set(false);
    await settle();
    const first = await booted.editor.save();

    await booted.editor.blocks.render(first as OutputData);
    await settle();
    const out = await booted.editor.save();

    expect(booted.onError).not.toHaveBeenCalled();
    expect(out?.blocks.find(b => b.id === 'k')?.parent).toBe('tg');
    expect(cellTexts(out)).toEqual([['toggle:Toggle', 'paragraph:B']]);
  });
});

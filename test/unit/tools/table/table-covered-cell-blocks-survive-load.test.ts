import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { OutputBlockData, OutputData } from '../../../../types';
import type { LegacyCellContent } from '../../../../src/tools/table/types';

const TABLE_ID = 'table-1';

// Blok's class type does not resolve under type-aware lint; the tests only
// need these members.
interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  readOnly: { set: (state: boolean) => Promise<boolean> };
}

/**
 * A merge racing a peer's edit leaves a block inside a covered cell. The model
 * rescues it into the origin (repairMergeStructure); the render path must not
 * throw it away afterwards.
 */
const buildDocument = (content: LegacyCellContent[][], texts: Record<string, string>): OutputData => {
  const table: OutputBlockData = {
    id: TABLE_ID,
    type: 'table',
    data: { withHeadings: false, withHeadingColumn: false, content },
  };

  const cells: OutputBlockData[] = Object.entries(texts).map(([id, text]) => ({
    id,
    type: 'paragraph',
    data: { text },
    parent: TABLE_ID,
  }));

  return { blocks: [table, ...cells] };
};

const TEXTS = { o: 'origin', y: 'rescued', a: 'A', b: 'B' };

const coveredCellWithBlock = (): LegacyCellContent[][] => [
  [{ blocks: ['o'], colspan: 2 }, { blocks: ['y'], mergedInto: [0, 0] }],
  [{ blocks: ['a'] }, { blocks: ['b'] }],
];

const savedIds = (output: OutputData): string[] => output.blocks.map(block => block.id ?? '');

const savedTableContent = (output: OutputData): Array<Array<{ blocks: string[] }>> => {
  const table = output.blocks.find(block => block.id === TABLE_ID);

  return (table?.data as { content: Array<Array<{ blocks: string[] }>> }).content;
};

describe('a block left in a merge-covered cell survives load', () => {
  let holder: HTMLElement;
  let blok: TestEditor | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    blok = null;
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  const boot = async (content: LegacyCellContent[][]): Promise<TestEditor> => {
    const instance = new Blok({
      holder,
      tools: { table: Table, paragraph: Paragraph },
      data: buildDocument(content, TEXTS),
    }) as unknown as TestEditor;

    blok = instance;
    await instance.isReady;

    return instance;
  };

  it('keeps the covered cell block and moves it into the origin on render', async () => {
    const instance = await boot(coveredCellWithBlock());

    const output = await instance.save();

    expect(savedIds(output)).toContain('y');
    expect(savedTableContent(output)[0][0].blocks).toStrictEqual(['o', 'y']);
    expect(savedTableContent(output)[0][1].blocks).toStrictEqual([]);
  });

  it('keeps the covered cell block when a read-only boot switches to editing', async () => {
    const instance = new Blok({
      holder,
      readOnly: true,
      tools: { table: Table, paragraph: Paragraph },
      data: buildDocument(coveredCellWithBlock(), TEXTS),
    }) as unknown as TestEditor;

    blok = instance;
    await instance.isReady;
    await instance.readOnly.set(false);

    const output = await instance.save();

    expect(savedIds(output)).toContain('y');
    expect(savedTableContent(output)[0][0].blocks).toStrictEqual(['o', 'y']);
  });

  it('keeps a block whose cell names a plain cell as its merge origin', async () => {
    const instance = await boot([
      [{ blocks: ['o'] }, { blocks: ['y'], mergedInto: [0, 0] }],
      [{ blocks: ['a'] }, { blocks: ['b'] }],
    ]);

    const output = await instance.save();

    expect(savedIds(output)).toContain('y');
  });
});

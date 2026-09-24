import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { ColumnList } from '../../../../src/tools/column-list';
import { Column } from '../../../../src/tools/column';
import { SpacerTool } from '../../../../src/tools/spacer';
import { collectSiblingBlocks } from '../../../../src/tools/spacer/alignment-guide';
import type { OutputBlockData } from '../../../../types';

/**
 * A heading with no text of its own is not an alignment target, toggle or not.
 * The toggle heading's body placeholder and its child blocks are not its text.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const createEditor = async (siblings: OutputBlockData[]): Promise<void> => {
  const siblingIds = siblings.filter((block) => block.parent === undefined).map((block) => block.id ?? '');

  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      header: Header,
      column_list: ColumnList,
      column: Column,
      spacer: SpacerTool,
    },
    data: {
      blocks: [
        { id: 'cl', type: 'column_list', data: {}, content: ['left', 'right'] },
        { id: 'left', type: 'column', data: {}, parent: 'cl', content: siblingIds },
        ...siblings.map((block) => (block.parent === undefined ? { ...block, parent: 'left' } : block)),
        { id: 'right', type: 'column', data: {}, parent: 'cl', content: ['sp'] },
        { id: 'sp', type: 'spacer', data: {}, parent: 'right' },
      ],
    },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
};

const collectedIds = (): string[] => {
  const spacer = holder?.querySelector<HTMLElement>('[data-blok-spacer]');

  if (spacer === null || spacer === undefined) {
    throw new Error('no spacer');
  }

  return collectSiblingBlocks(spacer).map((block) => block.getAttribute('data-blok-id') ?? '');
};

describe('spacer alignment targets around toggle headings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('skips an empty toggle heading, as it skips an empty heading', async () => {
    await createEditor([
      { id: 'eh', type: 'header', data: { text: '', level: 2 } },
      { id: 'eth', type: 'header', data: { text: '', level: 2, isToggleable: true } },
      { id: 'p', type: 'paragraph', data: { text: 'text' } },
    ]);

    expect(collectedIds()).toEqual(['p']);
  }, 30_000);

  it('skips a toggle heading with no title of its own but keeps its child', async () => {
    await createEditor([
      { id: 'eth', type: 'header', data: { text: '', level: 2, isToggleable: true, isOpen: true }, content: ['k'] },
      { id: 'k', type: 'paragraph', data: { text: 'kid' }, parent: 'eth' },
    ]);

    expect(collectedIds()).toEqual(['k']);
  }, 30_000);

  it('keeps a toggle heading with a title', async () => {
    await createEditor([
      { id: 'th', type: 'header', data: { text: 'Title', level: 2, isToggleable: true } },
    ]);

    expect(collectedIds()).toEqual(['th']);
  }, 30_000);
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { Paste } from '../../../../src/components/modules/paste';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { API, OutputBlockData, OutputData } from '../../../../types';

/**
 * Rows picked on a board or list are copied with `blocks.copy`, without their
 * database. Their title must reach every clipboard format, and a paste where
 * no database takes them must bring the title back, not an empty row page.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  caret: API['caret'];
  blocks: API['blocks'];
  module: { paste: Paste };
}

const quiet = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
};

const doc = (): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v', name: 'List', type: 'list', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha' }, position: 'a0' }, content: ['b1'] },
  { id: 'b1', type: 'paragraph', parent: 'r1', data: { text: 'Body one' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Bravo' }, position: 'a1' } },
  { id: 'target', type: 'paragraph', data: { text: '' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks: doc() },
  } as never) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await quiet();

  return instance;
};

const copyRows = (instance: TestEditor, ids: string[]): Map<string, string> => {
  const written = new Map<string, string>();

  instance.blocks.copy?.({
    preventDefault: () => undefined,
    clipboardData: { setData: (type: string, value: string): void => void written.set(type, value) },
  } as unknown as ClipboardEvent, ids);

  return written;
};

beforeEach(() => {
  vi.clearAllMocks();
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  vi.restoreAllMocks();
  editor?.destroy();
  editor = undefined;
  holder?.remove();
  holder = undefined;
});

describe('copying database rows without their database', () => {
  it('writes each row with its title and page body, in the given order, to every format', async () => {
    const instance = await make();
    const written = copyRows(instance, ['r2', 'r1']);
    const payload = JSON.parse(written.get('application/x-blok') ?? '[]') as Array<{ id: string; title?: string; parentId: string | null }>;

    expect(payload.map((entry) => [entry.id, entry.title, entry.parentId])).toEqual([['r2', 'Bravo', 'db'], ['r1', 'Alpha', 'db'], ['b1', undefined, 'r1']]);
    expect(written.get('text/plain')).toBe('**Bravo**\n\n**Alpha**\n\nBody one');
    expect(written.get('text/html')).toContain('<p>Bravo</p><p>Alpha</p>');
    expect(written.get('text/html')).toContain('Body one');
  });

  it('pastes into a paragraph outside a database as the titles, each page body after its title', async () => {
    const instance = await make();
    const written = copyRows(instance, ['r1', 'r2']);

    instance.caret.setToBlock('target', 'end');
    await instance.module.paste.processDataTransfer({
      getData: (type: string) => written.get(type) ?? '',
      types: [...written.keys()],
      files: [] as unknown as FileList,
    } as unknown as DataTransfer);
    await quiet();

    const blocks = (await instance.save()).blocks;
    const pasted = blocks.filter((block) => block.parent === undefined && block.type !== 'database');

    expect(blocks.filter((block) => block.type === 'database-row').map((block) => block.id)).toEqual(['r1', 'r2']);
    expect(pasted.map((block) => [block.type, block.data.text])).toEqual([
      ['paragraph', [{ text: 'Alpha' }]],
      ['paragraph', [{ text: 'Body one' }]],
      ['paragraph', [{ text: 'Bravo' }]],
    ]);
  });
});

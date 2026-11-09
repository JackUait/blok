import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../src/blok';
import { DocumentStore } from '../../src/components/modules/yjs/document-store';
import { Paragraph } from '../../src/tools/paragraph';
import { ListItem } from '../../src/tools/list';
import { Embed } from '../../src/tools/link/embed';
import { DatabaseTool } from '../../src/tools/database';
import { DatabaseRowTool } from '../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../types';
import type { DatabaseViewConfig, PropertyDefinition } from '../../src/tools/database/types';

/**
 * A re-render is not an edit. Re-rendering saved blocks must write nothing
 * to the document and stamp no `lastEditedAt`, or every reload and repaint
 * shows up in version history as an edit nobody made.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: { render: (data: OutputData) => Promise<void> };
  theme: { set: (mode: 'light' | 'dark' | 'auto') => void };
  i18n: { update: (options: { locale?: string; direction?: 'ltr' | 'rtl' }) => Promise<void> };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

/** Past the 400ms mutation batch, so any write-back a render provoked has flushed. */
const settle = async (): Promise<void> => {
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  await new Promise<void>((resolve) => { setTimeout(resolve, 600); });
};

const table = (id: string): DatabaseViewConfig => ({
  id, name: 'Table', type: 'table', position: 'a0', filters: [], sorts: [], visibleProperties: [],
});

const schema: PropertyDefinition[] = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  {
    id: 'st', name: 'Stage', type: 'status', position: 'a1',
    config: { options: [
      { id: 'todo', label: 'Not started', color: 'gray', position: 'a0', groupId: 'todo' },
      { id: 'done', label: 'Done', color: 'green', position: 'a1', groupId: 'complete' },
    ] },
  },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a2' },
];

const CASES: Array<{ tool: string; blocks: OutputBlockData[] }> = [
  {
    tool: 'checklist',
    blocks: [
      { id: 'c1', type: 'list', data: { text: 'Buy milk', style: 'checklist', checked: true } },
      { id: 'c2', type: 'list', data: { text: 'Call home', style: 'checklist', checked: false } },
    ],
  },
  {
    tool: 'embed',
    blocks: [
      {
        id: 'e1',
        type: 'embed',
        data: {
          service: 'youtube',
          source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          width: 580,
          height: 320,
          caption: 'A video',
        },
      },
    ],
  },
  {
    tool: 'database',
    blocks: [
      {
        id: 'db', type: 'database', content: ['r1', 'r2'],
        data: { title: 'Projects', schema, views: [table('v1')], activeViewId: 'v1' },
      },
      { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'First', st: 'todo' }, position: 'a0' } },
      { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Second', st: 'done', notes: 'n' }, position: 'a1' } },
    ],
  },
];

const make = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  if (holder === undefined) throw new Error('missing editor holder');
  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      list: ListItem,
      embed: Embed,
      database: { class: DatabaseTool },
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
  } as never) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

/** Every document write that changed something, and every edit stamp. */
const watchWrites = (): (() => string[]) => {
  const data = vi.spyOn(DocumentStore.prototype, 'updateBlockData');
  const prune = vi.spyOn(DocumentStore.prototype, 'pruneBlockData');
  const stamp = vi.spyOn(DocumentStore.prototype, 'updateBlockMetadata');

  return () => [
    ...data.mock.calls.filter((_, i) => data.mock.results[i]?.value === true).map((call) => `data ${String(call[0])}.${String(call[1])}`),
    ...prune.mock.calls.filter((_, i) => prune.mock.results[i]?.value === true).map((call) => `prune ${String(call[0])}`),
    ...stamp.mock.calls.map((call) => `stamp ${String(call[0])}`),
  ];
};

const stamped = (saved: OutputData): string[] =>
  saved.blocks.filter((block) => block.lastEditedAt !== undefined).map((block) => block.id ?? '');

describe('a re-render is not an edit', () => {
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

  it.each(CASES)('$tool: blocks.render of its own save writes nothing', async ({ blocks }) => {
    const instance = await make(blocks);
    const before = await instance.save();
    const writes = watchWrites();

    await instance.blocks.render(before);
    await settle();

    expect(writes()).toEqual([]);

    const after = await instance.save();

    expect(stamped(after)).toEqual([]);
    expect(after.blocks).toEqual(before.blocks);
  }, 60_000);

  it.each(CASES)('$tool: a theme and locale repaint writes nothing', async ({ blocks }) => {
    const instance = await make(blocks);
    const before = await instance.save();
    const writes = watchWrites();

    instance.theme.set('dark');
    await instance.i18n.update({ locale: 'ru' });
    await settle();
    instance.theme.set('light');
    await instance.i18n.update({ locale: 'en', direction: 'rtl' });
    await settle();

    expect(writes()).toEqual([]);

    const after = await instance.save();

    expect(stamped(after)).toEqual([]);
    expect(after.blocks).toEqual(before.blocks);
  }, 60_000);

  it('sees a real edit, so the checks above can fail', async () => {
    const instance = await make(CASES[0].blocks);
    const writes = watchWrites();
    const box = holder?.querySelector<HTMLInputElement>('[data-blok-id="c1"] input[type="checkbox"]');

    if (box === null || box === undefined) throw new Error('missing checklist box');
    box.click();
    await settle();

    expect(writes()).toContain('stamp c1');
    expect(stamped(await instance.save())).toEqual(['c1']);
  }, 60_000);
});

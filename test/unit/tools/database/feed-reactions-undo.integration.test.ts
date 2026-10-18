import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { DatabaseData, DatabaseRowData } from '../../../../src/tools/database/types';
import type { API, OutputBlockData, OutputData } from '../../../../types';
import { rowReactions } from '../../../../src/tools/database/row-reactions';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
}

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const quiet = async (): Promise<void> => {
  await settle();
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await settle();
};

const data: DatabaseData = {
  title: 'Posts',
  schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
  views: [{ id: 'v', name: 'Feed', type: 'feed', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
  activeViewId: 'v',
};

const doc = (): OutputBlockData[] => [
  { id: 'db', type: 'database', data, content: ['r1'] },
  { id: 'r1', type: 'database-row', parent: 'db', data: { title: 'Alpha', properties: { t: 'Alpha' }, position: 'a0', 'reactions:ada': { '👍': 1 } } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config: { people: { list: () => Promise.resolve([]), me: () => 'me' } } },
      'database-row': DatabaseRowTool,
    },
    data: { blocks: doc() },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

const row = async (): Promise<DatabaseRowData> =>
  (await editor?.save())?.blocks.find((block) => block.id === 'r1')?.data as DatabaseRowData;

const pill = (emoji: string): HTMLElement | undefined =>
  Array.from(holder?.querySelectorAll<HTMLElement>('[data-blok-database-feed-reaction]') ?? []).find((el) => el.getAttribute('data-emoji') === emoji);

describe('feed reactions and undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('undo takes back the edit before a reaction and leaves the reaction', async () => {
    await make();
    const before = await row();

    await editor?.blocks.update('r1', { ...before, title: 'Beta', properties: { t: 'Beta' } });
    await quiet();
    pill('👍')?.click();
    await quiet();
    expect(rowReactions(await row())?.me?.['👍']).toEqual(expect.any(Number));

    editor?.history.undo();
    await quiet();

    const undone = await row();

    expect(rowReactions(undone)?.me?.['👍']).toEqual(expect.any(Number));
    expect(undone.properties.t).toBe('Alpha');

    editor?.history.redo();
    await quiet();

    const redone = await row();

    expect(redone.properties.t).toBe('Beta');
    expect(rowReactions(redone)?.me?.['👍']).toEqual(expect.any(Number));
  });

  it('taking back your only reaction leaves no key of yours in the saved row', async () => {
    await make();

    pill('👍')?.click();
    await quiet();
    expect('reactions:me' in (await row())).toBe(true);
    pill('👍')?.click();
    await quiet();

    const saved = await row();

    expect('reactions:me' in saved).toBe(false);
    expect(rowReactions(saved)).toEqual({ ada: { '👍': 1 } });
  });

  it('a reaction is not an undo step of its own, nor an edit of the page', async () => {
    await make();

    pill('👍')?.click();
    await quiet();
    expect((await editor?.save())?.blocks.find((block) => block.id === 'r1')?.lastEditedAt).toBeUndefined();
    editor?.history.undo();
    await quiet();

    expect(rowReactions(await row())).toEqual({ ada: { '👍': 1 }, me: { '👍': expect.any(Number) } });
    expect(pill('👍')?.textContent).toBe('👍2');
  });
});

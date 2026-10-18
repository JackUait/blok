import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import type { DatabaseData } from '../../../../src/tools/database/types';
import type { API, OutputBlockData, OutputData } from '../../../../types';

/**
 * research/19 §2d: a feed card ends with an "Add a comment…" composer. After
 * the first comment the composer becomes a "1 reply · <time>" row that opens
 * the thread.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
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
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha' }, position: 'a0' } },
];

if (typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (config: Record<string, unknown> = {}, readOnly = false): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    readOnly,
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config },
    },
    data: { blocks: doc() },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

const card = (): HTMLElement => {
  const el = holder?.querySelector<HTMLElement>('[data-blok-database-feed-card][data-row-id="r1"]');

  if (el === null || el === undefined) throw new Error('no card');

  return el;
};

const cardInput = (): HTMLTextAreaElement | null => card().querySelector<HTMLTextAreaElement>('[data-blok-database-comment-input]');

const summary = (): HTMLButtonElement | null => card().querySelector<HTMLButtonElement>('[data-blok-database-feed-comments-summary]');

const type = async (field: HTMLTextAreaElement, text: string): Promise<void> => {
  const input = field;

  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await quiet();
};

describe('feed card comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a card ends with an "Add a comment…" composer whose first comment turns it into "1 reply" with a time', async () => {
    await make();
    const input = cardInput();

    expect(input?.placeholder).toBe('Add a comment…');
    if (input === null) throw new Error('no composer');
    await type(input, 'Nice post');

    const saved = ((await editor?.save())?.blocks ?? []).filter((block) => block.type === 'database-comment');

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ parent: 'r1', data: { text: 'Nice post' } });
    expect(cardInput()).toBeNull();
    expect(summary()?.querySelector('[data-blok-database-feed-comments-count]')?.textContent).toBe('1 reply');
    expect(summary()?.querySelector('[data-blok-database-feed-comments-time]')?.textContent).not.toBe('');
  });

  it('the summary opens the thread with a reply composer, and a reply counts as "2 replies"', async () => {
    await make();
    const input = cardInput();

    if (input === null) throw new Error('no composer');
    await type(input, 'First');
    summary()?.click();
    await quiet();

    const popover = document.querySelector<HTMLElement>('[data-blok-popover] [data-blok-database-comments]');

    expect(popover?.querySelector('[data-blok-database-comment-text]')?.textContent).toBe('First');
    const reply = popover?.querySelector<HTMLTextAreaElement>('[data-blok-database-comment-input]');

    if (reply === null || reply === undefined) throw new Error('no reply composer');
    await type(reply, 'Second');

    expect(summary()?.querySelector('[data-blok-database-feed-comments-count]')?.textContent).toBe('2 replies');
  });

  it('a resolved thread no longer counts: the card shows the composer again', async () => {
    await make();
    const input = cardInput();

    if (input === null) throw new Error('no composer');
    await type(input, 'Done?');
    summary()?.click();
    await quiet();
    document.querySelector<HTMLElement>('[data-blok-database-comment-resolve]')?.click();
    await quiet();

    expect(summary()).toBeNull();
    expect(cardInput()).not.toBeNull();
  });

  it('shows no comment box where the host owns the footer, gives a comments hook, or denies comments', async () => {
    for (const config of [
      { feedFooter: () => undefined },
      { comments: { open: vi.fn() } },
      { permissions: { can: (action: string) => action !== 'comment' } },
    ]) {
      await make(config);

      expect(card().querySelector('[data-blok-database-feed-comments]')).toBeNull();
      editor?.destroy();
      editor = undefined;
    }
  });

  it('read-only shows no composer on a card without comments', async () => {
    await make({}, true);

    expect(cardInput()).toBeNull();
  });
});

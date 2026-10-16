import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { API, BlockTool, OutputBlockData, OutputData } from '../../../../types';

/**
 * A row's children that are annotations (comment threads) are not its page.
 * The note tool is a host tool, so this pins the lever, not a block name.
 */
class Note implements BlockTool {
  public static isAnnotation = true;
  private readonly text: string;

  constructor({ data }: { data: { text?: string } }) {
    this.text = data.text ?? '';
  }

  public render(): HTMLElement {
    const el = document.createElement('div');

    el.textContent = this.text;

    return el;
  }

  public save(): { text: string } {
    return { text: this.text };
  }
}

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

const doc = (viewType = 'table'): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v', name: 'View', type: viewType, position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
    },
    content: ['r1', 'tpl'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' }, content: ['n1'] },
  { id: 'n1', type: 'note', parent: 'r1', data: { text: 'note secret' } },
  { id: 'tpl', type: 'database-row', parent: 'db', data: { properties: { t: 'Bug' }, position: 'a1', template: true }, content: ['tb', 'tn'] },
  { id: 'tb', type: 'paragraph', parent: 'tpl', data: { text: 'template body' } },
  { id: 'tn', type: 'note', parent: 'tpl', data: { text: 'template note secret' } },
];

if (typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool, note: Note },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

const openRow = async (rowId: string): Promise<void> => {
  const button = holder?.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-blok-database-table-open]`)
    ?? holder?.querySelector<HTMLElement>(`[data-blok-database-table-open][data-row-id="${rowId}"]`);

  button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await quiet();
};

const childrenOf = async (rowId: string): Promise<Array<string | undefined>> =>
  ((await editor?.save())?.blocks ?? []).filter((block) => block.parent === rowId).map((block) => block.type);

describe('a row page ignores its annotations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('starts the first paragraph from the empty-page placeholder of a row that holds only a thread', async () => {
    await make(doc());
    await openRow('r1');

    const placeholder = holder?.querySelector<HTMLElement>('[data-blok-database-drawer-editor] [data-blok-database-row-empty]');
    const css = readFileSync(resolve(__dirname, '../../../../src/styles/database.css'), 'utf8');
    const hideRule = /([^{}]+)\{\s*display:\s*none;\s*\}/g;
    const hidden = [...css.matchAll(hideRule)]
      .map((match) => match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim())
      .filter((selector) => selector.endsWith('[data-blok-database-row-empty]'));

    expect(hidden).toHaveLength(1);
    expect(placeholder?.matches(hidden[0])).toBe(false);

    placeholder?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await quiet();

    expect(await childrenOf('r1')).toEqual(['note', 'paragraph']);
    expect(placeholder?.matches(hidden[0])).toBe(true);
  });

  it('applies a template to a row that holds only a thread, without copying the template\'s threads', async () => {
    await make(doc());
    editor?.blocks.getById('db')?.call('applyTemplate', { rowId: 'r1', templateId: 'tpl' });
    await quiet();

    expect(await childrenOf('r1')).toEqual(['note', 'paragraph']);
    expect(((await editor?.save())?.blocks ?? []).filter((block) => block.type === 'note')).toHaveLength(2);
  });

  it('shows no thread text in a feed card', async () => {
    await make(doc('feed'));

    const feed = holder?.querySelector('[data-blok-database-feed]');

    expect(feed?.textContent).toContain('One');
    expect(feed?.textContent).not.toContain('secret');
  });
});

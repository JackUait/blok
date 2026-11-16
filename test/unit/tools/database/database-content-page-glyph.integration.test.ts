import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { API, OutputBlockData } from '../../../../types';

/**
 * notion-motion.md, Round 45 gap 2: a row whose page has a body shows the
 * "page with lines" glyph. Table and list show the blank page glyph for the
 * other rows; board, gallery and calendar show none for them.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
}

type Layout = 'table' | 'list' | 'board' | 'gallery' | 'calendar' | 'timeline';

const quiet = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
};

const today = (): string => {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const SCHEMA = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'due', name: 'Due', type: 'date', position: 'a1' },
  { id: 's', name: 'Stage', type: 'select', position: 'a2', config: { options: [{ id: 'o1', label: 'One', color: 'gray', position: 'a0' }] } },
];

const doc = (layout: Layout, extra: OutputBlockData[] = []): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v', name: 'View', type: layout, ...(layout === 'board' ? { groupBy: 's' } : {}), ...(layout === 'timeline' ? { showTimelineTable: true } : {}), position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
    },
    content: ['body', 'blank', 'emoji', ...extra.filter((block) => block.type === 'database-row').map((block) => block.id ?? '')],
  },
  { id: 'body', type: 'database-row', parent: 'db', content: ['p1'], data: { properties: { t: 'Body', due: today(), s: 'o1' }, position: 'a0' } },
  { id: 'p1', type: 'paragraph', parent: 'body', data: { text: 'A body line' } },
  { id: 'blank', type: 'database-row', parent: 'db', data: { properties: { t: 'Blank', due: today(), s: 'o1' }, position: 'a1' } },
  { id: 'emoji', type: 'database-row', parent: 'db', content: ['p2'], data: { properties: { t: 'Emoji', due: today(), s: 'o1' }, position: 'a2', icon: '🥌' } },
  { id: 'p2', type: 'paragraph', parent: 'emoji', data: { text: 'Another body' } },
  ...extra,
];

/** notion-motion.md Round 46 §C.1: Notion's rows with one and with two empty lines. */
const EMPTY_LINES: OutputBlockData[] = [
  { id: 'one', type: 'database-row', parent: 'db', content: ['e1'], data: { properties: { t: 'One empty line', due: today(), s: 'o1' }, position: 'a3' } },
  { id: 'e1', type: 'paragraph', parent: 'one', data: { text: '' } },
  { id: 'two', type: 'database-row', parent: 'db', content: ['e2', 'e3'], data: { properties: { t: 'Two empty lines', due: today(), s: 'o1' }, position: 'a4' } },
  { id: 'e2', type: 'paragraph', parent: 'two', data: { text: '' } },
  { id: 'e3', type: 'paragraph', parent: 'two', data: { text: '' } },
];

const ROW_SELECTOR: Record<Layout, string> = {
  table: '[data-blok-database-table-row]',
  list: '[data-blok-database-list-row]',
  board: '[data-blok-database-card]',
  gallery: '[data-blok-database-gallery-card]',
  calendar: '[data-blok-database-calendar-event]',
  timeline: '[data-blok-database-timeline-table-row]',
};

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (layout: Layout, extra: OutputBlockData[] = []): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: { class: DatabaseTool, config: {} }, 'database-row': DatabaseRowTool },
    data: { blocks: doc(layout, extra) },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

/** Which glyph a row shows before its title: 'content', 'blank', 'emoji' or 'none'. */
const glyphOf = (layout: Layout, rowId: string): string => {
  const row = holder?.querySelector(`${ROW_SELECTOR[layout]}[data-row-id="${rowId}"]`);

  if (row === null || row === undefined) {
    throw new Error(`no ${layout} row ${rowId}`);
  }
  if (row.querySelector('[data-blok-database-page-icon]') !== null) return 'emoji';
  const placeholder = row.querySelector('[data-blok-database-page-icon-placeholder]');

  if (placeholder === null) return 'none';

  return placeholder.getAttribute('data-blok-database-page-icon-placeholder') === 'content' ? 'content' : 'blank';
};

describe('content page glyph', () => {
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

  it.each([
    ['table', 'blank'],
    ['list', 'blank'],
    ['board', 'none'],
    ['gallery', 'none'],
    ['calendar', 'none'],
    ['timeline', 'blank'],
  ] as const)('%s: a row with a body shows the lines glyph, a blank row shows %s, an emoji stays', async (layout, blank) => {
    await make(layout);

    expect(glyphOf(layout, 'body')).toBe('content');
    expect(glyphOf(layout, 'blank')).toBe(blank);
    expect(glyphOf(layout, 'emoji')).toBe('emoji');
  });

  it('the content glyph is the page with lines', async () => {
    await make('board');

    const glyph = holder?.querySelector('[data-blok-database-card][data-row-id="body"] [data-blok-database-page-icon-placeholder]');

    expect(glyph?.querySelectorAll('svg path')).toHaveLength(1);
    expect(glyph?.querySelector('svg path')?.getAttribute('d')).toBe('M7.5 7h5M7.5 10h5M7.5 13h3');
  });

  it.each(['list', 'board'] as const)('%s: the glyph follows a body added, removed and undone', async (layout) => {
    const blok = await make(layout);

    blok.blocks.insertAt('paragraph', { text: 'new' }, { parentId: 'blank', position: 'end', id: 'b1' });
    await quiet();
    expect(glyphOf(layout, 'blank')).toBe('content');

    blok.history.undo();
    await quiet();
    expect(glyphOf(layout, 'blank')).toBe(layout === 'list' ? 'blank' : 'none');

    await blok.blocks.delete(blok.blocks.getBlockIndex('p1'));
    await quiet();
    expect(glyphOf(layout, 'body')).toBe(layout === 'list' ? 'blank' : 'none');
  });

  // notion-motion.md Round 46 §C.1: one empty line shows the blank page; two empty lines show the lines glyph.
  it.each(['table', 'list'] as const)('%s: one empty line is no body, two empty lines are', async (layout) => {
    await make(layout, EMPTY_LINES);

    expect(glyphOf(layout, 'one')).toBe('blank');
    expect(glyphOf(layout, 'two')).toBe('content');
  });

  it('typing into the one empty line shows the lines glyph', async () => {
    const blok = await make('list', EMPTY_LINES);

    expect(glyphOf('list', 'one')).toBe('blank');
    await blok.blocks.update('e1', { text: 'Typed' });
    await quiet();

    expect(glyphOf('list', 'one')).toBe('content');
  });

  it.each(['timeline', 'calendar'] as const)('the %s No date list picks the glyph by body too', async (layout) => {
    const blok = await make(layout);

    blok.blocks.insertAt('database-row', { properties: { t: 'Undated' }, position: 'a3' }, { parentId: 'db', position: 'end', id: 'undated' });
    blok.blocks.insertAt('paragraph', { text: 'body' }, { parentId: 'undated', position: 'end', id: 'p3' });
    blok.blocks.insertAt('database-row', { properties: { t: 'Undated blank' }, position: 'a4' }, { parentId: 'db', position: 'end', id: 'undated-blank' });
    await quiet();
    holder?.querySelector<HTMLElement>('[data-blok-database-no-date-button]')?.click();
    await quiet();

    const glyph = (rowId: string): string | null | undefined => document
      .querySelector(`[data-blok-database-no-date-row][data-row-id="${rowId}"] [data-blok-database-page-icon-placeholder]`)
      ?.getAttribute('data-blok-database-page-icon-placeholder');

    expect(glyph('undated')).toBe('content');
    expect(glyph('undated-blank')).toBe('');
  });

  it('a second body block redraws nothing', async () => {
    const blok = await make('list');
    const before = holder?.querySelector('[data-blok-database-list-row][data-row-id="body"]');

    blok.blocks.insertAt('paragraph', { text: 'more' }, { parentId: 'body', position: 'end', id: 'b2' });
    await quiet();

    expect(holder?.querySelector('[data-blok-database-list-row][data-row-id="body"]')).toBe(before);
  });
});

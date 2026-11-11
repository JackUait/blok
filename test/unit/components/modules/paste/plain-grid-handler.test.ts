/**
 * Plain tab-separated text pasted outside a table becomes a table, like the
 * same paste inside a table (USER decision #2, case table-O9).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PlainGridHandler } from '../../../../../src/components/modules/paste/handlers/plain-grid-handler';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';

interface Setup {
  blok: BlokModules;
  insert: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  insertAt: ReturnType<typeof vi.fn>;
}

const setup = (options: { tools?: string[]; parent?: { tool: { childTools?: { allow?: string[]; deny?: string[] } } } } = {}): Setup => {
  const insert = vi.fn(() => ({ id: 'table-1', name: 'table' }));
  const show = vi.fn();
  const insertAt = vi.fn();
  const tools = options.tools ?? ['paragraph', 'table'];
  const holder = document.createElement('div');
  const blok = {
    BlockManager: {
      currentBlock: { id: 'p1', name: 'paragraph', parentId: options.parent === undefined ? null : 'parent', holder },
      getBlockById: vi.fn((id: string) => (id === 'parent' ? options.parent : undefined)),
      insert,
    },
    Caret: { setToBlock: vi.fn(), positions: { END: 'end' } },
    Tools: { blockTools: new Map(tools.map((name) => [name, {}])) },
    NotifierAPI: { methods: { show } },
    BlocksAPI: {
      methods: {
        getById: vi.fn((id: string) => ({ id })),
        getBlockIndex: vi.fn(() => 0),
        insertAt,
        delete: vi.fn(async () => undefined),
        beginTransaction: vi.fn(),
        endTransaction: vi.fn(),
      },
    },
    I18n: { t: (key: string) => key },
  } as unknown as BlokModules;

  return { blok, insert, show, insertAt };
};

const handler = (blok: BlokModules): PlainGridHandler =>
  new PlainGridHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder);

const cellTexts = (insert: ReturnType<typeof vi.fn>): unknown => {
  const call = insert.mock.calls[0]?.[0] as { data: { content: unknown[][] } } | undefined;

  return call?.data.content;
};

describe('PlainGridHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pastes a TSV grid as one table with the same rows and columns', async () => {
    const { blok, insert } = setup();

    expect(await handler(blok).handle('A\tB\tC\n1\t2\t3\n', { canReplaceCurrentBlock: true })).toBe(true);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ tool: 'table', replace: true, origin: 'paste' }));
    expect(cellTexts(insert)).toEqual([['A', 'B', 'C'], ['1', '2', '3']]);
  });

  it('reads CRLF line ends', async () => {
    const { blok, insert } = setup();

    await handler(blok).handle('A\tB\r\n1\t2\r\n', { canReplaceCurrentBlock: false });

    expect(cellTexts(insert)).toEqual([['A', 'B'], ['1', '2']]);
  });

  it('keeps pasted markup as text in the cells', async () => {
    const { blok, insert } = setup();

    await handler(blok).handle('<b>x</b>\t<img src=x onerror=alert(1)>\n1\t2', { canReplaceCurrentBlock: true });

    expect(cellTexts(insert)).toEqual([['&lt;b&gt;x&lt;/b&gt;', '&lt;img src=x onerror=alert(1)&gt;'], ['1', '2']]);
  });

  it.each([
    ['one line', 'A\tB'],
    ['a Makefile', 'build:\n\tcc main.c\n\tcc util.c'],
    ['tab-indented code', '\tfoo()\n\tbar()'],
    ['uneven columns', 'A\tB\tC\n1\t2'],
    ['a blank line inside', 'A\tB\n\n1\t2'],
    ['text with no tabs', 'Hello\nthere'],
  ])('leaves %s as text', (_name, text) => {
    const { blok } = setup();

    expect(handler(blok).canHandle(text)).toBe(0);
  });

  it('leaves the text alone when the editor has no table tool', () => {
    const { blok } = setup({ tools: ['paragraph'] });

    expect(handler(blok).canHandle('A\tB\n1\t2')).toBe(0);
  });

  it('leaves a grid bigger than the cell cap as text', () => {
    const { blok } = setup();
    const row = Array.from({ length: 101 }, () => 'x').join('\t');
    const text = Array.from({ length: 100 }, () => row).join('\n');

    expect(handler(blok).canHandle(text)).toBe(0);
  });

  it('leaves the text alone when the container of the caret denies tables', async () => {
    const { blok, insert } = setup({ parent: { tool: { childTools: { allow: ['paragraph'] } } } });

    expect(await handler(blok).handle('A\tB\n1\t2', { canReplaceCurrentBlock: true })).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it('leaves a paste aimed at a table cell to the table', async () => {
    const { blok, insert } = setup();
    const cell = document.createElement('div');
    const target = document.createElement('div');

    cell.setAttribute('data-blok-table-cell', '');
    cell.appendChild(target);

    expect(await handler(blok).handle('A\tB\n1\t2', { canReplaceCurrentBlock: true, pasteTarget: target })).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it('offers to turn the pasted table into a database, and the offer replaces the table', async () => {
    const { blok, show, insertAt } = setup({ tools: ['paragraph', 'table', 'database', 'database-row'] });

    await handler(blok).handle('Task\tPoints\nWrite\t3', { canReplaceCurrentBlock: true });

    expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: 'tools.database.csvPasteOffer' }));
    const action = (show.mock.calls[0]?.[0] as { actions?: Array<{ onClick: () => void }> }).actions?.[0];

    action?.onClick();
    await vi.waitFor(() => expect(insertAt).toHaveBeenCalledWith('database', expect.anything(), expect.objectContaining({ replace: 'table-1' })));
  });

  it('offers no database without the database tools', async () => {
    const { blok, show } = setup();

    await handler(blok).handle('Task\tPoints\nWrite\t3', { canReplaceCurrentBlock: true });

    expect(show).not.toHaveBeenCalled();
  });
});

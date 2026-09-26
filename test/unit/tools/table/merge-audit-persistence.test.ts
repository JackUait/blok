import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import { blocksToHtml, blocksToMarkdown, blocksToPlainText } from '../../../../src/view';
import { CELL_ATTR } from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { LegacyCellContent, TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions, OutputBlockData, OutputData } from '../../../../types';

const TABLE_ID = 'table-1';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  readOnly: { set: (state: boolean) => Promise<boolean> };
  blocks: {
    update: (id: string, data: Partial<TableData>) => Promise<unknown>;
    getById: (id: string) => { contentIds: readonly string[] } | null;
  };
  history: { canUndo: () => boolean };
}

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

const TEXTS = { o: 'origin', y: 'rescued', a: 'Alpha', b: 'Bravo', d: 'Delta' };

/** A block left inside a merge-covered cell (merge raced a peer's edit). */
const coveredCellWithBlock = (): LegacyCellContent[][] => [
  [{ blocks: ['o'], colspan: 2 }, { blocks: ['y'], mergedInto: [0, 0] }],
  [{ blocks: ['a'] }, { blocks: ['b'] }],
];

/** A plain cell (no mergedInto) sitting in a slot a live 2x2 span claims. */
const plainCellInsideSpan = (): LegacyCellContent[][] => [
  [{ blocks: ['o'], colspan: 2, rowspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
  [{ blocks: [], mergedInto: [0, 0] }, { blocks: ['d'] }],
];

/** An origin whose colspan reaches past the last column. */
const colspanPastGrid = (): LegacyCellContent[][] => [
  [{ blocks: ['o'], colspan: 3 }, { blocks: [], mergedInto: [0, 0] }],
  [{ blocks: ['a'] }, { blocks: ['b'] }],
];

/** A legacy string cell in a slot a live span claims. */
const legacyStringInsideSpan = (): LegacyCellContent[][] => [
  [{ blocks: ['a'], colspan: 2 }, 'legacy'],
  [{ blocks: ['b'] }, { blocks: ['d'] }],
];

/** Each row's occupied width in the rendered tbody, honouring rowspans. */
const rowWidths = (table: HTMLTableElement): number[] => {
  const rows = Array.from(table.querySelectorAll('tbody > tr'));
  const occupied: Array<Set<number>> = rows.map(() => new Set<number>());

  rows.forEach((row, r) => {
    Array.from(row.querySelectorAll<HTMLTableCellElement>(`[${CELL_ATTR}]`)).reduce((cursor, td) => {
      const start = Array.from({ length: 1000 }, (_, i) => cursor + i).find(c => !occupied[r].has(c)) ?? cursor;

      Array.from({ length: td.rowSpan || 1 }).forEach((_, dr) => {
        Array.from({ length: td.colSpan || 1 }).forEach((__, dc) => {
          occupied[r + dr]?.add(start + dc);
        });
      });

      return start + (td.colSpan || 1);
    }, 0);
  });

  return occupied.map(set => set.size);
};

const colCount = (table: HTMLTableElement): number => table.querySelectorAll('colgroup > col').length;

const savedIds = (output: OutputData): string[] => output.blocks.map(block => block.id ?? '');

const savedTableContent = (output: OutputData): LegacyCellContent[][] => {
  const table = output.blocks.find(block => block.id === TABLE_ID);

  return (table?.data as TableData).content;
};

describe('merge audit: saved-document renderers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocksToHtml keeps the text of a block left in a merge-covered cell', () => {
    const html = blocksToHtml(buildDocument(coveredCellWithBlock(), TEXTS));

    expect(html).toContain('rescued');
  });

  it('blocksToPlainText keeps the text of a block left in a merge-covered cell', () => {
    const text = blocksToPlainText(buildDocument(coveredCellWithBlock(), TEXTS));

    expect(text).toContain('rescued');
  });

  it('blocksToMarkdown keeps the text of a block left in a merge-covered cell', () => {
    const markdown = blocksToMarkdown(buildDocument(coveredCellWithBlock(), TEXTS));

    expect(markdown).toContain('rescued');
  });

  it('blocksToHtml emits no extra <td> for a plain cell inside a live span', () => {
    const html = blocksToHtml(buildDocument(plainCellInsideSpan(), TEXTS));
    const host = document.createElement('div');

    host.innerHTML = html;
    const rows = Array.from(host.querySelectorAll('tr'));

    // Row 1 is fully claimed by the 2x2 origin in a 2-column grid.
    expect(rows[1]?.querySelectorAll('td').length).toBe(0);
  });

  it('blocksToHtml shows a legacy string cell a live span claims inside the merged cell, after the origin', () => {
    const html = blocksToHtml(buildDocument(legacyStringInsideSpan(), TEXTS));

    expect(html).toContain('<td colspan="2"><p>Alpha</p>legacy</td>');
  });

  it('blocksToPlainText shows a legacy string cell a live span claims inside the merged cell', () => {
    const text = blocksToPlainText(buildDocument(legacyStringInsideSpan(), TEXTS));

    expect(text.split('\n\n')[0]).toBe('Alpha\nlegacy\nBravo\tDelta');
  });

  it('blocksToHtml keeps a text-only cell a live span claims, and a declared cover stays hidden', () => {
    const html = blocksToHtml(buildDocument([
      [{ blocks: ['a'], colspan: 3 }, { blocks: [], text: 'claimed' }, { blocks: [], text: 'stale', mergedInto: [0, 0] }],
    ], TEXTS));

    expect(html).toBe('<table><tbody><tr><td colspan="3"><p>Alpha</p>claimed</td></tr></tbody></table>');
  });

  it('blocksToPlainText keeps a text-only cell a live span claims', () => {
    const text = blocksToPlainText(buildDocument([
      [{ blocks: [], text: 'own', colspan: 2 }, { blocks: [], text: 'claimed' }],
    ], TEXTS));

    expect(text.split('\n\n')[0]).toBe('own\nclaimed');
  });

  it('blocksToHtml clamps a colspan that reaches past the last column', () => {
    const html = blocksToHtml(buildDocument(colspanPastGrid(), TEXTS));

    expect(html).not.toContain('colspan="3"');
  });
});

describe('merge audit: editor load of malformed merge data', () => {
  let holder: HTMLElement;
  let blok: TestEditor | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    blok = null;
  });

  afterEach(async () => {
    // Let the editor's deferred work finish; destroying mid-flight leaks into the next test's editor.
    await new Promise(resolve => setTimeout(resolve, 50));
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  const boot = async (content: LegacyCellContent[][], readOnly = false, texts: Record<string, string> = TEXTS): Promise<TestEditor> => {
    const instance = new Blok({
      holder,
      readOnly,
      tools: { table: Table, paragraph: Paragraph },
      data: buildDocument(content, texts),
    }) as unknown as TestEditor;

    blok = instance;
    await instance.isReady;

    return instance;
  };

  const tableEl = (): HTMLTableElement => {
    const el = holder.querySelector('table');

    if (el === null) {
      throw new Error('no table rendered');
    }

    return el;
  };

  it('read-only shows the text of a block left in a merge-covered cell inside the table', async () => {
    await boot(coveredCellWithBlock(), true);

    expect(tableEl().textContent).toContain('rescued');
  });

  it('read-only does not show a block left in a merge-covered cell as a loose paragraph outside the table', async () => {
    await boot(coveredCellWithBlock(), true);

    const rescued = Array.from(holder.querySelectorAll('[data-blok-id]')).find(el => el.textContent === 'rescued');

    expect(rescued?.closest('table') ?? null).not.toBeNull();
  });

  it('a legacy string cell a live span claims shows inside the merged cell, as the view renders it', async () => {
    await boot(legacyStringInsideSpan(), true);

    expect(tableEl().querySelector('td[colspan="2"]')?.textContent).toBe('Alphalegacy');
  });

  /** Texts of the saved blocks in the origin cell, in order. */
  const originTexts = (output: OutputData): string[] => {
    const origin = savedTableContent(output)[0][0];
    const ids = typeof origin === 'string' ? [] : origin.blocks;

    return ids.map(id => {
      const text = output.blocks.find(block => block.id === id)?.data.text;

      return typeof text === 'string' ? text : '';
    });
  };

  /** A text-only cell a live span claims, beside a declared cover whose text is stale. */
  const textCellInsideSpan = (): LegacyCellContent[][] => [
    [{ blocks: ['a'], colspan: 3 }, { blocks: [], text: 'claimed' }, { blocks: [], text: 'stale', mergedInto: [0, 0] }],
  ];

  /** A text-only origin and a legacy string cell its span claims. */
  const textOriginWithLegacyString = (): LegacyCellContent[][] => [
    [{ blocks: [], text: 'orig', colspan: 2 }, 'legacy'],
    [{ blocks: ['b'] }, { blocks: ['d'] }],
  ];

  // Read-only paints no record `text` even outside a merge (mountCellBlocksReadOnly),
  // so the DOM checks run in edit mode; the read-only cases check the save after a toggle.
  it('edit mode: a text-only cell a live span claims shows after the origin', async () => {
    await boot(textCellInsideSpan());

    expect(tableEl().querySelector('td[colspan="3"]')?.textContent).toBe('Alphaclaimed');
  });

  it.each([false, true])('a text-only cell a live span claims is saved inside the origin (readOnly=%s)', async (readOnly) => {
    const instance = await boot(textCellInsideSpan(), readOnly, { a: 'Alpha' });

    if (readOnly) {
      await instance.readOnly.set(false);
    }

    expect(originTexts(await instance.save())).toStrictEqual(['Alpha', 'claimed']);
  });

  it('edit mode: a text-only origin keeps its text before a claimed legacy string', async () => {
    await boot(textOriginWithLegacyString());

    expect(tableEl().querySelector('td[colspan="2"]')?.textContent).toBe('origlegacy');
  });

  it.each([false, true])('a text-only origin and a claimed legacy string are both saved, in order (readOnly=%s)', async (readOnly) => {
    const instance = await boot(textOriginWithLegacyString(), readOnly, { b: 'Bravo', d: 'Delta' });

    if (readOnly) {
      await instance.readOnly.set(false);
    }

    expect(originTexts(await instance.save())).toStrictEqual(['orig', 'legacy']);
  });

  it('edit mode: a text-only cell a rowspan claims is saved inside the origin, after a cell to its right', async () => {
    const instance = await boot([
      [{ blocks: ['a'], rowspan: 2 }, { blocks: ['b'] }],
      [{ blocks: [], text: 'claimed' }, { blocks: ['d'] }],
    ], false, { a: 'Alpha', b: 'Bravo', d: 'Delta' });
    const output = await instance.save();

    expect(originTexts(output)).toStrictEqual(['Alpha', 'claimed']);
    expect(tableEl().querySelector('td[rowspan="2"]')?.textContent).toBe('Alphaclaimed');
    expect(savedTableContent(output)[1][1]).toMatchObject({ blocks: ['d'] });
  });

  it('edit mode: a claimed text-only cell joins the table right after its origin, in grid order', async () => {
    const instance = await boot([
      [{ blocks: ['p0'], colspan: 2 }, { blocks: [], text: 'cov' }],
      [{ blocks: ['p2'] }, { blocks: ['p3'] }],
    ], false, { p0: 'P0', p2: 'P2', p3: 'P3' });
    const textOf = (id: string): string => holder.querySelector(`[data-blok-id="${id}"]`)?.textContent ?? '';

    expect((instance.blocks.getById(TABLE_ID)?.contentIds ?? []).map(textOf)).toStrictEqual(['P0', 'cov', 'P2', 'P3']);

    const output = await instance.save();
    const savedTexts = output.blocks
      .filter(block => block.parent === TABLE_ID)
      .map(block => (typeof block.data.text === 'string' ? block.data.text : ''));

    expect(savedTexts).toStrictEqual(['P0', 'cov', 'P2', 'P3']);
    expect(originTexts(output)).toStrictEqual(['P0', 'cov']);
    expect(tableEl().querySelector('td[colspan="2"]')?.textContent).toBe('P0cov');
    expect(instance.history.canUndo()).toBe(false);
  });

  it('edit mode: block ids still beat a stale `text` on the origin and on a claimed cell', async () => {
    const instance = await boot([
      [{ blocks: ['a'], text: 'Stale copy', colspan: 3 }, { blocks: ['b'], text: 'Stale too' }, { blocks: [], text: 'claimed' }],
    ], false, { a: 'Alpha', b: 'Bravo' });

    expect(originTexts(await instance.save())).toStrictEqual(['Alpha', 'Bravo', 'claimed']);
  });

  it('read-only keeps the colspan and renders no merge/grip UI', async () => {
    await boot([
      [{ blocks: ['o'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: ['a'] }, { blocks: ['b'] }],
    ], true);

    expect(tableEl().querySelector('td[colspan="2"]')).not.toBeNull();
    expect(holder.querySelector('[data-blok-table-grip-overlay]')).toBeNull();
    expect(holder.querySelector('[data-blok-table-readonly]')).not.toBeNull();
    expect(rowWidths(tableEl())).toStrictEqual([2, 2]);
  });

  it('edit mode: a plain cell inside a live span renders no extra column', async () => {
    await boot(plainCellInsideSpan());
    const widths = rowWidths(tableEl());
    const cols = colCount(tableEl());

    expect(widths).toStrictEqual([cols, cols]);
  });

  it('edit mode: a plain cell inside a live span keeps its block through save', async () => {
    const instance = await boot(plainCellInsideSpan());
    const output = await instance.save();

    expect(savedIds(output)).toContain('d');
  });

  it('edit mode: a colspan past the last column is clamped to the grid', async () => {
    await boot(colspanPastGrid());
    const origin = tableEl().querySelector<HTMLTableCellElement>('td[colspan]');

    expect(origin?.colSpan).toBe(2);
  });

  it('edit mode: a colspan past the last column loads without losing content', async () => {
    const instance = await boot(colspanPastGrid());
    const output = await instance.save();

    expect(savedIds(output)).toEqual(expect.arrayContaining(['o', 'a', 'b']));
    expect(tableEl().textContent).toContain('Bravo');
  });

  it('edit mode: a rowspan past the last row loads without losing content', async () => {
    const instance = await boot([
      [{ blocks: ['o'], rowspan: 3 }, { blocks: ['a'] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: ['b'] }],
    ]);

    const output = await instance.save();

    expect(savedIds(output)).toEqual(expect.arrayContaining(['o', 'a', 'b']));
  });

  it('edit mode: an EMPTY cell whose mergedInto names a plain cell stays an editable cell', async () => {
    await boot([
      [{ blocks: ['o'] }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: ['a'] }, { blocks: ['b'] }],
    ]);

    await new Promise(resolve => setTimeout(resolve, 100));
    const cell = tableEl().querySelector('[data-blok-table-cell-row="0"][data-blok-table-cell-col="1"]');

    // jsdom does not reflect `contentEditable` to the attribute, so check for a mounted block.
    expect(cell).not.toBeNull();
    expect(cell?.querySelectorAll('[data-blok-table-cell-blocks] [data-blok-tool="paragraph"]').length).toBeGreaterThan(0);
  });

  it('edit mode: an EMPTY cell whose mergedInto names a plain cell does not save a dangling mergedInto', async () => {
    const instance = await boot([
      [{ blocks: ['o'] }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: ['a'] }, { blocks: ['b'] }],
    ]);
    const output = await instance.save();

    expect((savedTableContent(output)[0][1] as { mergedInto?: unknown }).mergedInto).toBeUndefined();
  });

  it('update() adding then removing a merge re-renders the grid', async () => {
    const instance = await boot([
      [{ blocks: ['o'] }, { blocks: ['a'] }],
      [{ blocks: ['b'] }, { blocks: ['d'] }],
    ]);

    await instance.blocks.update(TABLE_ID, {
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['o', 'a'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
        [{ blocks: ['b'] }, { blocks: ['d'] }],
      ],
    });

    expect(tableEl().querySelector('td[colspan="2"]')).not.toBeNull();
    expect(rowWidths(tableEl())).toStrictEqual([2, 2]);
    expect(tableEl().textContent).toContain('Alpha');

    await instance.blocks.update(TABLE_ID, {
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['o'] }, { blocks: ['a'] }],
        [{ blocks: ['b'] }, { blocks: ['d'] }],
      ],
    });

    expect(tableEl().querySelector('td[colspan]')).toBeNull();
    expect(rowWidths(tableEl())).toStrictEqual([2, 2]);
    expect(tableEl().textContent).toContain('Alpha');
  });
});

const createMockAPI = (): API => ({
  styles: {
    block: 'blok-block',
    inlineToolbar: 'blok-inline-toolbar',
    inlineToolButton: 'blok-inline-tool-button',
    inlineToolButtonActive: 'blok-inline-tool-button--active',
    input: 'blok-input',
    loader: 'blok-loader',
    button: 'blok-button',
    settingsButton: 'blok-settings-button',
    settingsButtonActive: 'blok-settings-button--active',
  },
  i18n: { t: (key: string) => key },
  blocks: {
    insert: vi.fn().mockImplementation((_tool?: string, data?: { text?: unknown }) => {
      const el = document.createElement('div');
      const id = `mock-${Math.random().toString(36).slice(2, 8)}`;

      el.setAttribute('data-blok-id', id);
      el.textContent = typeof data?.text === 'string' ? data.text : '';

      return { id, holder: el };
    }),
    delete: vi.fn(),
    getById: vi.fn(() => undefined),
    getChildren: vi.fn().mockReturnValue([]),
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlockIndex: vi.fn().mockReturnValue(undefined),
    getBlocksCount: vi.fn().mockReturnValue(0),
    setBlockParent: vi.fn(),
    isSyncingFromYjs: false,
  },
  events: { on: vi.fn(), off: vi.fn() },
  toolbar: { close: vi.fn() },
} as unknown as API);

describe('merge audit: out-of-range spans kept by the model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appending a row below a loaded rowspan-past-grid origin keeps the new row free', () => {
    const model = new TableModel({
      content: [
        [{ blocks: ['o'], rowspan: 3 }, { blocks: ['a'] }],
        [{ blocks: [], mergedInto: [0, 0] }, { blocks: ['b'] }],
      ],
    });

    model.addRow();

    expect(model.isSpannedCell(2, 0)).toBe(false);
  });

  it('appending a column after a loaded colspan-past-grid origin keeps the new column free', () => {
    const model = new TableModel({ content: colspanPastGrid() });

    model.addColumn();

    expect(model.isSpannedCell(0, 2)).toBe(false);
  });
});

describe('merge audit: a plain cell the load repair absorbs into a span', () => {
  it('drops its styling, like a merge drops an absorbed cell\'s styling', () => {
    const model = new TableModel({ content: [
      [{ blocks: ['o'], colspan: 2 }, { blocks: ['a'], color: '#f00', textColor: '#00f', placement: 'middle-center' }],
    ] });
    const covered = model.snapshot().content[0][1];

    expect(covered).toMatchObject({ blocks: [], mergedInto: [0, 0] });
    expect(covered).not.toHaveProperty('color');
    expect(covered).not.toHaveProperty('textColor');
    expect(covered).not.toHaveProperty('placement');
  });
});

describe('merge audit: Yjs replay setData and external paste', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  const mountTable = (api: API, content: TableData['content']): Table => {
    const options: BlockToolConstructorOptions<TableData, TableConfig> = {
      data: { withHeadings: false, withHeadingColumn: false, content },
      config: {},
      api,
      readOnly: false,
      block: { id: 'table-remote' } as never,
    };
    const table = new Table(options);

    document.body.appendChild(table.render());
    table.rendered();

    return table;
  };

  const liveTable = (): HTMLTableElement => {
    const el = document.querySelector('table');

    if (el === null) {
      throw new Error('no table');
    }

    return el;
  };

  it('a remote setData that adds and then removes a merge updates the DOM', () => {
    const api = createMockAPI();
    const table = mountTable(api, [[{ blocks: [] }, { blocks: [] }], [{ blocks: [] }, { blocks: [] }]]);

    (api.blocks as { isSyncingFromYjs: boolean }).isSyncingFromYjs = true;

    table.setData({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: [], colspan: 2, rowspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
        [{ blocks: [], mergedInto: [0, 0] }, { blocks: [], mergedInto: [0, 0] }],
      ],
    });

    expect(liveTable().querySelectorAll(`[${CELL_ATTR}]`).length).toBe(1);
    expect(rowWidths(liveTable())).toStrictEqual([2, 2]);

    table.setData({
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: [] }, { blocks: [] }], [{ blocks: [] }, { blocks: [] }]],
    });

    expect(liveTable().querySelectorAll(`[${CELL_ATTR}]`).length).toBe(4);
    expect(liveTable().querySelector('td[colspan], td[rowspan]')).toBeNull();
  });

  it('a selection that clips a merge is expanded to the whole merge, so copy never sees half of it', () => {
    const table = mountTable(createMockAPI(), [
      [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
      [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
    ]);
    const selection = (table as unknown as {
      subsystems: { cellSelectionSubsystem: { selectRange: (r: Record<string, number>) => void; getSelectedRange: () => Record<string, number> | null } | null };
    }).subsystems.cellSelectionSubsystem;

    selection?.selectRange({ minRow: 0, maxRow: 0, minCol: 1, maxCol: 2 });

    expect(selection?.getSelectedRange()).toStrictEqual({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 });
  });

  it('pasting HTML with overlapping spans adds no phantom column (overlap itself is not counted here)', () => {
    const table = mountTable(createMockAPI(), [['A']]);
    const pasted = document.createElement('table');

    pasted.innerHTML = '<tr><td>A</td><td rowspan="2">B</td></tr><tr><td colspan="2">C</td></tr>';
    table.onPaste({ detail: { data: pasted } } as unknown as CustomEvent as never);

    const widths = rowWidths(liveTable());
    const cols = colCount(liveTable());

    expect({ widths, cols }).toStrictEqual({ widths: [cols, cols], cols });
    expect(liveTable().textContent).toContain('C');
  });

  it('pasting HTML with overlapping spans leaves no grid slot claimed by two merge origins', () => {
    const table = mountTable(createMockAPI(), [['A']]);
    const pasted = document.createElement('table');

    pasted.innerHTML = '<tr><td>A</td><td rowspan="2">B</td></tr><tr><td colspan="2">C</td></tr>';
    table.onPaste({ detail: { data: pasted } } as unknown as CustomEvent as never);

    const wrapper = document.querySelector<HTMLElement>('[data-blok-tool="table"]');

    if (wrapper === null) {
      throw new Error('no wrapper');
    }

    const content = table.save(wrapper).content as Array<Array<{ colspan?: number; rowspan?: number; mergedInto?: unknown }>>;
    const claims = new Map<string, number>();

    content.forEach((row, r) => row.forEach((cell, c) => {
      if (cell.mergedInto !== undefined) {
        return;
      }

      Array.from({ length: cell.rowspan ?? 1 }).forEach((_, dr) => {
        Array.from({ length: cell.colspan ?? 1 }).forEach((__, dc) => {
          const key = `${r + dr}:${c + dc}`;

          claims.set(key, (claims.get(key) ?? 0) + 1);
        });
      });
    }));

    expect(Array.from(claims.entries()).filter(([, count]) => count > 1)).toStrictEqual([]);
  });
});

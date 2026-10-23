import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { API, OutputBlockData, OutputData } from '../../../../types';
import type { DatabaseData, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

interface TestEditor {
  isReady: Promise<unknown>;
  save(): Promise<OutputData>;
  destroy(): void;
  blocks: API['blocks'];
  history: API['history'];
}

let editor: Blok | undefined;
let holder: HTMLDivElement | undefined;

const quiet = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
};

const table = (id: string, position: string, extra: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id, name: 'Table', type: 'table', position, filters: [], sorts: [], visibleProperties: [], ...extra,
});

const parentSchema: PropertyDefinition[] = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
];

const sourceSchema: PropertyDefinition[] = [
  { id: 'bt', name: 'Name', type: 'title', position: 'a0' },
  { id: 'size', name: 'Size', type: 'number', position: 'a1' },
  { id: 'stage', name: 'Stage', type: 'select', position: 'a2', config: { options: [{ id: 'todo', label: 'Todo', color: 'gray', position: 'a0' }, { id: 'done', label: 'Done', color: 'green', position: 'a1' }] } },
  { id: 'due', name: 'Due', type: 'date', position: 'a3' },
  { id: 'spot', name: 'Spot', type: 'place', position: 'a4' },
];

const pad = (n: number): string => String(n).padStart(2, '0');
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const doc = (active: string, parentExtra: Partial<DatabaseData> = {}, bound: Partial<DatabaseViewConfig> = {}): OutputBlockData[] => [
  {
    id: 'db', type: 'database', content: ['r1', 'src-b'],
    data: {
      title: 'Projects',
      schema: parentSchema,
      views: [table('v1', 'a0'), table('vb', 'a1', { dataSourceId: 'src-b', ...bound })],
      activeViewId: active,
      ...parentExtra,
    },
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Parent row', notes: 'n' }, position: 'a0' } },
  {
    id: 'src-b', type: 'database', parent: 'db', content: ['b1'],
    data: { title: 'Src B', schema: sourceSchema, views: [table('bv', 'a0')], activeViewId: 'bv' },
  },
  { id: 'b1', type: 'database-row', parent: 'src-b', data: { properties: { bt: 'Source row', size: 3, stage: 'todo', due: TODAY, spot: { name: 'Berlin', lat: 52.5, lon: 13.4 } }, position: 'a0' } },
];

const make = async (blocks: OutputBlockData[], readOnly = false): Promise<TestEditor> => {
  if (holder === undefined) throw new Error('missing editor holder');
  let ready: TestEditor | undefined;

  editor = new Blok({
    holder, dataModel: 'hierarchical', readOnly,
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool },
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
    onReady: (api) => { ready = api; },
  });
  await editor.isReady;
  await quiet();
  if (ready === undefined) throw new Error('editor did not expose its ready API');

  return ready;
};

const parentRoot = (): HTMLElement => {
  const found = holder?.querySelector<HTMLElement>('[data-blok-element][data-blok-id="db"]');

  if (found === null || found === undefined) throw new Error('missing parent database');

  return found;
};

/** The parent's visible view area: not the hidden pool where B itself lives. */
const shownArea = (): HTMLElement => {
  return own('[data-blok-database-board-container]');
};

/** An element of the parent's own chrome, never one inside the hidden source block. */
const own = (selector: string): HTMLElement => {
  const root = parentRoot();
  const found = [...root.querySelectorAll<HTMLElement>(selector)].find((el) => el.closest('[data-blok-element]') === root);

  if (found === undefined) throw new Error('missing ' + selector);

  return found;
};

const PARENT_ROW = 'Parent row';
const SOURCE_ROW = 'Source row';

/** The bound view's own layout root, inside the parent's view area. */
const layoutRoot = (selector: string): HTMLElement => {
  const found = shownArea().querySelector<HTMLElement>(selector);

  if (found === null) throw new Error('missing ' + selector);

  return found;
};

const dataOf = async (api: TestEditor, id: string): Promise<DatabaseData | undefined> =>
  (await api.save()).blocks.find((b) => b.id === id)?.data as DatabaseData | undefined;

const sourceRows = (api: TestEditor): string[] => api.blocks.getChildren('src-b').filter((b) => b.name === 'database-row').map((b) => b.id);
const parentRows = (api: TestEditor): string[] => api.blocks.getChildren('db').filter((b) => b.name === 'database-row').map((b) => b.id);

const click = async (el: Element | null | undefined): Promise<void> => {
  if (el === null || el === undefined) throw new Error('nothing to click');
  (el as HTMLElement).click();
  await quiet();
};

describe('New data source: every layout on a second source', () => {
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
    PopoverRegistry.resetForTests();
    vi.restoreAllMocks();
  });

  const shows = [
    ['board', '[data-blok-database-board]', { groupBy: 'stage' }],
    ['gallery', '[data-blok-database-gallery]', {}],
    ['calendar', '[data-blok-database-calendar]', { calendarBy: 'due' }],
    ['timeline', '[data-blok-database-timeline]', { timelineBy: 'due' }],
    ['feed', '[data-blok-database-feed]', {}],
  ] as const;

  it.each(shows)('a %s view shows the source\'s rows, not the parent\'s', async (type, selector, extra) => {
    await make(doc('vb', {}, { type, ...extra }));
    const root = layoutRoot(selector);

    expect(root.textContent).toContain(SOURCE_ROW);
    expect(root.textContent).not.toContain(PARENT_ROW);
  });

  it('a chart view groups the source\'s rows by the source\'s select', async () => {
    await make(doc('vb', {}, { type: 'chart', groupBy: 'stage' }));
    const root = layoutRoot('[data-blok-database-chart]');

    expect(root.querySelector('[data-blok-database-chart-empty]')).toBeNull();
    expect(root.textContent).toContain('Todo');
  });

  it('a form view asks the source\'s properties, not the parent\'s', async () => {
    await make(doc('vb', {}, { type: 'form' }));
    const root = layoutRoot('[data-blok-database-form]');

    expect(root.querySelector('[data-blok-database-form-question="size"]')).not.toBeNull();
    expect(root.querySelector('[data-blok-database-form-question="notes"]')).toBeNull();
  });

  it('a map view draws on a second source', async () => {
    await make(doc('vb', {}, { type: 'map' }));

    expect(layoutRoot('[data-blok-database-map]')).not.toBeNull();
  });

  /** A holder filter Stage = Done: a new row from that view takes it. */
  const doneFilter: Partial<DatabaseViewConfig> = { filters: [{ id: 'f1', propertyId: 'stage', operator: 'equals', value: 'done' }] };

  const newSourceRow = (api: TestEditor): Record<string, unknown> | undefined => {
    const id = sourceRows(api).find((rowId) => rowId !== 'b1');

    return id === undefined ? undefined : (api.blocks.getById(id)?.preservedData as { properties?: Record<string, unknown> } | undefined)?.properties;
  };

  it('a gallery\'s New adds a row to the source, with the holder view\'s filter', async () => {
    const api = await make(doc('vb', {}, { type: 'gallery', ...doneFilter }));

    await click(layoutRoot('[data-blok-database-gallery]').querySelector('[data-blok-database-gallery-new]'));

    expect(sourceRows(api)).toHaveLength(2);
    expect(parentRows(api)).toEqual(['r1']);
    expect(newSourceRow(api)?.stage).toBe('done');
  });

  it('a board column\'s add puts the row in the source, in that column', async () => {
    const api = await make(doc('vb', {}, { type: 'board', groupBy: 'stage' }));

    await click(layoutRoot('[data-blok-database-board]').querySelector('[data-blok-database-add-card][data-option-id="done"]'));

    expect(parentRows(api)).toEqual(['r1']);
    expect(newSourceRow(api)?.stage).toBe('done');
  });

  it('a calendar day\'s + adds a source row on that day, with the holder view\'s filter', async () => {
    const api = await make(doc('vb', {}, { type: 'calendar', calendarBy: 'due', ...doneFilter }));
    const day = layoutRoot('[data-blok-database-calendar]').querySelector<HTMLElement>(`[data-blok-database-calendar-day][data-day="${TODAY}"]`);

    await click(day?.querySelector('[data-blok-database-calendar-add]'));

    expect(parentRows(api)).toEqual(['r1']);
    expect(newSourceRow(api)?.due).toBe(TODAY);
    expect(newSourceRow(api)?.stage).toBe('done');
  });

  it('a timeline\'s New adds a source row dated today', async () => {
    const api = await make(doc('vb', {}, { type: 'timeline', timelineBy: 'due' }));

    await click(layoutRoot('[data-blok-database-timeline]').querySelector('[data-blok-database-timeline-new]'));

    expect(parentRows(api)).toEqual(['r1']);
    expect(newSourceRow(api)?.due).toBe(TODAY);
  });

  it('a timeline zoom is saved on the holder\'s view, not the source\'s', async () => {
    const api = await make(doc('vb', {}, { type: 'timeline', timelineBy: 'due' }));

    await click(layoutRoot('[data-blok-database-timeline]').querySelector('[data-blok-database-timeline-zoom]'));
    await click(document.querySelector('[data-blok-testid="database-timeline-zoom-year"], [data-blok-item-name="database-timeline-zoom-year"]'));

    expect((await dataOf(api, 'db'))?.views.find((v) => v.id === 'vb')?.timelineZoom).toBe('year');
    expect((await dataOf(api, 'src-b'))?.views.map((v) => v.timelineZoom)).toEqual([undefined]);
    expect(layoutRoot('[data-blok-database-timeline]').getAttribute('data-zoom')).toBe('year');
  });

  it('a form answer becomes a source row', async () => {
    const api = await make(doc('vb', {}, { type: 'form' }));
    const root = layoutRoot('[data-blok-database-form]');
    const size = root.querySelector<HTMLInputElement>('[data-blok-database-form-question="size"] input');

    if (size === null) throw new Error('no Size field');
    size.value = '7';
    size.dispatchEvent(new Event('input', { bubbles: true }));
    await click(root.querySelector('[data-blok-database-form-submit]'));

    expect(parentRows(api)).toEqual(['r1']);
    expect(newSourceRow(api)?.size).toBe(7);
  });

  const openLayoutPage = async (): Promise<void> => {
    await click(own('[data-blok-testid="database-toolbar-settings"]'));
    await click(document.querySelector('[data-blok-testid="database-settings-layout"]'));
  };

  it('view settings Layout offers every layout on a second source', async () => {
    await make(doc('vb'));
    await openLayoutPage();

    for (const type of ['table', 'board', 'gallery', 'list', 'chart', 'timeline', 'feed', 'calendar', 'form', 'map']) {
      expect(document.querySelector(`[data-blok-testid="database-layout-${type}"]`), type).not.toBeNull();
    }
  });

  it('switching a second source\'s view to Board groups by the source\'s select and saves on the holder', async () => {
    const api = await make(doc('vb'));

    await openLayoutPage();
    await click(document.querySelector('[data-blok-testid="database-layout-board"]'));
    const saved = (await dataOf(api, 'db'))?.views.find((v) => v.id === 'vb');

    expect(saved?.type).toBe('board');
    expect(saved?.groupBy).toBe('stage');
    expect((await dataOf(api, 'src-b'))?.views.map((v) => v.type)).toEqual(['table']);
    expect(layoutRoot('[data-blok-database-board]').textContent).toContain(SOURCE_ROW);
  });

  /** A second source row in the Done stage, next to b1 in Todo. */
  const withDoneRow = (blocks: OutputBlockData[]): OutputBlockData[] => blocks.flatMap((block) => {
    if (block.id === 'src-b') return [{ ...block, content: ['b1', 'b2'] }];
    if (block.id !== 'b1') return [block];

    return [block, { id: 'b2', type: 'database-row', parent: 'src-b', data: { properties: { bt: 'Done row', size: 9, stage: 'done' }, position: 'a1' } }];
  });

  const exportedCsv = async (): Promise<string> => {
    const blobs: Blob[] = [];

    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (blob instanceof Blob) blobs.push(blob);

      return 'blob:csv';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    await click(own('[data-blok-testid="database-toolbar-settings"]'));
    await click(document.querySelector('[data-blok-testid="database-settings-more"]'));
    await click(document.querySelector('[data-blok-testid="database-settings-csv-export"]'));
    const blob = blobs.at(-1);

    if (blob === undefined) throw new Error('nothing exported');

    return blob.text();
  };

  // A table shows every property; a gallery card shows only the title by default.
  it.each([['table', true], ['gallery', false]] as const)('CSV export on a %s view of a second source exports the source\'s rows through the holder view\'s filter', async (type, sized) => {
    await make(withDoneRow(doc('vb', {}, { type, ...doneFilter })));
    const csv = await exportedCsv();

    expect(csv).toContain('Done row');
    expect(csv).not.toContain(SOURCE_ROW);
    expect(csv).not.toContain(PARENT_ROW);
    expect(csv.split('\n')[0]).not.toContain('Notes');
    expect(csv.split('\n')[0].includes('Size')).toBe(sized);
  });

  it('a chart view of a second source offers "Save chart as"', async () => {
    await make(doc('vb', {}, { type: 'chart', groupBy: 'stage' }));
    await click(own('[data-blok-testid="database-toolbar-settings"]'));

    expect(document.querySelector('[data-blok-testid="database-settings-chart-save"]')).not.toBeNull();
  });

  it('the layout rows of a second source\'s gallery list the source\'s properties and save on the holder', async () => {
    const api = await make(doc('vb', {}, { type: 'gallery' }));

    await click(own('[data-blok-testid="database-toolbar-settings"]'));
    await click(document.querySelector('[data-blok-testid="database-settings-layout"]'));
    const panel = [...document.querySelectorAll<HTMLElement>('[data-blok-popover]')].at(-1);

    expect(panel?.textContent).toContain('Card preview');
    expect((await dataOf(api, 'src-b'))?.views.map((v) => v.type)).toEqual(['table']);
  });

  it('Customize page layout on a second source\'s view customizes the source\'s row page', async () => {
    const api = await make(doc('vb', {}, { type: 'board', groupBy: 'stage' }));

    await click(own('[data-blok-testid="database-toolbar-settings"]'));
    await click(document.querySelector('[data-blok-testid="database-settings-more"]'));
    await click(document.querySelector('[data-blok-testid="database-settings-customize-layout"]'));
    await click(document.querySelector('[data-blok-interface="database-layout-builder"] [data-blok-database-layout-apply]'));
    const title = (await dataOf(api, 'src-b'))?.schema.find((p) => p.type === 'title');

    expect(title).toMatchObject({ pageLayoutPlacements: [] });
    expect((await dataOf(api, 'db'))?.schema.find((p) => p.type === 'title')).not.toHaveProperty('pageLayoutPlacements');
  });

  it('hiding a board group of a second source saves on the holder\'s view', async () => {
    const api = await make(doc('vb', {}, { type: 'board', groupBy: 'stage' }));

    await click(layoutRoot('[data-blok-database-board]').querySelector('[data-blok-database-column-menu][data-option-id="done"]'));
    await click(document.querySelector('[data-blok-item-name="hide-group"]'));

    expect((await dataOf(api, 'db'))?.views.find((v) => v.id === 'vb')?.hiddenGroups).toEqual([{ id: 'done' }]);
    expect((await dataOf(api, 'src-b'))?.views[0]?.hiddenGroups).toBeUndefined();
    expect(layoutRoot('[data-blok-database-board]').querySelector('[data-blok-database-column-menu][data-option-id="done"]')).toBeNull();
  });

  it('"Add group" on a second source\'s board adds the option to the source\'s select', async () => {
    const api = await make(doc('vb', {}, { type: 'board', groupBy: 'stage' }));

    await click(layoutRoot('[data-blok-database-board]').querySelector('[data-blok-database-add-column]'));
    const stage = (await dataOf(api, 'src-b'))?.schema.find((p) => p.id === 'stage');

    expect(stage?.config?.options).toHaveLength(3);
    expect((await dataOf(api, 'db'))?.schema).toEqual(parentSchema);
    // The new group goes after the no-value group, pinned on the view that shows it.
    expect((await dataOf(api, 'db'))?.views.find((v) => v.id === 'vb')?.noValueGroupPosition).toBeDefined();
  });

  it('"Import CSV" on a second source\'s view makes a new database beside the holder, not a third source inside it', async () => {
    const api = await make(doc('vb', {}, { type: 'board', groupBy: 'stage' }));

    await click(own('[data-blok-testid="database-toolbar-settings"]'));
    await click(document.querySelector('[data-blok-testid="database-settings-more"]'));
    await click(document.querySelector('[data-blok-testid="database-settings-csv-import"]'));
    const input = document.querySelector<HTMLInputElement>('[data-blok-database-csv-input]');

    if (input === null) throw new Error('no file input');
    Object.defineProperty(input, 'files', { value: [new File(['Name\nImported'], 'stock.csv', { type: 'text/csv' })] });
    input.dispatchEvent(new Event('change'));
    await quiet();
    await click(document.querySelector('[data-blok-testid="database-csv-map"]'));
    await click(document.querySelector('[data-blok-testid="database-csv-import"]'));
    const saved = (await api.save()).blocks.filter((b) => b.type === 'database');

    expect(saved.map((b) => b.id).filter((id) => id !== 'db' && id !== 'src-b')).toHaveLength(1);
    expect(api.blocks.getChildren('db').filter((b) => b.name === 'database').map((b) => b.id)).toEqual(['src-b']);
  });

  it('Cmd-click on a second source\'s gallery card selects it and shows the selection bar', async () => {
    await make(doc('vb', {}, { type: 'gallery' }));
    const card = layoutRoot('[data-blok-database-gallery]').querySelector<HTMLElement>('[data-blok-database-gallery-card][data-row-id="b1"]');

    if (card === null) throw new Error('no card');
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
    await quiet();

    expect(layoutRoot('[data-blok-database-gallery]').querySelector('[data-row-id="b1"]')?.hasAttribute('data-blok-database-row-selected')).toBe(true);
    expect(own('[data-blok-database-table-selection-bar]')).not.toBeNull();
  });

  it('the Today button of a second source\'s timeline keeps its centre on the holder\'s view', async () => {
    const api = await make(doc('vb', {}, { type: 'timeline', timelineBy: 'due', timelineCenter: '2020-01-01' }));

    await click(layoutRoot('[data-blok-database-timeline]').querySelector('[data-blok-database-timeline-today]'));

    expect((await dataOf(api, 'db'))?.views.find((v) => v.id === 'vb')?.timelineCenter).toBe(TODAY);
    expect((await dataOf(api, 'src-b'))?.views[0]?.timelineCenter).toBeUndefined();
  });

  it('a read-only second source\'s board offers no add-card or add-group', async () => {
    await make(doc('vb', {}, { type: 'board', groupBy: 'stage' }), true);
    const board = layoutRoot('[data-blok-database-board]');

    expect(board.textContent).toContain(SOURCE_ROW);
    expect(board.querySelector('[data-blok-database-add-card], [data-blok-database-add-column]')).toBeNull();
  });

  it('turning read-only on in place drops a second source\'s board add controls', async () => {
    await make(doc('vb', {}, { type: 'board', groupBy: 'stage' }));
    expect(layoutRoot('[data-blok-database-board]').querySelector('[data-blok-database-add-card]')).not.toBeNull();

    await (editor as unknown as { readOnly: { toggle: (state?: boolean) => Promise<boolean> } }).readOnly.toggle(true);
    await quiet();

    expect(layoutRoot('[data-blok-database-board]').querySelector('[data-blok-database-add-card], [data-blok-database-add-column]')).toBeNull();
  });
});

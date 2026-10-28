import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseTableView, createTableState } from '../../../../src/tools/database/database-table-view';
import type { TableHandlers, TableState, DatabaseTableViewOptions } from '../../../../src/tools/database/database-table-view';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'p-amount', name: 'Amount', type: 'number', position: 'a2' },
  { id: 'p-stage', name: 'Stage', type: 'select', position: 'a3', config: { options: [
    { id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' },
    { id: 'o-build', label: 'Build', color: 'blue', position: 'a1' },
  ] } },
  { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a4' },
];

const row = (id: string, title: string, extra: DatabaseRow['properties'] = {}): DatabaseRow =>
  ({ id, position: id, properties: { 'p-title': title, ...extra } });

const rows = (): DatabaseRow[] => [
  row('r1', 'Alpha', { 'p-notes': 'short', 'p-amount': 1200, 'p-stage': 'o-idea' }),
  row('r2', 'Bravo', { 'p-amount': 35.5, 'p-done': true }),
  row('r3', 'Charlie'),
];

const tableView = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...overrides,
});

const makeHandlers = (): TableHandlers => ({
  commitCell: vi.fn(),
  editEnded: vi.fn(),
  addRow: vi.fn(() => null),
  deleteRows: vi.fn(),
  duplicateRow: vi.fn(),
  openRow: vi.fn(),
  copyRowLink: vi.fn(),
  editRowIcon: vi.fn(),
  updateView: vi.fn(),
  openPropertyMenu: vi.fn(),
  addProperty: vi.fn(),
  viewAction: vi.fn(),
  moveRow: vi.fn(),
  sortedRowDrop: vi.fn(),
  bulkEdit: vi.fn(),
  commitCells: vi.fn(),
  editFilters: vi.fn(),
  rerender: vi.fn(),
  optionsChange: vi.fn(),
});

interface Mounted {
  root: HTMLElement;
  handlers: TableHandlers;
  state: TableState;
  view: DatabaseTableView;
}

const mount = (overrides: Partial<DatabaseTableViewOptions> = {}): Mounted => {
  const handlers = overrides.handlers ?? makeHandlers();
  const state = overrides.state ?? createTableState();
  const view = new DatabaseTableView({
    readOnly: false,
    i18n: { t: (key: string, vars?: Record<string, string | number>) => (vars?.count !== undefined ? `${key}:${vars.count}` : key) } as DatabaseTableViewOptions['i18n'],
    view: tableView(),
    schema,
    rows: rows(),
    titlePropertyId: 'p-title',
    state,
    handlers,
    ...overrides,
  });
  const root = view.createView();

  document.body.appendChild(root);

  return { root, handlers, state, view };
};

const grid = (root: HTMLElement): HTMLElement => {
  const el = root.matches('[role="grid"]') ? root : root.querySelector<HTMLElement>('[role="grid"]');

  if (el === null) {
    throw new Error('no grid');
  }

  return el;
};

const cell = (root: HTMLElement, rowId: string, propertyId: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [role="gridcell"][data-property-id="${propertyId}"]`);

  if (el === null) {
    throw new Error(`no cell ${rowId}/${propertyId}`);
  }

  return el;
};

const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(event);

  return event;
};

const editor = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-cell-editor]');

const editorField = (): HTMLInputElement | HTMLTextAreaElement => {
  const el = editor()?.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-blok-database-cell-input]');

  if (el === null || el === undefined) {
    throw new Error('no editor field');
  }

  return el;
};

/** Select a cell without opening its editor: click opens, Escape closes back to the cell. */
const selectCell = (root: HTMLElement, rowId: string, propertyId: string): void => {
  cell(root, rowId, propertyId).click();
  if (editor() !== null) {
    press(editorField(), 'Escape');
  }
};


interface FakeClipboard {
  data: Map<string, string>;
  event: Event;
}

const clipboardEvent = (type: 'copy' | 'paste', data: Record<string, string> = {}): FakeClipboard => {
  const store = new Map(Object.entries(data));
  const event = new Event(type, { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (format: string, value: string): void => {
        store.set(format, value);
      },
      getData: (format: string): string => store.get(format) ?? '',
      types: [...store.keys()],
    },
  });

  return { data: store, event };
};

const commitsOf = (handlers: TableHandlers): unknown[] => vi.mocked(handlers.commitCells).mock.calls;

describe('table bulk actions and clipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    PopoverRegistry.resetForTests?.();
    vi.restoreAllMocks();
  });

  describe('copy', () => {
    it('copies a cell range as TSV and an HTML table of display text', () => {
      const { root } = mount();

      selectCell(root, 'r1', 'p-title');
      press(grid(root), 'ArrowDown', { shiftKey: true });
      press(grid(root), 'ArrowRight', { shiftKey: true });
      const copy = clipboardEvent('copy');

      grid(root).dispatchEvent(copy.event);

      expect(copy.event.defaultPrevented).toBe(true);
      expect(copy.data.get('text/plain')).toBe('Alpha\tshort\nBravo\t');
      expect(copy.data.get('text/html')).toContain('<td>Alpha</td><td>short</td>');
    });

    it('copies whole selected rows, every column', () => {
      const { root } = mount();

      cell(root, 'r1', 'p-title').closest('[data-row-id]')?.querySelector<HTMLElement>('[data-blok-database-table-row-checkbox]')?.click();
      const copy = clipboardEvent('copy');

      grid(root).dispatchEvent(copy.event);

      expect(copy.data.get('text/plain')).toBe('Alpha\tshort\t1200\tIdea\tNo');
    });
  });

  describe('paste', () => {
    it.each<{
      label: string;
      type: 'formula' | 'rollup';
      resultType: PropertyDefinition['type'];
      value: DatabaseRow['properties'][string];
      text: string;
      clipboardText?: string;
      pillLabels?: string[];
      config?: PropertyDefinition['config'];
    }>([
      { label: 'true formula Boolean', type: 'formula', resultType: 'checkbox', value: true, text: 'Yes' },
      { label: 'false formula Boolean', type: 'formula', resultType: 'checkbox', value: false, text: 'No' },
      { label: 'formula person list', type: 'formula', resultType: 'person', value: [{ id: 'u1' }, { id: 'u2' }], text: 'u1, u2' },
      { label: 'rollup file list', type: 'rollup', resultType: 'files', value: [
        { id: 'f1', name: 'Notes.pdf', url: 'https://files.test/notes.pdf' },
        { id: 'f2', name: 'Plan.pdf', url: 'https://files.test/plan.pdf' },
      ], text: 'https://files.test/notes.pdf, https://files.test/plan.pdf' },
      { label: 'rollup option list', type: 'rollup', resultType: 'multiSelect', value: ['o-idea', 'o-build'], text: '"Idea", Build', clipboardText: '"""Idea"", Build"', pillLabels: ['Idea', 'Build'], config: { options: [
        { id: 'o-idea', label: 'Idea', position: 'a0' },
        { id: 'o-build', label: 'Build', position: 'a1' },
      ] } },
    ])('copies a $label through each external clipboard format without losing its text', ({ type, resultType, value, text, config, clipboardText = text, pillLabels = [] }) => {
      const computed: PropertyDefinition = { id: 'p-result', name: 'Result', type, position: 'a5' };
      const { root, handlers, state, view } = mount({
        schema: [...schema, computed],
        rows: [
          { ...row('r1', 'Alpha'), computed: { 'p-result': value } },
          row('r2', 'Bravo', { 'p-notes': 'Existing text' }),
        ],
        cellContext: { valueProperty: (property) => property.id === computed.id ? { ...property, type: resultType, config } : property },
      });
      const source = { rowId: 'r1', propertyId: 'p-result' };

      state.selection = { kind: 'cell', anchor: source, focus: source };
      const copy = clipboardEvent('copy');

      grid(root).dispatchEvent(copy.event);
      const target = { rowId: 'r2', propertyId: 'p-notes' };

      state.selection = { kind: 'cell', anchor: target, focus: target };
      grid(root).dispatchEvent(clipboardEvent('paste', { 'text/plain': copy.data.get('text/plain') ?? '' }).event);

      expect(commitsOf(handlers)).toEqual([[[{ rowId: 'r2', propertyId: 'p-notes', value: text }], []]]);
      grid(root).dispatchEvent(clipboardEvent('paste', { 'text/html': copy.data.get('text/html') ?? '' }).event);
      expect(commitsOf(handlers)).toEqual([
        [[{ rowId: 'r2', propertyId: 'p-notes', value: text }], []],
        [[{ rowId: 'r2', propertyId: 'p-notes', value: text }], []],
      ]);
      expect(copy.data.get('text/plain')).toBe(clipboardText);
      expect([...cell(root, 'r1', computed.id).querySelectorAll('[data-blok-database-option-pill]')].map((pill) => pill.textContent)).toEqual(pillLabels);
      view.destroy();
    });

    it('keeps two option labels when the target adds a comma-bearing option', () => {
      const options = [
        { id: 'o-idea', label: 'Idea', position: 'a0' },
        { id: 'o-build', label: 'Build', position: 'a1' },
      ];
      const sourceTags: PropertyDefinition = { id: 'p-tags', name: 'Tags', type: 'multiSelect', position: 'a5', config: { options } };
      const targetTags: PropertyDefinition = {
        ...sourceTags,
        config: { options: [...options, { id: 'o-combined', label: 'Idea, Build', position: 'a2' }] },
      };
      const source = mount({
        schema: [...schema, sourceTags],
        rows: [row('r1', 'Source', { 'p-tags': ['o-idea', 'o-build'] })],
      });
      const target = mount({
        schema: [...schema, targetTags],
        rows: [row('r2', 'Target', { 'p-tags': ['o-combined'] })],
      });
      const from = { rowId: 'r1', propertyId: 'p-tags' };
      const to = { rowId: 'r2', propertyId: 'p-tags' };

      source.state.selection = { kind: 'cell', anchor: from, focus: from };
      const copy = clipboardEvent('copy');

      grid(source.root).dispatchEvent(copy.event);
      target.state.selection = { kind: 'cell', anchor: to, focus: to };
      grid(target.root).dispatchEvent(clipboardEvent('paste', { 'text/plain': copy.data.get('text/plain') ?? '' }).event);

      expect(commitsOf(target.handlers)).toEqual([[[{ rowId: 'r2', propertyId: 'p-tags', value: ['o-idea', 'o-build'] }], []]]);
      source.view.destroy();
      target.view.destroy();
    });

    it('keeps two relation rows when the target adds a comma-bearing title', () => {
      const links: PropertyDefinition = { id: 'p-links', name: 'Links', type: 'relation', position: 'a5' };
      const candidates = [
        { id: 'related-idea', title: 'Idea' },
        { id: 'related-build', title: 'Build' },
      ];
      const source = mount({
        schema: [...schema, links],
        rows: [row('r1', 'Source', { 'p-links': [{ id: 'related-idea' }, { id: 'related-build' }] })],
        cellContext: { relationCandidates: () => candidates },
      });
      const target = mount({
        schema: [...schema, links],
        rows: [row('r2', 'Target', { 'p-links': [{ id: 'related-combined' }] })],
        cellContext: { relationCandidates: () => [...candidates, { id: 'related-combined', title: 'Idea, Build' }] },
      });
      const from = { rowId: 'r1', propertyId: 'p-links' };
      const to = { rowId: 'r2', propertyId: 'p-links' };

      source.state.selection = { kind: 'cell', anchor: from, focus: from };
      const copy = clipboardEvent('copy');

      grid(source.root).dispatchEvent(copy.event);
      target.state.selection = { kind: 'cell', anchor: to, focus: to };
      grid(target.root).dispatchEvent(clipboardEvent('paste', { 'text/plain': copy.data.get('text/plain') ?? '' }).event);

      expect(commitsOf(target.handlers)).toEqual([[[{
        rowId: 'r2', propertyId: 'p-links', value: [{ id: 'related-idea' }, { id: 'related-build' }],
      }], []]]);
      source.view.destroy();
      target.view.destroy();
    });

    it.each(['text/plain', 'text/html'] as const)('keeps target options when one copied label is unresolved in %s', (format) => {
      const sourceTags: PropertyDefinition = { id: 'p-tags', name: 'Tags', type: 'multiSelect', position: 'a5', config: { options: [
        { id: 'o-idea', label: 'Idea', position: 'a0' },
        { id: 'o-build', label: 'Build', position: 'a1' },
      ] } };
      const targetTags: PropertyDefinition = { ...sourceTags, config: { options: [
        { id: 'o-idea', label: 'Idea', position: 'a0' },
        { id: 'o-existing', label: 'Existing', position: 'a1' },
      ] } };
      const targetRow = row('r2', 'Target', { 'p-tags': ['o-existing'] });
      const handlers = makeHandlers();

      handlers.commitCells = vi.fn((changes: Array<{ rowId: string; propertyId: string; value: DatabaseRow['properties'][string] }>) => {
        for (const change of changes) {
          if (change.rowId === targetRow.id) targetRow.properties[change.propertyId] = change.value;
        }
      });
      const source = mount({
        schema: [...schema, sourceTags],
        rows: [row('r1', 'Source', { 'p-tags': ['o-idea', 'o-build'] })],
      });
      const target = mount({
        schema: [...schema, targetTags],
        rows: [targetRow],
        handlers,
      });
      const from = { rowId: 'r1', propertyId: 'p-tags' };
      const to = { rowId: 'r2', propertyId: 'p-tags' };

      source.state.selection = { kind: 'cell', anchor: from, focus: from };
      const copy = clipboardEvent('copy');

      grid(source.root).dispatchEvent(copy.event);
      target.state.selection = { kind: 'cell', anchor: to, focus: to };
      grid(target.root).dispatchEvent(clipboardEvent('paste', { [format]: copy.data.get(format) ?? '' }).event);

      expect(targetRow.properties['p-tags']).toEqual(['o-existing']);
      expect(commitsOf(handlers)).toEqual([[[], []]]);
      source.view.destroy();
      target.view.destroy();
    });

    it('pastes a block of cells from the anchor, turning text into each type', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r1', 'p-amount');
      const paste = clipboardEvent('paste', { 'text/plain': '7\tBuild\n8\tIdea' });

      grid(root).dispatchEvent(paste.event);

      expect(paste.event.defaultPrevented).toBe(true);
      expect(commitsOf(handlers)).toEqual([[[
        { rowId: 'r1', propertyId: 'p-amount', value: 7 },
        { rowId: 'r1', propertyId: 'p-stage', value: 'o-build' },
        { rowId: 'r2', propertyId: 'p-amount', value: 8 },
        { rowId: 'r2', propertyId: 'p-stage', value: 'o-idea' },
      ], []]]);
    });

    it('pastes one value into every selected cell', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r1', 'p-notes');
      press(grid(root), 'ArrowDown', { shiftKey: true });
      press(grid(root), 'ArrowDown', { shiftKey: true });
      grid(root).dispatchEvent(clipboardEvent('paste', { 'text/plain': 'same' }).event);

      expect(commitsOf(handlers)[0]).toEqual([[
        { rowId: 'r1', propertyId: 'p-notes', value: 'same' },
        { rowId: 'r2', propertyId: 'p-notes', value: 'same' },
        { rowId: 'r3', propertyId: 'p-notes', value: 'same' },
      ], []]);
    });

    it('adds rows for pasted lines past the last row', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r3', 'p-title');
      grid(root).dispatchEvent(clipboardEvent('paste', { 'text/plain': 'Charlie 2\nDelta\nEcho' }).event);

      expect(commitsOf(handlers)[0]).toEqual([
        [{ rowId: 'r3', propertyId: 'p-title', value: 'Charlie 2' }],
        [{ 'p-title': 'Delta' }, { 'p-title': 'Echo' }],
      ]);
    });

    it('turns a pasted table with matching headers into new rows, column by name', () => {
      const { root, handlers } = mount();
      const html = '<table><tr><th>Stage</th><th>Name</th><th>Unknown</th></tr><tr><td>Build</td><td>Foxtrot</td><td>x</td></tr></table>';

      grid(root).focus();
      grid(root).dispatchEvent(clipboardEvent('paste', { 'text/html': html, 'text/plain': 'ignored' }).event);

      expect(commitsOf(handlers)[0]).toEqual([[], [{ 'p-stage': 'o-build', 'p-title': 'Foxtrot' }]]);
    });

    it('roundtrips copied relation references with comma-bearing titles', () => {
      const relation: PropertyDefinition = { id: 'p-links', name: 'Links', type: 'relation', position: 'a5', relation: { targetDatabaseId: 'related-db' } };
      const candidates = [{ id: 'related-1', title: 'Research, design' }, { id: 'related-2', title: 'Build' }, { id: 'related-3', title: 'Existing' }];
      const { root, handlers, state, view } = mount({
        schema: [...schema, relation],
        rows: [row('r1', 'Alpha', { 'p-links': [{ id: 'related-1' }, { id: 'related-2' }] }), row('r2', 'Bravo', { 'p-links': [{ id: 'related-3' }] })],
        cellContext: { relationCandidates: () => candidates, relationTitle: (_property, id) => candidates.find((candidate) => candidate.id === id)?.title },
      });
      const source = { rowId: 'r1', propertyId: 'p-links' };

      state.selection = { kind: 'cell', anchor: source, focus: source };
      const copy = clipboardEvent('copy');

      grid(root).dispatchEvent(copy.event);
      const target = { rowId: 'r2', propertyId: 'p-links' };

      state.selection = { kind: 'cell', anchor: target, focus: target };
      grid(root).dispatchEvent(clipboardEvent('paste', Object.fromEntries(copy.data)).event);

      expect(commitsOf(handlers)).toEqual([[[{ rowId: 'r2', propertyId: 'p-links', value: [{ id: 'related-1' }, { id: 'related-2' }] }], []]]);
      view.destroy();
    });

    it('roundtrips copied relations without confusing equal row titles', () => {
      const relation: PropertyDefinition = { id: 'p-links', name: 'Links', type: 'relation', position: 'a5', relation: { targetDatabaseId: 'related-db' } };
      const candidates = [{ id: 'related-1', title: 'Same title' }, { id: 'related-2', title: 'Same title' }];
      const { root, handlers, state, view } = mount({
        schema: [...schema, relation],
        rows: [row('r1', 'Alpha', { 'p-links': [{ id: 'related-1' }] }), row('r2', 'Bravo', { 'p-links': [{ id: 'related-2' }] })],
        cellContext: { relationCandidates: () => candidates, relationTitle: (_property, id) => candidates.find((candidate) => candidate.id === id)?.title },
      });
      const source = { rowId: 'r1', propertyId: 'p-links' };

      state.selection = { kind: 'cell', anchor: source, focus: source };
      const copy = clipboardEvent('copy');

      grid(root).dispatchEvent(copy.event);
      const target = { rowId: 'r2', propertyId: 'p-links' };

      state.selection = { kind: 'cell', anchor: target, focus: target };
      grid(root).dispatchEvent(clipboardEvent('paste', Object.fromEntries(copy.data)).event);

      expect(commitsOf(handlers)).toEqual([[[{ rowId: 'r2', propertyId: 'p-links', value: [{ id: 'related-1' }] }], []]]);
      view.destroy();
    });

    it('keeps existing links when copied relations cannot resolve in the target', () => {
      const relation: PropertyDefinition = { id: 'p-links', name: 'Links', type: 'relation', position: 'a5', relation: { targetDatabaseId: 'related-db' } };
      const data = [row('r1', 'Alpha', { 'p-links': [{ id: 'missing-page' }] }), row('r2', 'Bravo', { 'p-links': [{ id: 'existing-page' }] })];
      const handlers = makeHandlers();

      handlers.commitCells = vi.fn((changes) => {
        for (const change of changes) {
          const target = data.find((item) => item.id === change.rowId);

          if (target !== undefined) target.properties[change.propertyId] = change.value;
        }
      });
      const { root, state, view } = mount({
        schema: [...schema, relation], rows: data, handlers,
        cellContext: { relationCandidates: () => [{ id: 'existing-page', title: 'Existing' }] },
      });
      const source = { rowId: 'r1', propertyId: 'p-links' };

      state.selection = { kind: 'cell', anchor: source, focus: source };
      const copy = clipboardEvent('copy');

      grid(root).dispatchEvent(copy.event);
      const target = { rowId: 'r2', propertyId: 'p-links' };

      state.selection = { kind: 'cell', anchor: target, focus: target };
      grid(root).dispatchEvent(clipboardEvent('paste', Object.fromEntries(copy.data)).event);

      expect(data.find((item) => item.id === 'r2')?.properties['p-links']).toEqual([{ id: 'existing-page' }]);
      grid(root).dispatchEvent(clipboardEvent('paste', { 'text/plain': 'Unresolvable page' }).event);
      expect(data.find((item) => item.id === 'r2')?.properties['p-links']).toEqual([{ id: 'existing-page' }]);
      view.destroy();
    });

    it('pastes relation titles into new rows using the grid relation candidates', () => {
      const relation: PropertyDefinition = { id: 'p-links', name: 'Links', type: 'relation', position: 'a5', relation: { targetDatabaseId: 'related-db' } };
      const { root, handlers, view } = mount({
        schema: [...schema, relation],
        cellContext: { relationCandidates: () => [{ id: 'related-1', title: 'Research, design' }] },
      });
      const html = '<table><tr><th>Name</th><th>Links</th></tr><tr><td>New row</td><td>Research, design</td></tr></table>';

      grid(root).dispatchEvent(clipboardEvent('paste', { 'text/html': html }).event);

      expect(commitsOf(handlers)).toEqual([[[], [{ 'p-title': 'New row', 'p-links': [{ id: 'related-1' }] }]]]);
      view.destroy();
    });

    it('keeps comma-bearing multi-select chips through the grid clipboard', () => {
      const tags: PropertyDefinition = { id: 'p-tags', name: 'Tags', type: 'multiSelect', position: 'a5', config: { options: [
        { id: 'o-design', label: 'Research, "design"', position: 'a0' },
        { id: 'o-build', label: 'Build', position: 'a1' },
      ] } };
      const { root, handlers, state, view } = mount({
        schema: [...schema, tags],
        rows: [row('r1', 'Alpha', { 'p-tags': ['o-design', 'o-build'] }), row('r2', 'Bravo')],
      });
      const source = { rowId: 'r1', propertyId: 'p-tags' };

      state.selection = { kind: 'cell', anchor: source, focus: source };
      const copy = clipboardEvent('copy');

      grid(root).dispatchEvent(copy.event);
      const target = { rowId: 'r2', propertyId: 'p-tags' };

      state.selection = { kind: 'cell', anchor: target, focus: target };
      grid(root).dispatchEvent(clipboardEvent('paste', Object.fromEntries(copy.data)).event);

      expect(commitsOf(handlers)).toEqual([[[{ rowId: 'r2', propertyId: 'p-tags', value: ['o-design', 'o-build'] }], []]]);
      view.destroy();
    });

    it('keeps separate multi-select options when their labels also name one comma-bearing option', () => {
      const tags: PropertyDefinition = { id: 'p-tags', name: 'Tags', type: 'multiSelect', position: 'a5', config: { options: [
        { id: 'o-idea', label: 'Idea', position: 'a0' },
        { id: 'o-build', label: 'Build', position: 'a1' },
        { id: 'o-combined', label: 'Idea, Build', position: 'a2' },
      ] } };
      const { root, handlers, state, view } = mount({
        schema: [...schema, tags],
        rows: [row('r1', 'Alpha', { 'p-tags': ['o-idea', 'o-build'] }), row('r2', 'Bravo', { 'p-tags': ['o-combined'] })],
      });
      const source = { rowId: 'r1', propertyId: 'p-tags' };

      state.selection = { kind: 'cell', anchor: source, focus: source };
      const copy = clipboardEvent('copy');

      grid(root).dispatchEvent(copy.event);
      const target = { rowId: 'r2', propertyId: 'p-tags' };

      state.selection = { kind: 'cell', anchor: target, focus: target };
      grid(root).dispatchEvent(clipboardEvent('paste', Object.fromEntries(copy.data)).event);

      expect(commitsOf(handlers)).toEqual([[[{ rowId: 'r2', propertyId: 'p-tags', value: ['o-idea', 'o-build'] }], []]]);
      view.destroy();
    });

    it('keeps separate relation references when their titles also name one comma-bearing row', () => {
      const relation: PropertyDefinition = { id: 'p-links', name: 'Links', type: 'relation', position: 'a5', relation: { targetDatabaseId: 'related-db' } };
      const candidates = [
        { id: 'related-idea', title: 'Idea' },
        { id: 'related-build', title: 'Build' },
        { id: 'related-combined', title: 'Idea, Build' },
      ];
      const { root, handlers, state, view } = mount({
        schema: [...schema, relation],
        rows: [
          row('r1', 'Alpha', { 'p-links': [{ id: 'related-idea' }, { id: 'related-build' }] }),
          row('r2', 'Bravo', { 'p-links': [{ id: 'related-combined' }] }),
        ],
        cellContext: { relationCandidates: () => candidates, relationTitle: (_property, id) => candidates.find((candidate) => candidate.id === id)?.title },
      });
      const source = { rowId: 'r1', propertyId: 'p-links' };

      state.selection = { kind: 'cell', anchor: source, focus: source };
      const copy = clipboardEvent('copy');

      grid(root).dispatchEvent(copy.event);
      const target = { rowId: 'r2', propertyId: 'p-links' };

      state.selection = { kind: 'cell', anchor: target, focus: target };
      grid(root).dispatchEvent(clipboardEvent('paste', Object.fromEntries(copy.data)).event);

      expect(commitsOf(handlers)).toEqual([[[{ rowId: 'r2', propertyId: 'p-links', value: [{ id: 'related-idea' }, { id: 'related-build' }] }], []]]);
      view.destroy();
    });

    it('never writes from a read-only table', () => {
      const { root, handlers } = mount({ readOnly: true });

      selectCell(root, 'r1', 'p-notes');
      grid(root).dispatchEvent(clipboardEvent('paste', { 'text/plain': 'x' }).event);

      expect(handlers.commitCells).not.toHaveBeenCalled();
    });
  });

  describe('fill', () => {
    it('Cmd/Ctrl+D fills a range down from its top row', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r1', 'p-amount');
      press(grid(root), 'ArrowDown', { shiftKey: true });
      press(grid(root), 'ArrowDown', { shiftKey: true });
      const event = press(grid(root), 'd', { ctrlKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(commitsOf(handlers)[0]).toEqual([[
        { rowId: 'r2', propertyId: 'p-amount', value: 1200 },
        { rowId: 'r3', propertyId: 'p-amount', value: 1200 },
      ], []]);
    });

    it('Cmd/Ctrl+R fills a range right from its first column, and leaves a single cell alone', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r1', 'p-title');
      const lone = press(grid(root), 'r', { ctrlKey: true });

      expect(lone.defaultPrevented).toBe(false);
      press(grid(root), 'ArrowRight', { shiftKey: true });
      const fill = press(grid(root), 'r', { ctrlKey: true });

      expect(fill.defaultPrevented).toBe(true);
      expect(commitsOf(handlers)[0]).toEqual([[{ rowId: 'r1', propertyId: 'p-notes', value: 'Alpha' }], []]);
    });

    it('draws a fill handle on the selected cell', () => {
      const { root } = mount();

      selectCell(root, 'r1', 'p-notes');

      expect(cell(root, 'r1', 'p-notes').querySelector('[data-blok-database-table-fill-handle]')).not.toBeNull();
    });
  });

  describe('undo', () => {
    it('leaves Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z to the editor, which handles them after the grid', () => {
      const { root } = mount();

      selectCell(root, 'r1', 'p-notes');
      const undo = press(grid(root), 'z', { metaKey: true, code: 'KeyZ' });
      const redo = press(grid(root), 'z', { metaKey: true, shiftKey: true, code: 'KeyZ' });

      expect(undo.defaultPrevented).toBe(false);
      expect(redo.defaultPrevented).toBe(false);
      expect(root.querySelector('input, textarea')).toBeNull();
    });
  });

  describe('selection bar', () => {
    const selectRows = (root: HTMLElement, ...rowIds: string[]): void => {
      rowIds.forEach((rowId) => root.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-blok-database-table-row-checkbox]`)?.click());
    };

    it('shift-click on a row checkbox selects the rows between', () => {
      const { root, state } = mount();
      const box = (rowId: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-blok-database-table-row-checkbox]`);

      box('r1')?.click();
      box('r3')?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));

      expect(state.selection).toEqual({ kind: 'rows', rowIds: ['r1', 'r2', 'r3'] });
    });

    it('offers one button per visible editable property, and its edit lands on every selected row', () => {
      const { root, handlers } = mount();

      selectRows(root, 'r1', 'r3');
      const buttons = [...root.querySelectorAll<HTMLElement>('[data-blok-database-table-selection-property]')];

      expect(buttons.map((button) => button.getAttribute('data-property-id'))).toEqual(['p-notes', 'p-amount', 'p-stage', 'p-done']);

      buttons[3].click();

      expect(commitsOf(handlers)[0]).toEqual([[
        { rowId: 'r1', propertyId: 'p-done', value: true },
        { rowId: 'r3', propertyId: 'p-done', value: true },
      ], [], true]);
    });

    // research/31 §4b; research/35 §3: mixed rows open on the first row's value too.
    it('a Text bulk edit opens on the first selected row\'s value, shared or mixed', () => {
      const shared = mount({ rows: [row('r1', 'Alpha', { 'p-notes': 'same' }), row('r2', 'Bravo', { 'p-notes': 'same' }), row('r3', 'Charlie')] });

      selectRows(shared.root, 'r1', 'r2');
      shared.root.querySelector<HTMLElement>('[data-blok-database-table-selection-property][data-property-id="p-notes"]')?.click();
      expect(editorField().value).toBe('same');
      press(editorField(), 'Escape');
      expect(commitsOf(shared.handlers)).toEqual([]);
      document.body.innerHTML = '';

      const mixed = mount();

      selectRows(mixed.root, 'r1', 'r2');
      mixed.root.querySelector<HTMLElement>('[data-blok-database-table-selection-property][data-property-id="p-notes"]')?.click();
      expect(editorField().value).toBe('short');
    });

    it('a Text bulk edit shows each key in every selected cell, and writes once, on close (research/31 §4b)', () => {
      const { root, handlers } = mount();

      selectRows(root, 'r1', 'r2');
      root.querySelector<HTMLElement>('[data-blok-database-table-selection-property][data-property-id="p-notes"]')?.click();
      editorField().value = 'live';
      editorField().dispatchEvent(new Event('input', { bubbles: true }));

      expect(cell(root, 'r1', 'p-notes').querySelector('[data-blok-database-cell]')?.textContent).toBe('live');
      expect(cell(root, 'r2', 'p-notes').querySelector('[data-blok-database-cell]')?.textContent).toBe('live');
      expect(commitsOf(handlers)).toEqual([]);

      press(editorField(), 'Escape');

      expect(commitsOf(handlers)).toEqual([[[
        { rowId: 'r1', propertyId: 'p-notes', value: 'live' },
        { rowId: 'r2', propertyId: 'p-notes', value: 'live' },
      ], [], true]]);
    });

    // The field opens on r1's "short": typed back to it, nothing is written and r2 keeps its own (empty) value.
    it('a Text bulk edit closed with nothing written shows the old values again', () => {
      const { root, handlers } = mount();

      selectRows(root, 'r1', 'r2');
      root.querySelector<HTMLElement>('[data-blok-database-table-selection-property][data-property-id="p-notes"]')?.click();
      editorField().value = 'live';
      editorField().dispatchEvent(new Event('input', { bubbles: true }));
      editorField().value = 'short';
      editorField().dispatchEvent(new Event('input', { bubbles: true }));
      press(editorField(), 'Escape');

      expect(commitsOf(handlers)).toEqual([]);
      expect(cell(root, 'r1', 'p-notes').querySelector('[data-blok-database-cell]')?.textContent).toBe('short');
      expect(cell(root, 'r2', 'p-notes').textContent).toBe('');
    });

    it('the … menu duplicates and moves the selection to the trash', () => {
      const { root, handlers } = mount();

      selectRows(root, 'r1', 'r2');
      root.querySelector<HTMLElement>('[data-blok-database-table-selection-more]')?.click();
      const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-popover-item]')];

      expect(items().map((item) => item.textContent?.trim())).toEqual(['tools.database.tableDuplicate', 'tools.database.tableMoveToTrash']);
      items()[0].click();

      expect(handlers.duplicateRow).toHaveBeenCalledTimes(2);
    });

    it('Cmd/Ctrl+/ opens the property list to edit every selected row', () => {
      const { root } = mount();

      selectRows(root, 'r1', 'r2');
      const event = press(grid(root), '/', { ctrlKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect([...document.querySelectorAll('[data-blok-popover-item]')].map((item) => item.textContent?.trim()))
        .toEqual(['Notes', 'Amount', 'Stage', 'Done']);
    });
  });
});

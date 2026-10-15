import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { DatabaseRowData as PublicDatabaseRowData } from '../../../../types';
import type { DatabaseRowData } from '../../../../src/tools/database/types';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { sanitizeBlocks } from '../../../../src/components/utils/sanitizer';

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
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  blocks: {
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlocksCount: vi.fn().mockReturnValue(1),
    getChildren: vi.fn().mockReturnValue([]),
  },
  notifier: { show: vi.fn() },
} as unknown as API);

const createRowOptions = (
  dataOverrides: Partial<DatabaseRowData> = {},
  overrides: { readOnly?: boolean } = {},
): BlockToolConstructorOptions<DatabaseRowData> => ({
  data: {
    properties: {},
    position: 'a0',
    ...dataOverrides,
  },
  config: {},
  api: createMockAPI(),
  readOnly: overrides.readOnly ?? false,
  block: { id: 'test-row-block-id' } as never,
});

describe('DatabaseRowTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('static getters', () => {
    it('does not define a toolbox getter (not user-insertable)', () => {
      expect(Object.getOwnPropertyDescriptor(DatabaseRowTool, 'toolbox')).toBeUndefined();
    });

    it('isReadOnlySupported is true', () => {
      expect(DatabaseRowTool.isReadOnlySupported).toBe(true);
    });

    it('keeps a page pointer literal through saved-data sanitization', () => {
      const [sanitized] = sanitizeBlocks(
        [{ tool: 'database-row', data: { properties: {}, position: 'a0', pageId: 'row<page>' } }],
        () => DatabaseRowTool.sanitize,
      );

      expect(sanitized.data).toHaveProperty('pageId', 'row<page>');
    });
  });

  describe('render()', () => {
    it('returns HTMLDivElement with data-blok-tool="database-row"', () => {
      const tool = new DatabaseRowTool(createRowOptions());
      const element = tool.render();

      expect(element).toBeInstanceOf(HTMLDivElement);
      expect(element.getAttribute('data-blok-tool')).toBe('database-row');
    });
  });

  describe('save()', () => {
    it('returns { properties, position }', () => {
      const properties = { title: 'Hello', status: 'done' };
      const tool = new DatabaseRowTool(createRowOptions({ properties, position: 'b2' }));

      const element = tool.render();

      const saved = tool.save(element);

      expect(saved).toEqual({ properties: { title: 'Hello', status: 'done' }, position: 'b2' });
    });

    it('returns empty properties when none provided', () => {
      const tool = new DatabaseRowTool(createRowOptions({ properties: {} }));

      const element = tool.render();

      const saved = tool.save(element);

      expect(saved.properties).toEqual({});
    });

    it('omits `title` entirely for a row saved before that key existed', () => {
      const tool = new DatabaseRowTool(createRowOptions({ properties: { 'p-title': 'Old row' } }));

      const saved = tool.save(tool.render());

      expect(saved).not.toHaveProperty('title');
      expect(saved.properties['p-title']).toBe('Old row');
    });

    it('emits `title` for a row that carries one', () => {
      const tool = new DatabaseRowTool(createRowOptions({ properties: { 'p-title': 'Ship it' }, title: 'Ship it' }));

      expect(tool.save(tool.render()).title).toBe('Ship it');
    });

    it('preserves a migrated page pointer alongside its legacy body', () => {
      const legacy = { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Legacy' } }] };
      const migrated = {
        properties: { description: legacy },
        position: 'a0',
        pageId: 'row-page',
      };
      const tool = new DatabaseRowTool(createRowOptions(migrated));
      const saved = tool.save(tool.render());

      expect(saved).toHaveProperty('pageId', 'row-page');
      expect(saved.properties.description).toEqual(legacy);
    });

    it('does not invent a page pointer on an unmigrated row', () => {
      const tool = new DatabaseRowTool(createRowOptions({ properties: { description: { blocks: [] } } }));

      expect(tool.save(tool.render())).not.toHaveProperty('pageId');
    });
  });

  describe('templates', () => {
    it('saves the template flag and its repeat schedule', () => {
      const repeat = { frequency: 'weekly' as const, start: '2026-10-12T09:00:00.000Z' };
      const tool = new DatabaseRowTool(createRowOptions({ template: true, repeat }));

      expect(tool.save(document.createElement('div'))).toMatchObject({ template: true, repeat });
    });

    it('sets and clears the repeat schedule', () => {
      const tool = new DatabaseRowTool(createRowOptions({ template: true }));
      const repeat = { frequency: 'daily' as const, start: '2026-10-12T09:00:00.000Z' };

      tool.updateRepeat({ repeat });
      expect(tool.save(document.createElement('div')).repeat).toEqual(repeat);
      tool.updateRepeat({ repeat: null });
      expect(tool.save(document.createElement('div')).repeat).toBeUndefined();
    });

    it('never adds a template flag to a plain row', () => {
      const tool = new DatabaseRowTool(createRowOptions());

      expect('template' in tool.save(document.createElement('div'))).toBe(false);
    });
  });

  describe('date reminders', () => {
    it('loads and saves reminders by property id', () => {
      const reminders = { due: { remind: '1_day_before' as const, sentFor: '2027-06-14T13:00:00.000Z' } };
      const tool = new DatabaseRowTool(createRowOptions({ reminders }));

      expect(tool.save(document.createElement('div')).reminders).toEqual(reminders);
    });

    it('sets one reminder without touching another, and null removes it', () => {
      const tool = new DatabaseRowTool(createRowOptions({ reminders: { a: { remind: 'on_day_of_event' } } }));

      tool.updateReminders({ b: { remind: '1_week_before' } });
      expect(tool.save(document.createElement('div')).reminders).toEqual({ a: { remind: 'on_day_of_event' }, b: { remind: '1_week_before' } });
      tool.updateReminders({ a: null });
      expect(tool.save(document.createElement('div')).reminders).toEqual({ b: { remind: '1_week_before' } });
      tool.updateReminders({ b: null });
      expect('reminders' in tool.save(document.createElement('div'))).toBe(false);
    });

    it('never adds reminders to a row that has none', () => {
      const tool = new DatabaseRowTool(createRowOptions());

      expect('reminders' in tool.save(document.createElement('div'))).toBe(false);
    });
  });

  describe('page full width', () => {
    it.each([true, false])('saves the page\'s own full width (%s)', (fullWidth) => {
      const tool = new DatabaseRowTool(createRowOptions({ fullWidth }));

      expect(tool.save(document.createElement('div')).fullWidth).toBe(fullWidth);
    });

    it('drops a full width that is not a boolean', () => {
      const tool = new DatabaseRowTool(createRowOptions({ fullWidth: 'yes' } as unknown as Partial<DatabaseRowData>));

      expect('fullWidth' in tool.save(document.createElement('div'))).toBe(false);
    });

    it('sets the page\'s own full width, and null hands the width back to the layout', () => {
      const tool = new DatabaseRowTool(createRowOptions());

      tool.updateFullWidth({ fullWidth: false });
      expect(tool.save(document.createElement('div')).fullWidth).toBe(false);
      tool.updateFullWidth({ fullWidth: null });
      expect('fullWidth' in tool.save(document.createElement('div'))).toBe(false);
    });
  });

  describe('updateTitle()', () => {
    it('writes the top-level title AND the properties mirror', () => {
      const tool = new DatabaseRowTool(createRowOptions({ properties: { 'p-title': '', 'p-status': 'o1' }, title: '' }));

      tool.updateTitle({ title: 'Ship it', titlePropertyId: 'p-title' });

      const saved = tool.save(tool.render());

      expect(saved.title).toBe('Ship it');
      expect(saved.properties['p-title']).toBe('Ship it');
      expect(saved.properties['p-status']).toBe('o1');
    });

    it('starts carrying a title on a row that had none', () => {
      const tool = new DatabaseRowTool(createRowOptions({ properties: { 'p-title': 'Old row' } }));

      expect(tool.getTitle()).toBeUndefined();

      tool.updateTitle({ title: 'Old row edited', titlePropertyId: 'p-title' });

      expect(tool.getTitle()).toBe('Old row edited');
      expect(tool.getProperties()['p-title']).toBe('Old row edited');
    });

    it('skips the mirror when the schema has no title column', () => {
      const tool = new DatabaseRowTool(createRowOptions({ properties: { 'p-status': 'o1' }, title: '' }));

      tool.updateTitle({ title: 'Ship it', titlePropertyId: '' });

      expect(tool.getTitle()).toBe('Ship it');
      expect(tool.getProperties()).toEqual({ 'p-status': 'o1' });
    });
  });

  describe('validate()', () => {
    it('returns true for data with properties object', () => {
      const tool = new DatabaseRowTool(createRowOptions());

      expect(tool.validate({ properties: { title: 'Test' }, position: 'a0' })).toBe(true);
    });

    it('returns false when properties is missing', () => {
      const tool = new DatabaseRowTool(createRowOptions());

      expect(tool.validate({} as DatabaseRowData)).toBe(false);
    });

    it('returns false when properties is null', () => {
      const tool = new DatabaseRowTool(createRowOptions());

      expect(tool.validate({ properties: null, position: 'a0' } as unknown as DatabaseRowData)).toBe(false);
    });

    it('rejects an empty page pointer', () => {
      const tool = new DatabaseRowTool(createRowOptions());
      const row = { properties: {}, position: 'a0', pageId: '' };

      expect(tool.validate(row)).toBe(false);
    });

    it('rejects a non-string page pointer', () => {
      const tool = new DatabaseRowTool(createRowOptions());
      const row = { properties: {}, position: 'a0', pageId: 42 };

      expect(tool.validate(row as unknown as DatabaseRowData)).toBe(false);
    });

    it('accepts a nonempty page pointer', () => {
      const tool = new DatabaseRowTool(createRowOptions());
      const row = { properties: {}, position: 'a0', pageId: 'row-page' };

      expect(tool.validate(row)).toBe(true);
    });
  });

  describe('updateProperties()', () => {
    it('merges changes into existing properties', () => {
      const tool = new DatabaseRowTool(createRowOptions({ properties: { title: 'Original', status: 'todo' } }));

      tool.updateProperties({ status: 'done', priority: 'high' });

      expect(tool.getProperties()).toEqual({ title: 'Original', status: 'done', priority: 'high' });
    });
  });

  describe('updatePosition()', () => {
    it('updates the position', () => {
      const tool = new DatabaseRowTool(createRowOptions({ position: 'a0' }));

      tool.updatePosition({ position: 'c5' });

      expect(tool.getPosition()).toBe('c5');
    });
  });

  describe('getProperties()', () => {
    it('returns current properties', () => {
      const properties = { name: 'Test Row' };
      const tool = new DatabaseRowTool(createRowOptions({ properties }));

      expect(tool.getProperties()).toEqual({ name: 'Test Row' });
    });
  });

  describe('getPosition()', () => {
    it('returns current position', () => {
      const tool = new DatabaseRowTool(createRowOptions({ position: 'z9' }));

      expect(tool.getPosition()).toBe('z9');
    });
  });

  describe('setData()', () => {
    it('takes new data in place', () => {
      const tool = new DatabaseRowTool(createRowOptions({ properties: { a: '1' }, position: 'a0', title: 'Old' }));
      const properties = { a: '2' };

      expect(tool.setData({ properties, position: 'a5', title: 'New' })).toBe(true);
      tool.updateProperties({ a: '3' });

      expect(tool.save(document.createElement('div'))).toEqual({ properties: { a: '3' }, position: 'a5', title: 'New' });
      expect(properties).toEqual({ a: '2' });
    });

    it('drops the title when the new data has none', () => {
      const tool = new DatabaseRowTool(createRowOptions({ properties: {}, position: 'a0', title: 'Old' }));

      tool.setData({ properties: {}, position: 'a0' });

      expect(tool.getTitle()).toBeUndefined();
    });

    it('retains a replayed page pointer through save', () => {
      const tool = new DatabaseRowTool(createRowOptions());
      const replayed = { properties: { description: { blocks: [] } }, position: 'a0', pageId: 'row-page' };

      tool.setData(replayed);

      expect(tool.save(tool.render())).toHaveProperty('pageId', 'row-page');
    });
  });

  describe('keys this version does not know', () => {
    // A newer Blok may add a top-level row key. Dropping it here would make
    // this version's save prune it from the shared document for everyone.
    const withFutureKey = (): DatabaseRowData => Object.assign(
      { properties: { title: 'Row' }, position: 'a1', pageId: 'page-1' },
      { futureKey: 'a & <b>x</b>', futureObject: { nested: [1, 2] } },
    );

    it('keeps an unknown top-level key through constructor and save', () => {
      const tool = new DatabaseRowTool(createRowOptions(withFutureKey()));
      const saved: Record<string, unknown> = { ...tool.save(document.createElement('div')) };

      expect(saved.futureKey).toBe('a & <b>x</b>');
      expect(saved.futureObject).toEqual({ nested: [1, 2] });
      expect(saved).toMatchObject({ properties: { title: 'Row' }, position: 'a1', pageId: 'page-1' });
    });

    it('keeps an unknown top-level key through setData and readData', () => {
      const tool = new DatabaseRowTool(createRowOptions());

      tool.setData(withFutureKey());
      tool.updateProperties({ title: 'Edited' });
      const live: Array<Record<string, unknown>> = [];

      tool.readData({ receive: (data) => live.push({ ...data }) });
      const saved: Record<string, unknown> = { ...tool.save(document.createElement('div')) };

      expect(saved.futureKey).toBe('a & <b>x</b>');
      expect(live[0]?.futureKey).toBe('a & <b>x</b>');
      expect(saved.properties).toEqual({ title: 'Edited' });
    });

    it('still drops a malformed known key', () => {
      const malformed: Record<string, unknown> = { properties: {}, position: 'a0', pageId: '', title: 7 };
      const tool = new DatabaseRowTool({ ...createRowOptions(), data: malformed as unknown as DatabaseRowData });
      const saved = tool.save(document.createElement('div'));

      expect(saved).not.toHaveProperty('pageId');
      expect(saved).not.toHaveProperty('title');
    });

    it('does not let an unknown key shadow a known one', () => {
      const tool = new DatabaseRowTool(createRowOptions(withFutureKey()));

      tool.updatePosition({ position: 'b0' });

      expect(tool.save(document.createElement('div')).position).toBe('b0');
    });
  });

  describe('readData()', () => {
    it('hands back the row as it is now, not as it was saved', () => {
      const tool = new DatabaseRowTool(createRowOptions({ properties: { a: '1' }, position: 'a0' }));

      tool.save(document.createElement('div'));
      tool.updateProperties({ a: '2' });
      tool.updatePosition({ position: 'a5' });
      const receive = vi.fn();

      tool.readData({ receive });

      expect(receive).toHaveBeenCalledWith({ properties: { a: '2' }, position: 'a5' });
    });

    it('includes a migrated page pointer in the live row projection', () => {
      const migrated = { properties: {}, position: 'a0', pageId: 'row-page' };
      const tool = new DatabaseRowTool(createRowOptions(migrated));
      const receive = vi.fn();

      tool.readData({ receive });

      expect(receive).toHaveBeenCalledWith(migrated);
    });

    it('gives a copy, so a saved snapshot does not follow later edits', () => {
      const tool = new DatabaseRowTool(createRowOptions({ properties: { a: '1' }, position: 'a0' }));
      const saved = tool.save(document.createElement('div'));

      tool.updateProperties({ a: '2' });

      expect(saved.properties).toEqual({ a: '1' });
    });

    it('does not share the properties object it was created with', () => {
      const properties = { a: '1' };
      const tool = new DatabaseRowTool(createRowOptions({ properties, position: 'a0' }));

      tool.updateProperties({ a: '2' });

      expect(properties).toEqual({ a: '1' });
    });
  });

  describe('setReadOnly()', () => {
    it('setReadOnly method exists on prototype (enables fast-path in-place toggle)', () => {
      expect(typeof DatabaseRowTool.prototype.setReadOnly).toBe('function');
    });

    it('setReadOnly(true) does not throw', () => {
      const tool = new DatabaseRowTool(createRowOptions());

      expect(() => tool.setReadOnly(true)).not.toThrow();
    });

    it('setReadOnly(false) does not throw', () => {
      const tool = new DatabaseRowTool(createRowOptions());

      expect(() => tool.setReadOnly(false)).not.toThrow();
    });

    it('setReadOnly does not affect saved data', () => {
      const tool = new DatabaseRowTool(createRowOptions({ properties: { title: 'Stable' }, position: 'b2' }));

      tool.setReadOnly(true);
      tool.setReadOnly(false);

      const saved = tool.save(tool.render());

      expect(saved.properties).toEqual({ title: 'Stable' });
      expect(saved.position).toBe('b2');
    });
  });

  describe('empty page prompt', () => {
    interface Prompt { templates: boolean; list: Array<{ id: string; title: string }> }

    /** A row whose parent database answers the prompt read with `prompt`; undefined = not built yet. */
    const promptRow = (prompt: Prompt | undefined, data: Partial<DatabaseRowData> = {}): { tool: DatabaseRowTool; el: HTMLElement; calls: Array<[string, unknown]> } => {
      const calls: Array<[string, unknown]> = [];
      const parent = {
        call: (name: string, param: unknown): void => {
          if (name !== 'rowPagePrompt') calls.push([name, param]);
          if (name === 'rowPagePrompt' && prompt !== undefined) {
            (param as { receive: (p: Prompt) => void }).receive(prompt);
          }
        },
      };
      const options = createRowOptions(data);
      const api = options.api as unknown as { blocks: Record<string, unknown> };

      api.blocks.getById = vi.fn().mockReturnValue(parent);
      api.blocks.insertAt = vi.fn().mockReturnValue({ id: 'p1', holder: document.createElement('div') });
      (options as { block: unknown }).block = { id: 'row', parentId: 'db' };
      (options.api as unknown as { caret: unknown }).caret = { setToBlock: vi.fn() };
      const tool = new DatabaseRowTool(options);
      const el = tool.render();

      tool.rendered();

      return { tool, el, calls };
    };
    const empty = (el: HTMLElement): HTMLElement | null => el.querySelector<HTMLElement>('[data-blok-database-row-empty]');
    const picks = (el: HTMLElement): string[] => [...el.querySelectorAll('[data-blok-database-row-pick]')].map((item) => item.getAttribute('data-blok-database-row-pick') ?? '');
    const active = (el: HTMLElement): string | null => el.querySelector('[data-blok-database-row-pick][data-active]')?.getAttribute('data-blok-database-row-pick') ?? null;

    it('shows create a template on an empty page when templates are on and none exist', () => {
      const { el, calls } = promptRow({ templates: true, list: [] });
      const create = empty(el)?.querySelector<HTMLElement>('[data-blok-database-row-create-template]');

      expect(empty(el)?.textContent).toBe('tools.database.rowBodyEmptyOr tools.database.rowBodyCreateTemplate');
      expect(create?.tagName).toBe('BUTTON');
      create?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(calls).toEqual([['addTemplate', undefined]]);
    });

    it('lists the templates, Empty and New template when templates exist', () => {
      const { el } = promptRow({ templates: true, list: [{ id: 'tA', title: 'Tmpl A' }, { id: 'tB', title: '' }] });

      expect(empty(el)?.querySelector('[data-blok-database-row-empty-text]')?.textContent).toBe('tools.database.rowBodyPickTemplate');
      expect(picks(el)).toEqual(['tA', 'tB', 'empty', 'new']);
      expect([...el.querySelectorAll('[data-blok-database-row-pick-label]')].map((item) => item.textContent)).toEqual(['Tmpl A', 'tools.database.templateUntitled', 'tools.database.cellEmpty', 'tools.database.templateNew']);
    });

    it('applies a template, starts an empty page or makes a new template from the picker', () => {
      const { el, calls } = promptRow({ templates: true, list: [{ id: 'tA', title: 'Tmpl A' }] });
      const pick = (id: string): void => {
        el.querySelector(`[data-blok-database-row-pick="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      };

      pick('tA');
      pick('new');

      expect(calls).toEqual([['applyTemplate', { rowId: 'row', templateId: 'tA' }], ['addTemplate', undefined]]);
      pick('empty');

      expect(calls).toHaveLength(2);
      expect(el.querySelector('[data-blok-database-row-body]')?.children).toHaveLength(1);
    });

    it('shows no prompt and no picker when templates are off', () => {
      const { el } = promptRow({ templates: false, list: [{ id: 'tA', title: 'Tmpl A' }] });

      expect(empty(el)?.textContent).toBe('');
      expect(picks(el)).toEqual([]);
    });

    it('shows the plain prompt and no picker on a template row', () => {
      const { el } = promptRow({ templates: true, list: [{ id: 'tA', title: 'Tmpl A' }] }, { template: true });

      expect(empty(el)?.textContent).toBe('tools.database.rowBodyEmpty');
      expect(picks(el)).toEqual([]);
    });

    it('shows the plain prompt while the database is not built yet', () => {
      const { el } = promptRow(undefined);

      expect(empty(el)?.textContent).toBe('tools.database.rowBodyEmpty');
    });

    it('redraws from the database on refreshPlaceholder', () => {
      const prompt: Prompt = { templates: true, list: [] };
      const { tool, el } = promptRow(prompt);

      prompt.list = [{ id: 'tA', title: 'Tmpl A' }];
      tool.refreshPlaceholder();

      expect(picks(el)).toEqual(['tA', 'empty', 'new']);
    });

    it('moves the highlight with the menu keys, wrapping, and Enter picks it', () => {
      const { tool, el, calls } = promptRow({ templates: true, list: [{ id: 'tA', title: 'Tmpl A' }] });
      const move = (step: 1 | -1): boolean[] => {
        const handled: boolean[] = [];

        tool.movePick({ step, receive: (h) => handled.push(h) });

        return handled;
      };

      expect(active(el)).toBeNull();
      expect(move(-1)).toEqual([true]);
      expect(active(el)).toBe('new');
      move(1);
      expect(active(el)).toBe('tA');
      move(1);
      expect(active(el)).toBe('empty');
      move(-1);
      tool.enter();

      expect(calls).toEqual([['applyTemplate', { rowId: 'row', templateId: 'tA' }]]);
    });

    it('starts an empty page on Enter with nothing highlighted, and leaves arrows alone without a picker', () => {
      const { tool, el } = promptRow({ templates: true, list: [] });
      const handled: boolean[] = [];

      tool.movePick({ step: 1, receive: (h) => handled.push(h) });
      tool.enter();

      expect(handled).toEqual([false]);
      expect(el.querySelector('[data-blok-database-row-body]')?.children).toHaveLength(1);
    });

    it('drops the highlight on redraw', () => {
      const { tool, el } = promptRow({ templates: true, list: [{ id: 'tA', title: 'Tmpl A' }] });

      tool.movePick({ step: 1, receive: () => undefined });
      tool.refreshPlaceholder();

      expect(active(el)).toBeNull();
    });

    it('leaves the title keys alone once the page has a body, so Enter goes to the body', () => {
      const { tool, el, calls } = promptRow({ templates: true, list: [{ id: 'tA', title: 'Tmpl A' }] });
      const api = (tool as unknown as { api: { blocks: { getChildren: ReturnType<typeof vi.fn> }; caret: { setToBlock: ReturnType<typeof vi.fn> } } }).api;
      const handled: boolean[] = [];

      api.blocks.getChildren.mockReturnValue([{ id: 'b1' }]);
      tool.movePick({ step: -1, receive: (h) => handled.push(h) });
      tool.enter();

      expect(handled).toEqual([false]);
      expect(active(el)).toBeNull();
      expect(calls).toEqual([]);
      expect(api.caret.setToBlock).toHaveBeenCalledWith('b1', 'start');
    });

    it('clears the highlight after a pick', () => {
      const { tool, el } = promptRow({ templates: true, list: [{ id: 'tA', title: 'Tmpl A' }] });

      tool.movePick({ step: 1, receive: () => undefined });
      tool.enter();

      expect(active(el)).toBeNull();
    });

    it('owns the picker keyboard, so Blok leaves its arrows and Enter alone', () => {
      const { el } = promptRow({ templates: true, list: [{ id: 'tA', title: 'Tmpl A' }] });

      expect(el.querySelector('[data-blok-database-row-picker]')?.hasAttribute('data-blok-keyboard-owner')).toBe(true);
    });

    it('moves focus through the picker with the arrows when a pick holds focus', () => {
      const { el } = promptRow({ templates: true, list: [{ id: 'tA', title: 'Tmpl A' }] });
      const first = el.querySelector<HTMLElement>('[data-blok-database-row-pick="tA"]');

      document.body.appendChild(el);
      first?.focus();
      first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(document.activeElement?.getAttribute('data-blok-database-row-pick')).toBe('empty');
      expect(active(el)).toBe('empty');
      el.remove();
    });
  });

  describe('public type export', () => {
    it('DatabaseRowData is importable from public types', () => {
      const rowData: PublicDatabaseRowData = { properties: { title: 'Test' }, position: 'a0' };

      expect(rowData.properties).toEqual({ title: 'Test' });
      expect(rowData.position).toBe('a0');
    });
  });
});

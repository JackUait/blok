import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { DatabaseRowData as PublicDatabaseRowData } from '../../../../types';
import type { DatabaseRowData } from '../../../../src/tools/database/types';
import { DatabaseRowTool } from '../../../../src/tools/database-row';

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

  describe('public type export', () => {
    it('DatabaseRowData is importable from public types', () => {
      const rowData: PublicDatabaseRowData = { properties: { title: 'Test' }, position: 'a0' };

      expect(rowData.properties).toEqual({ title: 'Test' });
      expect(rowData.position).toBe('a0');
    });
  });
});

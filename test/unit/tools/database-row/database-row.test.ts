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

  describe('public type export', () => {
    it('DatabaseRowData is importable from public types', () => {
      const rowData: PublicDatabaseRowData = { properties: { title: 'Test' }, position: 'a0' };

      expect(rowData.properties).toEqual({ title: 'Test' });
      expect(rowData.position).toBe('a0');
    });
  });
});

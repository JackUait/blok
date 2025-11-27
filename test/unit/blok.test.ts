import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { EditorConfig } from '../../types';
import type Core from '../../src/components/core';
import type { EditorModules } from '../../src/types-internal/editor-modules';

// Mock VERSION global variable
declare global {

  var VERSION: string;
}

// Define VERSION before importing blok
(global as { VERSION?: string }).VERSION = '2.31.0-test';

// Mock dependencies
vi.mock('../../src/components/utils/tooltip', () => {
  const mockDestroyTooltip = vi.fn();

  return {
    destroy: mockDestroyTooltip,
    mockDestroyTooltip,
  };
});

vi.mock('../../src/components/utils', async () => {
  const actual = await vi.importActual('../../src/components/utils');
  const defaultIsObject = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v);
  const defaultIsFunction = (fn: unknown): boolean => typeof fn === 'function';
  const mockIsObject = vi.fn().mockImplementation(defaultIsObject);
  const mockIsFunction = vi.fn().mockImplementation(defaultIsFunction);

  return {
    ...actual,
    isObject: mockIsObject,
    isFunction: mockIsFunction,
    mockIsObject,
    mockIsFunction,
    defaultIsObject,
    defaultIsFunction,
  };
});

// Mock Core class - use factory function to avoid hoisting issues
vi.mock('../../src/components/core', () => {
  const createMockModuleInstances = (): Partial<EditorModules> => ({
    API: {
      methods: {
        blocks: {
          clear: vi.fn(),
          render: vi.fn(),
        } as unknown as EditorModules['API']['methods']['blocks'],
        caret: {
          focus: vi.fn(),
        } as unknown as EditorModules['API']['methods']['caret'],
        events: {
          on: vi.fn(),
          off: vi.fn(),
          emit: vi.fn(),
        },
        saver: {
          save: vi.fn(),
        },
      } as unknown as EditorModules['API']['methods'],
    } as unknown as EditorModules['API'],
    Toolbar: {
      blockSettings: undefined,
      inlineToolbar: undefined,
    } as unknown as EditorModules['Toolbar'],
    BlockSettings: {} as unknown as EditorModules['BlockSettings'],
    InlineToolbar: {} as unknown as EditorModules['InlineToolbar'],
  });

  const mockModuleInstances = createMockModuleInstances();
  const lastInstanceRef = { value: undefined as Core | undefined };

  /**
   *
   */
  class MockCore {
    public configuration: Record<string, unknown> = {};
    public moduleInstances: Partial<EditorModules>;
    public isReady: Promise<void>;

    /**
     *
     */
    constructor() {
      this.moduleInstances = {
        ...mockModuleInstances,
      };
      this.isReady = Promise.resolve();
      // Store the last instance for test access
      lastInstanceRef.value = this as unknown as Core;
    }
  }

  return {
    default: MockCore,
    mockModuleInstances,
    lastInstance: () => lastInstanceRef.value,
  };
});

// Mock @babel/register
vi.mock('@babel/register', () => ({}));

// Mock polyfills
vi.mock('../../src/components/polyfills', () => ({}));

// Import Blok after mocks are set up
import Blok from '../../src/blok';

describe('Blok', () => {
  // Get mocked instances
  const mocks = {
    mockModuleInstances: undefined as Partial<EditorModules> | undefined,
    mockIsObject: undefined as ReturnType<typeof vi.fn> | undefined,
    mockIsFunction: undefined as ReturnType<typeof vi.fn> | undefined,
    mockDestroyTooltip: undefined as ReturnType<typeof vi.fn> | undefined,
  };

  beforeEach(async () => {
    // Import the mocked modules to access the mock instances
    const coreModule = await import('../../src/components/core') as {
      default: new (...args: unknown[]) => Core;
      mockModuleInstances?: Partial<EditorModules>;
    };

    const utilsModule = await import('../../src/components/utils') as {
      mockIsObject?: ReturnType<typeof vi.fn>;
      mockIsFunction?: ReturnType<typeof vi.fn>;
      defaultIsObject?: (v: unknown) => boolean;
      defaultIsFunction?: (fn: unknown) => boolean;
    };

    const tooltipModule = await import('../../src/components/utils/tooltip') as {
      mockDestroyTooltip?: ReturnType<typeof vi.fn>;
    };

    mocks.mockModuleInstances = coreModule.mockModuleInstances as Partial<EditorModules>;
    mocks.mockIsObject = utilsModule.mockIsObject as ReturnType<typeof vi.fn>;
    mocks.mockIsFunction = utilsModule.mockIsFunction as ReturnType<typeof vi.fn>;
    mocks.mockDestroyTooltip = tooltipModule.mockDestroyTooltip as ReturnType<typeof vi.fn>;

    vi.clearAllMocks();

    // Restore default implementations after clearing mocks
    if (utilsModule.defaultIsObject && mocks.mockIsObject) {
      mocks.mockIsObject.mockImplementation(utilsModule.defaultIsObject);
    }
    if (utilsModule.defaultIsFunction && mocks.mockIsFunction) {
      mocks.mockIsFunction.mockImplementation(utilsModule.defaultIsFunction);
    }

    mocks.mockModuleInstances!.API = {
      methods: {
        blocks: {
          clear: vi.fn(),
          render: vi.fn(),
        } as unknown as EditorModules['API']['methods']['blocks'],
        caret: {
          focus: vi.fn(),
        } as unknown as EditorModules['API']['methods']['caret'],
        events: {
          on: vi.fn(),
          off: vi.fn(),
          emit: vi.fn(),
        },
        saver: {
          save: vi.fn(),
        },
      } as unknown as EditorModules['API']['methods'],
    } as unknown as EditorModules['API'];
    mocks.mockModuleInstances!.Toolbar = {
      blockSettings: undefined,
      inlineToolbar: undefined,
    } as unknown as EditorModules['Toolbar'];
    mocks.mockModuleInstances!.BlockSettings = {} as unknown as EditorModules['BlockSettings'];
    mocks.mockModuleInstances!.InlineToolbar = {} as unknown as EditorModules['InlineToolbar'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with no configuration', async () => {
      const editor = new Blok();

      expect(editor.isReady).toBeInstanceOf(Promise);
      expect(editor.destroy).toBeDefined();
      expect(typeof editor.destroy).toBe('function');

      await editor.isReady;
    });

    it('should initialize with string configuration (holder)', async () => {
      const holder = 'my-editor';

      const editor = new Blok(holder);

      expect(editor.isReady).toBeInstanceOf(Promise);

      await editor.isReady;
    });

    it('should initialize with EditorConfig object', async () => {
      const config: EditorConfig = {
        holder: 'blok',
        placeholder: 'Start typing...',
      };

      const editor = new Blok(config);

      expect(editor.isReady).toBeInstanceOf(Promise);

      await editor.isReady;
    });

    it('should call onReady callback when provided', async () => {
      const onReady = vi.fn();
      const config: EditorConfig = {
        holder: 'blok',
        onReady,
      };

      mocks.mockIsObject!.mockReturnValue(true);
      mocks.mockIsFunction!.mockReturnValue(true);

      const editor = new Blok(config);

      await editor.isReady;

      expect(onReady).toHaveBeenCalledTimes(1);
    });

    it('should use default empty onReady function when not provided', async () => {
      const config: EditorConfig = {
        holder: 'blok',
      };

      mocks.mockIsObject!.mockReturnValue(true);
      mocks.mockIsFunction!.mockReturnValue(false);

      const editor = new Blok(config);

      await editor.isReady;

      // Should not throw
      expect(editor.isReady).toBeInstanceOf(Promise);
    });

    it('should initialize destroy as no-op before exportAPI', () => {
      const editor = new Blok();

      // Before isReady resolves, destroy should be a no-op
      expect(editor.destroy).toBeDefined();
      expect(() => editor.destroy()).not.toThrow();
    });
  });

  describe('isReady promise', () => {
    it('should resolve when Core is ready', async () => {
      const editor = new Blok();

      await expect(editor.isReady).resolves.toBeUndefined();
    });

    it('should call exportAPI when Core is ready', async () => {
      const editor = new Blok();
      const exportAPISpy = vi.spyOn(editor, 'exportAPI');

      await editor.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();

      expect(exportAPISpy).toHaveBeenCalled();
      if (lastCall) {
        expect(exportAPISpy).toHaveBeenCalledWith(lastCall);
      }
    });
  });

  describe('exportAPI', () => {
    it('should export configuration field', async () => {
      const config: EditorConfig = {
        holder: 'blok',
        placeholder: 'Test placeholder',
      };

      const editor = new Blok(config);

      await editor.isReady;

      expect((editor as unknown as Record<string, unknown>).configuration).toEqual(config);
    });

    it('should set prototype to API methods', async () => {
      const editor = new Blok();

      await editor.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        default: new (...args: unknown[]) => Core;
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();

      expect(Object.getPrototypeOf(editor)).toBe(lastCall?.moduleInstances.API?.methods);
    });

    it('should create module aliases', async () => {
      const editor = new Blok();

      await editor.isReady;

      const moduleAliases = (editor as unknown as { module: Record<string, unknown> }).module;

      expect(moduleAliases).toBeDefined();
      expect(typeof moduleAliases).toBe('object');
    });

    it('should create lowercase aliases for uppercase module names', async () => {
      const editor = new Blok();

      await editor.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances) {
        throw new Error('Core instance not found');
      }

      instances.API = {
        methods: {},
      } as EditorModules['API'];
      instances.Toolbar = {} as EditorModules['Toolbar'];

      const moduleAliases = (editor as unknown as { module: Record<string, unknown> }).module;

      // API should become 'api'
      expect(moduleAliases.api).toBe(instances.API);
      // Toolbar should become 'toolbar'
      expect(moduleAliases.toolbar).toBe(instances.Toolbar);
    });

    it('should create camelCase aliases for PascalCase module names', async () => {
      const editor = new Blok();

      await editor.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      instances.BlockSettings = {} as EditorModules['BlockSettings'];
      instances.InlineToolbar = {} as EditorModules['InlineToolbar'];

      const moduleAliases = (editor as unknown as { module: Record<string, unknown> }).module;

      expect(moduleAliases.blockSettings).toBe(instances.BlockSettings);
      expect(moduleAliases.inlineToolbar).toBe(instances.InlineToolbar);
    });

    it('should skip undefined module instances', async () => {
      const editor = new Blok();

      await editor.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      instances.API = {
        methods: {},
      } as EditorModules['API'];
      instances.Toolbar = undefined as unknown as EditorModules['Toolbar'];

      const moduleAliases = (editor as unknown as { module: Record<string, unknown> }).module;

      expect(moduleAliases.toolbar).toBeUndefined();
    });

    it('should attach blockSettings to toolbar module if not already present', async () => {
      const mockToolbar = {
        blockSettings: undefined,
      };
      const editor = new Blok();

      await editor.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      instances.Toolbar = mockToolbar as unknown as EditorModules['Toolbar'];
      instances.BlockSettings = {} as unknown as EditorModules['BlockSettings'];

      // Re-export API to apply the changes
      (editor as unknown as { exportAPI: (core: Core) => void }).exportAPI(lastCall);

      expect(mockToolbar.blockSettings).toBe(instances.BlockSettings);
    });

    it('should not override existing blockSettings on toolbar module', async () => {
      const existingBlockSettings = { existing: true };
      const mockToolbar = {
        blockSettings: existingBlockSettings,
      };
      const editor = new Blok();

      await editor.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      instances.Toolbar = mockToolbar as unknown as EditorModules['Toolbar'];
      instances.BlockSettings = {} as unknown as EditorModules['BlockSettings'];

      // Re-export API to apply the changes
      (editor as unknown as { exportAPI: (core: Core) => void }).exportAPI(lastCall);

      expect(mockToolbar.blockSettings).toBe(existingBlockSettings);
      expect(mockToolbar.blockSettings).not.toBe(instances.BlockSettings);
    });

    it('should attach inlineToolbar to toolbar module if not already present', async () => {
      const mockToolbar = {
        inlineToolbar: undefined,
      };
      const editor = new Blok();

      await editor.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      instances.Toolbar = mockToolbar as unknown as EditorModules['Toolbar'];
      instances.InlineToolbar = {} as unknown as EditorModules['InlineToolbar'];

      // Re-export API to apply the changes
      (editor as unknown as { exportAPI: (core: Core) => void }).exportAPI(lastCall);

      expect(mockToolbar.inlineToolbar).toBe(instances.InlineToolbar);
    });

    it('should not override existing inlineToolbar on toolbar module', async () => {
      const existingInlineToolbar = { existing: true };
      const mockToolbar = {
        inlineToolbar: existingInlineToolbar,
      };
      const editor = new Blok();

      await editor.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      instances.Toolbar = mockToolbar as unknown as EditorModules['Toolbar'];
      instances.InlineToolbar = {} as unknown as EditorModules['InlineToolbar'];

      // Re-export API to apply the changes
      (editor as unknown as { exportAPI: (core: Core) => void }).exportAPI(lastCall);

      expect(mockToolbar.inlineToolbar).toBe(existingInlineToolbar);
      expect(mockToolbar.inlineToolbar).not.toBe(instances.InlineToolbar);
    });

    it('should create shorthands for blocks methods', async () => {
      const editor = new Blok();

      await editor.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      expect((editor as unknown as { clear: unknown }).clear).toBe(instances.API?.methods.blocks.clear);
      expect((editor as unknown as { render: unknown }).render).toBe(instances.API?.methods.blocks.render);
    });

    it('should create shorthands for caret methods', async () => {
      const editor = new Blok();

      await editor.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      expect((editor as unknown as { focus: unknown }).focus).toBe(instances.API?.methods.caret.focus);
    });

    it('should create shorthands for events methods', async () => {
      const editor = new Blok();

      await editor.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      expect((editor as unknown as { on: unknown }).on).toBe(instances.API?.methods.events.on);
      expect((editor as unknown as { off: unknown }).off).toBe(instances.API?.methods.events.off);
      expect((editor as unknown as { emit: unknown }).emit).toBe(instances.API?.methods.events.emit);
    });

    it('should create shorthands for saver methods', async () => {
      const editor = new Blok();

      await editor.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      expect((editor as unknown as { save: unknown }).save).toBe(instances.API?.methods.saver.save);
    });

    it('should delete exportAPI method after export', async () => {
      const editor = new Blok();

      await editor.isReady;

      expect(Object.prototype.hasOwnProperty.call(editor, 'exportAPI')).toBe(false);
      expect(typeof (editor as unknown as { exportAPI: unknown }).exportAPI).toBe('function');
    });

    it('should make module property non-enumerable', async () => {
      const editor = new Blok();

      await editor.isReady;

      const descriptor = Object.getOwnPropertyDescriptor(editor, 'module');

      expect(descriptor).toBeDefined();
      expect(descriptor?.enumerable).toBe(false);
      expect(descriptor?.configurable).toBe(true);
      expect(descriptor?.writable).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should call destroy on all module instances that have destroy method', async () => {
      const mockDestroy1 = vi.fn();
      const mockDestroy2 = vi.fn();
      const mockModule1 = { destroy: mockDestroy1 };
      const mockModule2 = { destroy: mockDestroy2 };
      const mockModule3 = { noDestroy: true };

      mocks.mockModuleInstances!.Toolbar = mockModule1 as unknown as EditorModules['Toolbar'];
      mocks.mockModuleInstances!.BlockSettings = mockModule2 as unknown as EditorModules['BlockSettings'];
      mocks.mockModuleInstances!.InlineToolbar = mockModule3 as unknown as EditorModules['InlineToolbar'];

      const editor = new Blok();

      await editor.isReady;
      editor.destroy();

      expect(mockDestroy1).toHaveBeenCalledTimes(1);
      expect(mockDestroy2).toHaveBeenCalledTimes(1);
    });

    it('should remove all listeners from module instances', async () => {
      const mockRemoveAll = vi.fn();
      const mockModule = {
        listeners: {
          removeAll: mockRemoveAll,
        },
      };

      mocks.mockModuleInstances!.Toolbar = mockModule as unknown as EditorModules['Toolbar'];

      const editor = new Blok();

      await editor.isReady;
      editor.destroy();

      expect(mockRemoveAll).toHaveBeenCalled();
    });

    it('should call destroyTooltip', async () => {
      const editor = new Blok();

      await editor.isReady;
      editor.destroy();

      expect(mocks.mockDestroyTooltip).toHaveBeenCalledTimes(1);
    });

    it('should delete all own properties', async () => {
      const editor = new Blok();

      await editor.isReady;

      // Add some test properties
      const testValue = 123;

      (editor as unknown as Record<string, unknown>).testProperty = 'test';
      (editor as unknown as Record<string, unknown>).anotherProperty = testValue;

      expect((editor as unknown as Record<string, unknown>).testProperty).toBe('test');
      expect((editor as unknown as Record<string, unknown>).anotherProperty).toBe(testValue);

      editor.destroy();

      expect((editor as unknown as Record<string, unknown>).testProperty).toBeUndefined();
      expect((editor as unknown as Record<string, unknown>).anotherProperty).toBeUndefined();
    });

    it('should set prototype to null', async () => {
      const editor = new Blok();

      await editor.isReady;

      // Before destroy, prototype should be API methods
      expect(Object.getPrototypeOf(editor)).toBe(mocks.mockModuleInstances!.API?.methods);

      editor.destroy();

      // After destroy, prototype should be null
      expect(Object.getPrototypeOf(editor)).toBeNull();
    });

    it('should handle modules without listeners property', async () => {
      const mockModule = {
        destroy: vi.fn(),
        // No listeners property
      };

      mocks.mockModuleInstances!.Toolbar = mockModule as unknown as EditorModules['Toolbar'];

      const editor = new Blok();

      await editor.isReady;

      // Should not throw
      expect(() => editor.destroy()).not.toThrow();
    });

    it('should handle modules without destroy method', async () => {
      const mockModule = {
        listeners: {
          removeAll: vi.fn(),
        },
        // No destroy method
      };

      mocks.mockModuleInstances!.Toolbar = mockModule as unknown as EditorModules['Toolbar'];

      const editor = new Blok();

      await editor.isReady;

      // Should not throw
      expect(() => editor.destroy()).not.toThrow();
      expect(mockModule.listeners.removeAll).toHaveBeenCalled();
    });
  });

  describe('static version', () => {
    it('should expose version as static property', () => {
      expect(Blok.version).toBeDefined();
      expect(typeof Blok.version).toBe('string');
    });
  });
});


import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { BlokConfig } from '../../types';
import type { Core } from '../../src/components/core';
import type { BlokModules } from '../../src/types-internal/blok-modules';

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
  const createMockModuleInstances = (): Partial<BlokModules> => ({
    API: {
      methods: {
        blocks: {
          clear: vi.fn(),
          render: vi.fn(),
        } as unknown as BlokModules['API']['methods']['blocks'],
        caret: {
          focus: vi.fn(),
        } as unknown as BlokModules['API']['methods']['caret'],
        events: {
          on: vi.fn(),
          off: vi.fn(),
          emit: vi.fn(),
        },
        saver: {
          save: vi.fn(),
        },
        rectangleSelection: {
          cancelActiveSelection: vi.fn(),
          isRectActivated: vi.fn(),
          clearSelection: vi.fn(),
          startSelection: vi.fn(),
          endSelection: vi.fn(),
        },
      } as unknown as BlokModules['API']['methods'],
    } as unknown as BlokModules['API'],
    EventsAPI: {
      methods: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      },
    } as unknown as BlokModules['EventsAPI'],
    Toolbar: {
      blockSettings: undefined,
      inlineToolbar: undefined,
    } as unknown as BlokModules['Toolbar'],
    BlockSettings: {} as unknown as BlokModules['BlockSettings'],
    InlineToolbar: {} as unknown as BlokModules['InlineToolbar'],
    RectangleSelection: {
      cancelActiveSelection: vi.fn(),
      isRectActivated: vi.fn(),
      clearSelection: vi.fn(),
      startSelection: vi.fn(),
      endSelection: vi.fn(),
    } as unknown as BlokModules['RectangleSelection'],
    ThemeManager: {
      getMode: vi.fn().mockReturnValue('auto'),
      setMode: vi.fn(),
      getResolved: vi.fn().mockReturnValue('light'),
    } as unknown as BlokModules['ThemeManager'],
    ThemeAPI: {
      methods: {
        get: vi.fn().mockReturnValue('auto'),
        set: vi.fn(),
        getResolved: vi.fn().mockReturnValue('light'),
      },
    } as unknown as BlokModules['ThemeAPI'],
  });

  const mockModuleInstances = createMockModuleInstances();
  const lastInstanceRef = { value: undefined as Core | undefined };

  /**
   *
   */
  class MockCore {
    public configuration: Record<string, unknown> = {};
    public moduleInstances: Partial<BlokModules>;
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
    Core: MockCore,
    mockModuleInstances,
    lastInstance: () => lastInstanceRef.value,
  };
});

// Mock @babel/register
vi.mock('@babel/register', () => ({}));

// Mock polyfills
vi.mock('../../src/components/polyfills', () => ({}));

// Import Blok after mocks are set up
import { Blok } from '../../src/blok';

describe('Blok', () => {
  // Get mocked instances
  const mocks = {
    mockModuleInstances: undefined as Partial<BlokModules> | undefined,
    mockIsObject: undefined as ReturnType<typeof vi.fn> | undefined,
    mockIsFunction: undefined as ReturnType<typeof vi.fn> | undefined,
    mockDestroyTooltip: undefined as ReturnType<typeof vi.fn> | undefined,
  };

  beforeEach(async () => {
    // Import the mocked modules to access the mock instances
    const coreModule = await import('../../src/components/core') as {
      Core: new (...args: unknown[]) => Core;
      mockModuleInstances?: Partial<BlokModules>;
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

    mocks.mockModuleInstances = coreModule.mockModuleInstances as Partial<BlokModules>;
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

    mocks.mockModuleInstances.API = {
      methods: {
        blocks: {
          clear: vi.fn(),
          render: vi.fn(),
        } as unknown as BlokModules['API']['methods']['blocks'],
        caret: {
          focus: vi.fn(),
        } as unknown as BlokModules['API']['methods']['caret'],
        events: {
          on: vi.fn(),
          off: vi.fn(),
          emit: vi.fn(),
        },
        saver: {
          save: vi.fn(),
        },
        rectangleSelection: {
          cancelActiveSelection: vi.fn(),
          isRectActivated: vi.fn(),
          clearSelection: vi.fn(),
          startSelection: vi.fn(),
          endSelection: vi.fn(),
        },
      } as unknown as BlokModules['API']['methods'],
    } as unknown as BlokModules['API'];
    mocks.mockModuleInstances.EventsAPI = {
      methods: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      },
    } as unknown as BlokModules['EventsAPI'];
    mocks.mockModuleInstances.Toolbar = {
      blockSettings: undefined,
      inlineToolbar: undefined,
    } as unknown as BlokModules['Toolbar'];
    mocks.mockModuleInstances.BlockSettings = {} as unknown as BlokModules['BlockSettings'];
    mocks.mockModuleInstances.InlineToolbar = {} as unknown as BlokModules['InlineToolbar'];
    mocks.mockModuleInstances.RectangleSelection = {
      cancelActiveSelection: vi.fn(),
      isRectActivated: vi.fn(),
      clearSelection: vi.fn(),
      startSelection: vi.fn(),
      endSelection: vi.fn(),
    } as unknown as BlokModules['RectangleSelection'];
    mocks.mockModuleInstances.ThemeManager = {
      getMode: vi.fn().mockReturnValue('auto'),
      setMode: vi.fn(),
      getResolved: vi.fn().mockReturnValue('light'),
    } as unknown as BlokModules['ThemeManager'];
    mocks.mockModuleInstances.ThemeAPI = {
      methods: {
        get: vi.fn().mockReturnValue('auto'),
        set: vi.fn(),
        getResolved: vi.fn().mockReturnValue('light'),
      },
    } as unknown as BlokModules['ThemeAPI'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with no configuration', async () => {
      const blok = new Blok();

      expect(blok.isReady).toBeInstanceOf(Promise);
      expect(blok.destroy).toBeDefined();
      expect(typeof blok.destroy).toBe('function');

      await blok.isReady;
    });

    it('should initialize with string configuration (holder)', async () => {
      const holder = 'my-blok';

      const blok = new Blok(holder);

      expect(blok.isReady).toBeInstanceOf(Promise);

      await blok.isReady;
    });

    it('should initialize with BlokConfig object', async () => {
      const config: BlokConfig = {
        holder: 'blok',
        placeholder: 'Start typing...',
      };

      const blok = new Blok(config);

      expect(blok.isReady).toBeInstanceOf(Promise);

      await blok.isReady;
    });

    it('should call onReady callback when provided', async () => {
      const onReady = vi.fn();
      const config: BlokConfig = {
        holder: 'blok',
        onReady,
      };

      if (mocks.mockIsObject) {
        mocks.mockIsObject.mockReturnValue(true);
      }
      if (mocks.mockIsFunction) {
        mocks.mockIsFunction.mockReturnValue(true);
      }

      const blok = new Blok(config);

      await blok.isReady;

      // Verify onReady was called and API is fully exported
      expect(onReady).toHaveBeenCalledTimes(1);
      expect(typeof blok.destroy).toBe('function');
    });

    it('should use default empty onReady function when not provided', async () => {
      const config: BlokConfig = {
        holder: 'blok',
      };

      if (mocks.mockIsObject) {
        mocks.mockIsObject.mockReturnValue(true);
      }
      if (mocks.mockIsFunction) {
        mocks.mockIsFunction.mockReturnValue(false);
      }

      const blok = new Blok(config);

      await blok.isReady;

      // Should not throw
      expect(blok.isReady).toBeInstanceOf(Promise);
    });

    it('should initialize destroy as no-op before exportAPI', () => {
      const blok = new Blok();

      // Before isReady resolves, destroy should be a no-op
      expect(blok.destroy).toBeDefined();
      expect(() => blok.destroy()).not.toThrow();
    });
  });

  describe('isReady promise', () => {
    it('should resolve when Core is ready', async () => {
      const blok = new Blok();

      await expect(blok.isReady).resolves.toBeUndefined();
    });

    it('should call exportAPI when Core is ready', async () => {
      const blok = new Blok();
      const exportAPISpy = vi.spyOn(blok, 'exportAPI');

      await blok.isReady;

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
      const config: BlokConfig = {
        holder: 'blok',
        placeholder: 'Test placeholder',
      };

      const blok = new Blok(config);

      await blok.isReady;

      expect((blok as unknown as Record<string, unknown>).configuration).toEqual(config);
    });

    it('should set prototype to API methods', async () => {
      const blok = new Blok();

      await blok.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        Core: new (...args: unknown[]) => Core;
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();

      expect(Object.getPrototypeOf(blok)).toBe(lastCall?.moduleInstances.API?.methods);
    });

    it('should create module aliases', async () => {
      const blok = new Blok();

      await blok.isReady;

      const moduleAliases = (blok as unknown as { module: Record<string, unknown> }).module;

      expect(moduleAliases).toBeDefined();
      expect(typeof moduleAliases).toBe('object');
    });

    it('should create lowercase aliases for uppercase module names', async () => {
      const blok = new Blok();

      await blok.isReady;

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
      } as BlokModules['API'];
      instances.Toolbar = {} as BlokModules['Toolbar'];

      const moduleAliases = (blok as unknown as { module: Record<string, unknown> }).module;

      // API should become 'api'
      expect(moduleAliases.api).toBe(instances.API);
      // Toolbar should become 'toolbar'
      expect(moduleAliases.toolbar).toBe(instances.Toolbar);
    });

    it('should create camelCase aliases for PascalCase module names', async () => {
      const blok = new Blok();

      await blok.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      instances.BlockSettings = {} as BlokModules['BlockSettings'];
      instances.InlineToolbar = {} as BlokModules['InlineToolbar'];

      const moduleAliases = (blok as unknown as { module: Record<string, unknown> }).module;

      expect(moduleAliases.blockSettings).toBe(instances.BlockSettings);
      expect(moduleAliases.inlineToolbar).toBe(instances.InlineToolbar);
    });

    it('should skip undefined module instances', async () => {
      const blok = new Blok();

      await blok.isReady;

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
      } as BlokModules['API'];
      instances.Toolbar = undefined as unknown as BlokModules['Toolbar'];

      const moduleAliases = (blok as unknown as { module: Record<string, unknown> }).module;

      expect(moduleAliases.toolbar).toBeUndefined();
    });

    it('should attach blockSettings to toolbar module if not already present', async () => {
      const mockToolbar = {
        blockSettings: undefined,
      };
      const blok = new Blok();

      await blok.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      instances.Toolbar = mockToolbar as unknown as BlokModules['Toolbar'];
      instances.BlockSettings = {} as unknown as BlokModules['BlockSettings'];

      // Re-export API to apply the changes
      (blok as unknown as { exportAPI: (core: Core) => void }).exportAPI(lastCall);

      expect(mockToolbar.blockSettings).toBe(instances.BlockSettings);
    });

    it('should not override existing blockSettings on toolbar module', async () => {
      const existingBlockSettings = { existing: true };
      const mockToolbar = {
        blockSettings: existingBlockSettings,
      };
      const blok = new Blok();

      await blok.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      instances.Toolbar = mockToolbar as unknown as BlokModules['Toolbar'];
      instances.BlockSettings = {} as unknown as BlokModules['BlockSettings'];

      // Re-export API to apply the changes
      (blok as unknown as { exportAPI: (core: Core) => void }).exportAPI(lastCall);

      expect(mockToolbar.blockSettings).toBe(existingBlockSettings);
      expect(mockToolbar.blockSettings).not.toBe(instances.BlockSettings);
    });

    it('should attach inlineToolbar to toolbar module if not already present', async () => {
      const mockToolbar = {
        inlineToolbar: undefined,
      };
      const blok = new Blok();

      await blok.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      instances.Toolbar = mockToolbar as unknown as BlokModules['Toolbar'];
      instances.InlineToolbar = {} as unknown as BlokModules['InlineToolbar'];

      // Re-export API to apply the changes
      (blok as unknown as { exportAPI: (core: Core) => void }).exportAPI(lastCall);

      expect(mockToolbar.inlineToolbar).toBe(instances.InlineToolbar);
    });

    it('should not override existing inlineToolbar on toolbar module', async () => {
      const existingInlineToolbar = { existing: true };
      const mockToolbar = {
        inlineToolbar: existingInlineToolbar,
      };
      const blok = new Blok();

      await blok.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      instances.Toolbar = mockToolbar as unknown as BlokModules['Toolbar'];
      instances.InlineToolbar = {} as unknown as BlokModules['InlineToolbar'];

      // Re-export API to apply the changes
      (blok as unknown as { exportAPI: (core: Core) => void }).exportAPI(lastCall);

      expect(mockToolbar.inlineToolbar).toBe(existingInlineToolbar);
      expect(mockToolbar.inlineToolbar).not.toBe(instances.InlineToolbar);
    });

    it('should create shorthands for blocks methods', async () => {
      const blok = new Blok();

      await blok.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      expect((blok as unknown as { clear: unknown }).clear).toBe(instances.API?.methods.blocks.clear);
      expect((blok as unknown as { render: unknown }).render).toBe(instances.API?.methods.blocks.render);
    });

    it('should create shorthands for caret methods', async () => {
      const blok = new Blok();

      await blok.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      expect((blok as unknown as { focus: unknown }).focus).toBe(instances.API?.methods.caret.focus);
    });

    it('should create shorthands for events methods', async () => {
      const blok = new Blok();

      await blok.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      expect((blok as unknown as { on: unknown }).on).toBe(instances.API?.methods.events.on);
      expect((blok as unknown as { off: unknown }).off).toBe(instances.API?.methods.events.off);
      expect((blok as unknown as { emit: unknown }).emit).toBe(instances.API?.methods.events.emit);
    });

    it('should create shorthands for saver methods', async () => {
      const blok = new Blok();

      await blok.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      expect((blok as unknown as { save: unknown }).save).toBe(instances.API?.methods.saver.save);
    });

    it('should delete exportAPI method after export', async () => {
      const blok = new Blok();

      await blok.isReady;

      expect(Object.prototype.hasOwnProperty.call(blok, 'exportAPI')).toBe(false);
      expect(typeof (blok as unknown as { exportAPI: unknown }).exportAPI).toBe('function');
    });

    it('should make module property non-enumerable', async () => {
      const blok = new Blok();

      await blok.isReady;

      const descriptor = Object.getOwnPropertyDescriptor(blok, 'module');

      expect(descriptor).toBeDefined();
      expect(descriptor?.enumerable).toBe(false);
      expect(descriptor?.configurable).toBe(true);
      expect(descriptor?.writable).toBe(false);
    });
  });

  describe('API exposure', () => {
    it('should expose rectangleSelection API', async () => {
      const holder = document.createElement('div');
      const defaultTools = {};

      const blok = new Blok({
        holder: holder,
        tools: defaultTools,
      });

      await blok.isReady;

      // Get the actual Core instance that was created
      const coreModule = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const lastCall = coreModule.lastInstance?.();
      const instances = lastCall?.moduleInstances;

      if (!instances || !lastCall) {
        throw new Error('Core instance not found');
      }

      // Access the API from the blok instance
      const api = instances.API?.methods;

      expect(api).toBeDefined();
      expect(api?.rectangleSelection).toBeDefined();
      expect(typeof api?.rectangleSelection.cancelActiveSelection).toBe('function');
      expect(typeof api?.rectangleSelection.isRectActivated).toBe('function');
      expect(typeof api?.rectangleSelection.clearSelection).toBe('function');
      expect(typeof api?.rectangleSelection.startSelection).toBe('function');
      expect(typeof api?.rectangleSelection.endSelection).toBe('function');
    });
  });

  describe('destroy', () => {
    it('should call destroy on all module instances that have destroy method', async () => {
      const mockDestroy1 = vi.fn();
      const mockDestroy2 = vi.fn();
      const mockModule1 = { destroy: mockDestroy1 };
      const mockModule2 = { destroy: mockDestroy2 };
      const mockModule3 = { noDestroy: true };

      if (mocks.mockModuleInstances) {
        mocks.mockModuleInstances.Toolbar = mockModule1 as unknown as BlokModules['Toolbar'];
        mocks.mockModuleInstances.BlockSettings = mockModule2 as unknown as BlokModules['BlockSettings'];
        mocks.mockModuleInstances.InlineToolbar = mockModule3 as unknown as BlokModules['InlineToolbar'];
      }

      const blok = new Blok();

      await blok.isReady;
      const prototypeBeforeDestroy = Object.getPrototypeOf(blok) as Record<string, unknown> | null;

      blok.destroy();

      // Verify destroy was called on modules and Blok instance is cleaned up
      expect(mockDestroy1).toHaveBeenCalledTimes(1);
      expect(mockDestroy2).toHaveBeenCalledTimes(1);
      // Verify observable outcome: prototype is null after destroy
      expect(Object.getPrototypeOf(blok)).toBeNull();
      expect(prototypeBeforeDestroy).not.toBeNull();
    });

    it('should remove all listeners from module instances', async () => {
      const mockRemoveAll = vi.fn();
      const mockModule = {
        listeners: {
          removeAll: mockRemoveAll,
        },
      };

      if (mocks.mockModuleInstances) {
        mocks.mockModuleInstances.Toolbar = mockModule as unknown as BlokModules['Toolbar'];
      }

      const blok = new Blok();

      await blok.isReady;
      blok.destroy();

      // Verify listeners were removed and Blok instance is cleaned up
      expect(mockRemoveAll).toHaveBeenCalled();
      // Verify observable outcome: prototype is null after destroy
      expect(Object.getPrototypeOf(blok)).toBeNull();
    });

    it('should call destroyTooltip', async () => {
      const blok = new Blok();

      await blok.isReady;
      blok.destroy();

      // Verify tooltip was destroyed and Blok instance is cleaned up
      expect(mocks.mockDestroyTooltip).toHaveBeenCalledTimes(1);
      // Verify observable outcome: prototype is null after destroy
      expect(Object.getPrototypeOf(blok)).toBeNull();
    });

    it('should delete all own properties', async () => {
      const blok = new Blok();

      await blok.isReady;

      // Add some test properties
      const testValue = 123;

      (blok as unknown as Record<string, unknown>).testProperty = 'test';
      (blok as unknown as Record<string, unknown>).anotherProperty = testValue;

      expect((blok as unknown as Record<string, unknown>).testProperty).toBe('test');
      expect((blok as unknown as Record<string, unknown>).anotherProperty).toBe(testValue);

      blok.destroy();

      expect((blok as unknown as Record<string, unknown>).testProperty).toBeUndefined();
      expect((blok as unknown as Record<string, unknown>).anotherProperty).toBeUndefined();
    });

    it('should set prototype to null', async () => {
      const blok = new Blok();

      await blok.isReady;

      // Before destroy, prototype should be API methods
      const apiMethods = mocks.mockModuleInstances?.API?.methods;
      if (apiMethods) {
        expect(Object.getPrototypeOf(blok)).toBe(apiMethods);
      }

      blok.destroy();

      // After destroy, prototype should be null
      expect(Object.getPrototypeOf(blok)).toBeNull();
    });

    it('should handle modules without listeners property', async () => {
      const mockModule = {
        destroy: vi.fn(),
        // No listeners property
      };

      if (mocks.mockModuleInstances) {
        mocks.mockModuleInstances.Toolbar = mockModule as unknown as BlokModules['Toolbar'];
      }

      const blok = new Blok();

      await blok.isReady;

      // Should not throw
      expect(() => blok.destroy()).not.toThrow();
    });

    it('should handle modules without destroy method', async () => {
      const mockModule = {
        listeners: {
          removeAll: vi.fn(),
        },
        // No destroy method
      };

      if (mocks.mockModuleInstances) {
        mocks.mockModuleInstances.Toolbar = mockModule as unknown as BlokModules['Toolbar'];
      }

      const blok = new Blok();

      await blok.isReady;

      // Should not throw and should complete cleanup successfully
      expect(() => blok.destroy()).not.toThrow();
      expect(mockModule.listeners.removeAll).toHaveBeenCalled();
      // Verify observable outcome: destroy still completes successfully (prototype becomes null)
      expect(Object.getPrototypeOf(blok)).toBeNull();
    });
  });

  describe('destroy before isReady', () => {
    const createDeferred = (): { promise: Promise<void>; resolve: () => void } => {
      let resolve!: () => void;
      const promise = new Promise<void>(r => { resolve = r; });

      return { promise, resolve };
    };

    it('should tear down the instance when destroy() is called before isReady resolves', async () => {
      const deferred = createDeferred();

      // Temporarily override MockCore to use a pending promise
      const coreModule = await import('../../src/components/core') as {
        Core: new (...args: unknown[]) => Core;
      };
      const OriginalMockCore = coreModule.Core;
      const deferredIsReady = deferred.promise;

      // Patch the constructor to use our deferred promise
      const PatchedCore = class extends OriginalMockCore {
        constructor(...args: unknown[]) {
          super(...args);
          this.isReady = deferredIsReady;
        }
      } as unknown as typeof coreModule.Core;

      // Replace Core temporarily
      (coreModule as Record<string, unknown>).Core = PatchedCore;

      const blok = new Blok();

      // Call destroy before isReady resolves
      blok.destroy();

      // Now resolve isReady
      deferred.resolve();
      await blok.isReady;

      // The instance should be fully torn down (prototype set to null)
      expect(Object.getPrototypeOf(blok)).toBeNull();

      // Restore original Core
      (coreModule as Record<string, unknown>).Core = OriginalMockCore;
    });

    it('should not call exportAPI when pendingDestroy is true', async () => {
      const deferred = createDeferred();

      const coreModule = await import('../../src/components/core') as {
        Core: new (...args: unknown[]) => Core;
      };
      const OriginalMockCore = coreModule.Core;
      const deferredIsReady = deferred.promise;

      const PatchedCore = class extends OriginalMockCore {
        constructor(...args: unknown[]) {
          super(...args);
          this.isReady = deferredIsReady;
        }
      } as unknown as typeof coreModule.Core;

      (coreModule as Record<string, unknown>).Core = PatchedCore;

      const blok = new Blok();
      const exportAPISpy = vi.spyOn(blok, 'exportAPI');

      // Call destroy before isReady resolves
      blok.destroy();

      // Now resolve isReady
      deferred.resolve();
      await blok.isReady;

      // exportAPI should NOT have been called since we destroyed before ready
      expect(exportAPISpy).not.toHaveBeenCalled();

      // Restore original Core
      (coreModule as Record<string, unknown>).Core = OriginalMockCore;
    });
  });

  describe('theme API availability before isReady', () => {
    const createDeferred = (): { promise: Promise<void>; resolve: () => void } => {
      let resolve!: () => void;
      const promise = new Promise<void>(r => { resolve = r; });

      return { promise, resolve };
    };

    it('should expose theme API immediately after construction, before isReady resolves', async () => {
      const deferred = createDeferred();

      const coreModule = await import('../../src/components/core') as {
        Core: new (...args: unknown[]) => Core;
      };
      const OriginalMockCore = coreModule.Core;
      const deferredIsReady = deferred.promise;

      const PatchedCore = class extends OriginalMockCore {
        constructor(...args: unknown[]) {
          super(...args);
          this.isReady = deferredIsReady;
        }
      } as unknown as typeof coreModule.Core;

      (coreModule as Record<string, unknown>).Core = PatchedCore;

      const blok = new Blok();

      // theme API should be available BEFORE isReady resolves
      const themeApi = (blok as unknown as Record<string, unknown>).theme as
        | { set: (mode: string) => void; get: () => string; getResolved: () => string }
        | undefined;

      expect(themeApi).toBeDefined();
      expect(typeof themeApi?.set).toBe('function');
      expect(typeof themeApi?.get).toBe('function');
      expect(typeof themeApi?.getResolved).toBe('function');

      // Clean up
      deferred.resolve();
      await blok.isReady;
      (coreModule as Record<string, unknown>).Core = OriginalMockCore;
    });

    it('should buffer theme set() calls made before isReady and replay after modules are ready', async () => {
      const deferred = createDeferred();

      const coreModule = await import('../../src/components/core') as {
        Core: new (...args: unknown[]) => Core;
      };
      const OriginalMockCore = coreModule.Core;
      const deferredIsReady = deferred.promise;

      // Simulate real Core behavior: moduleInstances starts empty,
      // then gets populated before isReady resolves
      const PatchedCore = class extends OriginalMockCore {
        constructor(...args: unknown[]) {
          super(...args);
          // Start with empty moduleInstances (like real Core)
          this.moduleInstances = {} as BlokModules;
          this.isReady = deferredIsReady.then(() => {
            // Populate module instances (simulating constructModules + prepare)
            const mockInstances = (coreModule as { mockModuleInstances?: Partial<BlokModules> }).mockModuleInstances;

            if (mockInstances) {
              Object.assign(this.moduleInstances, mockInstances);
            }
          });
        }
      } as unknown as typeof coreModule.Core;

      (coreModule as Record<string, unknown>).Core = PatchedCore;

      const blok = new Blok();

      // Call set() before isReady — ThemeManager doesn't exist yet
      const themeApi = (blok as unknown as Record<string, unknown>).theme as
        { set: (mode: string) => void; get: () => string };

      themeApi.set('dark');

      // get() should return the buffered value
      expect(themeApi.get()).toBe('dark');

      // Now resolve isReady — modules become available, buffer is replayed
      deferred.resolve();
      await blok.isReady;

      // ThemeManager.setMode should have been called with the buffered mode
      const lastCoreInstance = ((coreModule as { lastInstance?: () => Core | undefined }).lastInstance?.());
      const tm = lastCoreInstance?.moduleInstances.ThemeManager;

      expect(tm?.setMode).toHaveBeenCalledWith('dark');

      // Restore original Core
      (coreModule as Record<string, unknown>).Core = OriginalMockCore;
    });

    it('should still have theme API after isReady resolves', async () => {
      const blok = new Blok();

      await blok.isReady;

      const themeApi = (blok as unknown as Record<string, unknown>).theme as
        | { set: (mode: string) => void; get: () => string; getResolved: () => string }
        | undefined;

      expect(themeApi).toBeDefined();
      expect(typeof themeApi?.set).toBe('function');
    });

    it('should return "auto" from get() and "light" from getResolved() before any set() call', async () => {
      const deferred = createDeferred();

      const coreModule = await import('../../src/components/core') as {
        Core: new (...args: unknown[]) => Core;
      };
      const OriginalMockCore = coreModule.Core;
      const deferredIsReady = deferred.promise;

      const PatchedCore = class extends OriginalMockCore {
        constructor(...args: unknown[]) {
          super(...args);
          this.moduleInstances = {} as BlokModules;
          this.isReady = deferredIsReady.then(() => {
            const mockInstances = (coreModule as { mockModuleInstances?: Partial<BlokModules> }).mockModuleInstances;

            if (mockInstances) {
              Object.assign(this.moduleInstances, mockInstances);
            }
          });
        }
      } as unknown as typeof coreModule.Core;

      (coreModule as Record<string, unknown>).Core = PatchedCore;

      const blok = new Blok();

      const themeApi = (blok as unknown as Record<string, unknown>).theme as
        { get: () => string; getResolved: () => string };

      // Before any set() call, get() should default to 'auto'
      expect(themeApi.get()).toBe('auto');

      // Before isReady, getResolved() should default to 'light'
      expect(themeApi.getResolved()).toBe('light');

      deferred.resolve();
      await blok.isReady;
      (coreModule as Record<string, unknown>).Core = OriginalMockCore;
    });

    it('should replay only the last buffered set() call when multiple are made before isReady', async () => {
      const deferred = createDeferred();

      const coreModule = await import('../../src/components/core') as {
        Core: new (...args: unknown[]) => Core;
        lastInstance?: () => Core | undefined;
      };
      const OriginalMockCore = coreModule.Core;
      const deferredIsReady = deferred.promise;

      const PatchedCore = class extends OriginalMockCore {
        constructor(...args: unknown[]) {
          super(...args);
          this.moduleInstances = {} as BlokModules;
          this.isReady = deferredIsReady.then(() => {
            const mockInstances = (coreModule as { mockModuleInstances?: Partial<BlokModules> }).mockModuleInstances;

            if (mockInstances) {
              Object.assign(this.moduleInstances, mockInstances);
            }
          });
        }
      } as unknown as typeof coreModule.Core;

      (coreModule as Record<string, unknown>).Core = PatchedCore;

      const blok = new Blok();

      const themeApi = (blok as unknown as Record<string, unknown>).theme as
        { set: (mode: string) => void; get: () => string };

      // Multiple set() calls before isReady — only the last should be replayed
      themeApi.set('dark');
      expect(themeApi.get()).toBe('dark');

      themeApi.set('light');
      expect(themeApi.get()).toBe('light');

      themeApi.set('auto');
      expect(themeApi.get()).toBe('auto');

      deferred.resolve();
      await blok.isReady;

      const lastCoreInstance = coreModule.lastInstance?.();
      const tm = lastCoreInstance?.moduleInstances.ThemeManager;

      // setMode should have been called exactly once with the last buffered value
      expect(tm?.setMode).toHaveBeenCalledTimes(1);
      expect(tm?.setMode).toHaveBeenCalledWith('auto');

      (coreModule as Record<string, unknown>).Core = OriginalMockCore;
    });

    it('should delegate to ThemeManager after isReady resolves', async () => {
      const blok = new Blok();

      await blok.isReady;

      const themeApi = (blok as unknown as Record<string, unknown>).theme as
        { set: (mode: string) => void };

      themeApi.set('dark');

      const coreModuleForInstance = await import('../../src/components/core') as {
        lastInstance?: () => Core | undefined;
      };
      const instance = coreModuleForInstance.lastInstance?.();

      expect(instance?.moduleInstances.ThemeManager?.setMode).toHaveBeenCalledWith('dark');
    });
  });

  describe('static version', () => {
    it('should expose version as static property', () => {
      expect(Blok.version).toBeDefined();
      expect(typeof Blok.version).toBe('string');
    });
  });
});


import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BlokConfig } from '../../../types';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import { CriticalError } from '../../../src/components/errors/critical';

const mockRegistry = vi.hoisted(() => ({
  dom: {
    get: vi.fn(),
    isElement: vi.fn(),
  },
  utils: {
    isObject: vi.fn(),
    isString: vi.fn(),
    isEmpty: vi.fn(),
    setLogLevel: vi.fn(),
    log: vi.fn(),
  },
  modules: {
    i18nSetDictionary: vi.fn(),
    i18nPrepare: vi.fn(() => Promise.resolve()),
    toolsPrepare: vi.fn(),
    uiPrepare: vi.fn(),
    uiCheckEmptiness: vi.fn(),
    blockManagerPrepare: vi.fn(),
    pastePrepare: vi.fn(),
    blockSelectionPrepare: vi.fn(),
    rectangleSelectionPrepare: vi.fn(),
    crossBlockSelectionPrepare: vi.fn(),
    readOnlyPrepare: vi.fn(),
    rendererPrepare: vi.fn(),
    rendererRender: vi.fn(() => Promise.resolve()),
    modificationsObserverPrepare: vi.fn(),
    modificationsObserverEnable: vi.fn(),
    caretPrepare: vi.fn(),
    caretSetToBlock: vi.fn(),
  },
}));

vi.mock('../../../src/components/dom', () => ({
  __esModule: true,
  Dom: {
    get: mockRegistry.dom.get,
    isElement: mockRegistry.dom.isElement,
  },
}));

vi.mock('../../../src/components/utils', () => ({
  __esModule: true,
  isObject: mockRegistry.utils.isObject,
  isString: mockRegistry.utils.isString,
  isEmpty: mockRegistry.utils.isEmpty,
  setLogLevel: mockRegistry.utils.setLogLevel,
  log: mockRegistry.utils.log,
  LogLevels: {
    VERBOSE: 'VERBOSE',
    INFO: 'INFO',
  },
}));

// I18n is now an instance-based module registered in modules list, not a static class

vi.mock('../../../src/components/modules', () => {
  /**
   * Minimal I18n module stub used in Core tests.
   */
  class MockI18n {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.i18nPrepare;
    public setDictionary = mockRegistry.modules.i18nSetDictionary;
    public t = vi.fn((key: string) => key);
    public has = vi.fn(() => false);
  }

  /**
   * Minimal Tools module stub used in Core tests.
   */
  class MockTools {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.toolsPrepare;
  }

  /**
   * Minimal UI module stub used in Core tests.
   */
  class MockUI {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.uiPrepare;
    public checkEmptiness = mockRegistry.modules.uiCheckEmptiness;
  }

  /**
   * Minimal BlockManager module stub used in Core tests.
   */
  class MockBlockManager {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.blockManagerPrepare;
    public blocks = [ { id: 'block-1' } ];
  }

  /**
   * Minimal Paste module stub used in Core tests.
   */
  class MockPaste {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.pastePrepare;
  }

  /**
   * Minimal BlockSelection module stub used in Core tests.
   */
  class MockBlockSelection {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.blockSelectionPrepare;
  }

  /**
   * Minimal RectangleSelection module stub used in Core tests.
   */
  class MockRectangleSelection {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.rectangleSelectionPrepare;
  }

  /**
   * Minimal CrossBlockSelection module stub used in Core tests.
   */
  class MockCrossBlockSelection {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.crossBlockSelectionPrepare;
  }

  /**
   * Minimal ReadOnly module stub used in Core tests.
   */
  class MockReadOnly {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.readOnlyPrepare;
  }

  /**
   * Minimal Renderer module stub used in Core tests.
   */
  class MockRenderer {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.rendererPrepare;
    public render = mockRegistry.modules.rendererRender;
  }

  /**
   * Minimal ModificationsObserver module stub used in Core tests.
   */
  class MockModificationsObserver {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.modificationsObserverPrepare;
    public enable = mockRegistry.modules.modificationsObserverEnable;
  }

  /**
   * Minimal Caret module stub used in Core tests.
   */
  class MockCaret {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.caretPrepare;
    public setToBlock = mockRegistry.modules.caretSetToBlock;

    /**
     * Provides the caret positions map required by Core.
     */
    public get positions(): { START: string } {
      return {
        START: 'start',
      };
    }
  }

  return {
    __esModule: true,
    Modules: {
      I18n: MockI18n,
      Tools: MockTools,
      UI: MockUI,
      BlockManager: MockBlockManager,
      Paste: MockPaste,
      BlockSelection: MockBlockSelection,
      RectangleSelection: MockRectangleSelection,
      CrossBlockSelection: MockCrossBlockSelection,
      ReadOnly: MockReadOnly,
      Renderer: MockRenderer,
      ModificationsObserver: MockModificationsObserver,
      Caret: MockCaret,
    },
  };
});

const { dom, utils, modules: moduleMocks } = mockRegistry;
const { get: mockDomGet, isElement: mockDomIsElement } = dom;
const {
  isObject: mockIsObject,
  isString: mockIsString,
  isEmpty: mockIsEmpty,
  log: mockLog,
} = utils;
const {
  uiCheckEmptiness: mockUICheckEmptiness,
  pastePrepare: mockPastePrepare,
  readOnlyPrepare: mockReadOnlyPrepare,
  rendererRender: mockRendererRender,
  modificationsObserverEnable: mockModificationsObserverEnable,
  caretSetToBlock: mockCaretSetToBlock,
} = moduleMocks;

// Import Core after mocks are configured
import { Core } from '../../../src/components/core';

const createReadyCore = async (config?: BlokConfig | string): Promise<Core> => {
  const core = new Core(config);

  await core.isReady;

  return core;
};

describe('Core', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockDomIsElement.mockReturnValue(true);
    mockDomGet.mockImplementation((id: string) => ({ id }));

    mockIsObject.mockImplementation(
      (value: unknown): value is Record<string, unknown> =>
        typeof value === 'object' && value !== null && !Array.isArray(value)
    );
    mockIsString.mockImplementation((value: unknown): value is string => typeof value === 'string');
    mockIsEmpty.mockImplementation((value: unknown): boolean => {
      if (value == null) {
        return true;
      }

      if (Array.isArray(value)) {
        return value.length === 0;
      }

      if (typeof value === 'object') {
        return Object.keys(value).length === 0;
      }

      return false;
    });

    mockRendererRender.mockResolvedValue(undefined);
  });

  describe('configuration', () => {
    it('retains provided data and i18n configuration', async () => {
      const config: BlokConfig = {
        holder: 'holder',
        defaultBlock: 'header',
        data: {
          blocks: [
            {
              id: '1',
              type: 'quote',
              data: { text: 'Hello' },
            },
          ],
        },
        i18n: {
          direction: 'rtl',
          messages: {
            'toolNames.text': 'Paragraph',
          },
        },
      };

      const core = await createReadyCore(config);

      expect(core.configuration.defaultBlock).toBe('header');
      expect(core.configuration.data).toEqual(config.data);
      expect(core.configuration.i18n?.direction).toBe('rtl');
      expect(core.configuration.i18n?.messages).toEqual({ 'toolNames.text': 'Paragraph' });
    });

    it('does not synthesize an onChange handler when the host configured none', async () => {
      /**
       * The PRESENCE of `onChange`/`onSave` is the arming signal for the whole
       * change-observation pipeline (`ModificationsObserver.particularBlockChanged`
       * bails when neither is a function), and all three framework adapters go out
       * of their way to omit the key when their host passes no handler.
       *
       * Defaulting `onChange` to a no-op here would silently satisfy that gate for
       * EVERY editor, turning the gate into dead code and making the published
       * contract on `BlokConfig.onChange` a lie — which is exactly what pushes
       * hosts into passing an always-truthy dummy handler "to arm the pipeline".
       */
      const core = await createReadyCore({ holder: 'holder' });

      expect(core.configuration.onChange).toBeUndefined();
    });

    // `server` must be gone by the time anything downstream reads the config —
    // no module is allowed to learn the key exists.
    it('expands the server shorthand into the options that already exist', async () => {
      const core = await createReadyCore({ holder: 'holder', server: 'https://blok.example.com/' });
      const bookmark = core.configuration.tools?.bookmark;
      const bookmarkConfig = typeof bookmark === 'object' && bookmark !== null && 'config' in bookmark
        ? bookmark.config
        : undefined;

      expect(core.configuration.uploader?.uploadByFile).toBeTypeOf('function');
      expect(bookmarkConfig?.endpoint).toBe('https://blok.example.com/unfurl');
    });
  });

  describe('validate', () => {
    it('throws when holder element is missing', async () => {
      const core = await createReadyCore();

      mockDomGet.mockImplementation((id: string) => {
        if (id === 'missing') {
          return undefined;
        }

        return { id };
      });

      core.configuration = {
        holder: 'missing',
      };

      expect(() => core.validate()).toThrow('element with ID «missing» is missing. Pass correct holder\'s ID.');
    });

    it('throws when holder is not a DOM element', async () => {
      const core = await createReadyCore();

      mockDomIsElement.mockReturnValue(false);

      core.configuration = {
        holder: {} as unknown as HTMLElement,
      };

      expect(() => core.validate()).toThrow('«holder» value must be an Element node');
    });
  });

  describe('modules initialization', () => {
    it('constructs modules and provides state without self references', async () => {
      const core = await createReadyCore();
      const { moduleInstances } = core;

      expect(moduleInstances.Tools).toBeDefined();
      expect(moduleInstances.UI).toBeDefined();

      const toolsState = moduleInstances.Tools.state as Partial<BlokModules>;

      expect(toolsState.Tools).toBeUndefined();
      expect(toolsState.UI).toBe(moduleInstances.UI);
      expect(toolsState.BlockManager).toBe(moduleInstances.BlockManager);
    });
  });

  describe('start', () => {
    it('prepares all required modules', async () => {
      const core = await createReadyCore();

      // Verify observable outcome: modules are initialized and ready
      expect(core.moduleInstances.Tools).toBeDefined();
      expect(core.moduleInstances.UI).toBeDefined();
      expect(core.moduleInstances.BlockManager).toBeDefined();
      expect(core.moduleInstances.Paste).toBeDefined();
      expect(core.moduleInstances.BlockSelection).toBeDefined();
      expect(core.moduleInstances.RectangleSelection).toBeDefined();
      expect(core.moduleInstances.CrossBlockSelection).toBeDefined();
      expect(core.moduleInstances.ReadOnly).toBeDefined();
    });

    it('logs warning when non-critical module fails to prepare', async () => {
      const core = await createReadyCore();
      const nonCriticalError = new Error('skip me');

      mockPastePrepare.mockImplementationOnce(() => {
        throw nonCriticalError;
      });

      await expect(core.start()).resolves.toBeUndefined();
      expect(mockLog).toHaveBeenCalledWith('Module Paste was skipped because of %o', 'warn', nonCriticalError);
    });

    it('rethrows when a module fails with CriticalError', async () => {
      const core = await createReadyCore();

      mockReadOnlyPrepare.mockImplementationOnce(() => {
        throw new CriticalError('read-only failure');
      });

      await expect(core.start()).rejects.toThrow('read-only failure');
    });
  });

  describe('persistence', () => {
    const SAVED = {
      blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'saved' } }],
    };

    it('renders the persisted document instead of the default block', async () => {
      const load = vi.fn().mockResolvedValue(SAVED);
      const core = await createReadyCore({
        holder: 'holder',
        persistence: { load, save: async (): Promise<void> => {} },
      });

      expect(load).toHaveBeenCalledTimes(1);
      expect(core.configuration.data?.blocks).toEqual([expect.objectContaining({ data: { text: 'saved' } })]);
      expect(mockRendererRender).toHaveBeenCalledWith([expect.objectContaining({ data: { text: 'saved' } })]);
    });

    // Data the host passed is theirs and wins; loading over it would discard it.
    it('does not load when the host supplied data', async () => {
      const load = vi.fn().mockResolvedValue(SAVED);

      await createReadyCore({
        holder: 'holder',
        data: { blocks: [{ id: 'h1', type: 'paragraph', data: { text: 'host' } }] },
        persistence: { load, save: async (): Promise<void> => {} },
      });

      expect(load).not.toHaveBeenCalled();
    });

    // A failed load must NOT degrade to an empty document: one keystroke later
    // autosave would write that emptiness over the user's real document.
    it('fails the boot when the document cannot be loaded', async () => {
      const core = new Core({
        holder: 'holder',
        persistence: {
          load: async (): Promise<null> => {
            throw new Error('offline');
          },
          save: async (): Promise<void> => {},
        },
      });

      await expect(core.isReady).rejects.toThrow('offline');
    });

    it('falls back to the default block when nothing is saved yet', async () => {
      const core = await createReadyCore({
        holder: 'holder',
        persistence: { load: async (): Promise<null> => null, save: async (): Promise<void> => {} },
      });

      expect(core.configuration.data?.blocks).toHaveLength(1);
      expect(core.configuration.data?.blocks[0]?.type).toBe('paragraph');
    });
  });

  describe('render', () => {
    it('invokes renderer with current blocks', async () => {
      const core = await createReadyCore();
      const render = (core as unknown as { render: () => Promise<void> }).render.bind(core);

      await render();

      expect(mockRendererRender).toHaveBeenLastCalledWith(core.configuration.data?.blocks);
    });

    it('throws when renderer module is missing', async () => {
      const core = await createReadyCore();
      const render = (core as unknown as { render: () => Promise<void> }).render.bind(core);

      // Simulate missing renderer module by accessing it through undefined
      const originalRenderer = core.moduleInstances.Renderer;
      (core.moduleInstances as Partial<BlokModules>).Renderer = undefined;

      expect(() => render()).toThrow('Renderer module is not initialized');

      // Restore for other tests
      (core.moduleInstances).Renderer = originalRenderer;
    });

    it('throws when blok data is missing', async () => {
      const core = await createReadyCore();
      const render = (core as unknown as { render: () => Promise<void> }).render.bind(core);

      (core.configuration).data = undefined;

      expect(() => render()).toThrow('Blok data is not initialized');
    });
  });

  describe('ready workflow', () => {
    it('checks UI, enables observer and moves caret on autofocus', async () => {
      const config: BlokConfig = {
        holder: 'holder',
        autofocus: true,
        data: {
          blocks: [
            {
              id: 'custom',
              type: 'paragraph',
              data: {},
            },
          ],
        },
      };

      const core = await createReadyCore(config);

      expect(mockUICheckEmptiness).toHaveBeenCalledTimes(1);
      expect(mockModificationsObserverEnable).toHaveBeenCalledTimes(1);
      expect(mockCaretSetToBlock).toHaveBeenCalledWith(
        core.moduleInstances.BlockManager.blocks[0],
        'start'
      );
    });
  });
});


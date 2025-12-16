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
  i18n: {
    setDictionary: vi.fn(),
    resolveLocale: vi.fn(() => ({ locale: 'en', dictionary: {}, direction: 'ltr' })),
  },
  modules: {
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
    historyPrepare: vi.fn(),
    historyCaptureInitialState: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../../../src/components/dom', () => ({
  __esModule: true,
  default: {
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

vi.mock('../../../src/components/i18n', () => ({
  __esModule: true,
  default: {
    setDictionary: mockRegistry.i18n.setDictionary,
    resolveLocale: mockRegistry.i18n.resolveLocale,
  },
}));

vi.mock('../../../src/components/modules', () => {
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

  /**
   * Minimal History module stub used in Core tests.
   */
  class MockHistory {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.historyPrepare;
    public captureInitialState = mockRegistry.modules.historyCaptureInitialState;
  }

  return {
    __esModule: true,
    default: {
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
      History: MockHistory,
    },
  };
});

const { dom, utils, i18n, modules: moduleMocks } = mockRegistry;
const { get: mockDomGet, isElement: mockDomIsElement } = dom;
const {
  isObject: mockIsObject,
  isString: mockIsString,
  isEmpty: mockIsEmpty,
  log: mockLog,
} = utils;
const { setDictionary: mockSetDictionary } = i18n;
const {
  toolsPrepare: mockToolsPrepare,
  uiPrepare: mockUIPrepare,
  uiCheckEmptiness: mockUICheckEmptiness,
  blockManagerPrepare: mockBlockManagerPrepare,
  pastePrepare: mockPastePrepare,
  blockSelectionPrepare: mockBlockSelectionPrepare,
  rectangleSelectionPrepare: mockRectangleSelectionPrepare,
  crossBlockSelectionPrepare: mockCrossBlockSelectionPrepare,
  readOnlyPrepare: mockReadOnlyPrepare,
  rendererRender: mockRendererRender,
  modificationsObserverEnable: mockModificationsObserverEnable,
  caretSetToBlock: mockCaretSetToBlock,
  historyPrepare: mockHistoryPrepare,
  historyCaptureInitialState: mockHistoryCaptureInitialState,
} = moduleMocks;

// Import Core after mocks are configured
import Core from '../../../src/components/core';

const createReadyCore = async (config?: BlokConfig | string): Promise<Core> => {
  const core = new Core(config);

  await core.isReady;

  return core;
};

describe('Core', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockDomIsElement.mockReturnValue(true);
    mockDomGet.mockImplementation((id: string) => ({ id }) as unknown as HTMLElement);

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
    it('retains provided data and applies i18n dictionary', async () => {
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
            'toolNames.paragraph': 'Paragraph',
          },
        },
      };

      const core = await createReadyCore(config);

      expect(core.configuration.defaultBlock).toBe('header');
      expect(core.configuration.data).toEqual(config.data);
      expect(core.configuration.i18n?.direction).toBe('rtl');
      expect(mockSetDictionary).toHaveBeenCalledWith(config.i18n?.messages);
    });
  });

  describe('validate', () => {
    it('throws when holder element is missing', async () => {
      const core = await createReadyCore();

      mockDomGet.mockImplementation((id: string) => {
        if (id === 'missing') {
          return undefined;
        }

        return { id } as unknown as HTMLElement;
      });

      core.configuration = {
        holder: 'missing',
      } as BlokConfig;

      expect(() => core.validate()).toThrow('element with ID «missing» is missing. Pass correct holder\'s ID.');
    });

    it('throws when holder is not a DOM element', async () => {
      const core = await createReadyCore();

      mockDomIsElement.mockReturnValue(false);

      core.configuration = {
        holder: {} as unknown as HTMLElement,
      } as BlokConfig;

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
      await createReadyCore();

      expect(mockToolsPrepare).toHaveBeenCalled();
      expect(mockUIPrepare).toHaveBeenCalled();
      expect(mockBlockManagerPrepare).toHaveBeenCalled();
      expect(mockPastePrepare).toHaveBeenCalled();
      expect(mockBlockSelectionPrepare).toHaveBeenCalled();
      expect(mockRectangleSelectionPrepare).toHaveBeenCalled();
      expect(mockCrossBlockSelectionPrepare).toHaveBeenCalled();
      expect(mockReadOnlyPrepare).toHaveBeenCalled();
      expect(mockHistoryPrepare).toHaveBeenCalled();
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

      delete (core.moduleInstances as Partial<BlokModules>).Renderer;

      expect(() => render()).toThrow('Renderer module is not initialized');
    });

    it('throws when blok data is missing', async () => {
      const core = await createReadyCore();
      const render = (core as unknown as { render: () => Promise<void> }).render.bind(core);

      (core.configuration as BlokConfig).data = undefined;

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
      expect(mockHistoryCaptureInitialState).toHaveBeenCalledTimes(1);
      expect(mockCaretSetToBlock).toHaveBeenCalledWith(
        core.moduleInstances.BlockManager.blocks[0],
        'start'
      );
    });
  });
});


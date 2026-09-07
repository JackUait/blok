import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BlokConfig } from '../../../types';
import type { BlokModules } from '../../../src/types-internal/blok-modules';

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

vi.mock('../../../src/components/modules', () => {
  /**
   * Minimal I18n module stub.
   */
  class MockI18n {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.i18nPrepare;
    public setDictionary = mockRegistry.modules.i18nSetDictionary;
    public t = vi.fn((key: string) => key);
    public has = vi.fn(() => false);
  }

  /**
   * Minimal Tools module stub.
   */
  class MockTools {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.toolsPrepare;
  }

  /**
   * Minimal UI module stub.
   */
  class MockUI {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.uiPrepare;
    public checkEmptiness = mockRegistry.modules.uiCheckEmptiness;
  }

  /**
   * Minimal BlockManager module stub.
   */
  class MockBlockManager {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.blockManagerPrepare;
    public blocks = [ { id: 'block-1' } ];
  }

  /**
   * Minimal Paste module stub.
   */
  class MockPaste {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.pastePrepare;
  }

  /**
   * Minimal BlockSelection module stub.
   */
  class MockBlockSelection {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.blockSelectionPrepare;
  }

  /**
   * Minimal RectangleSelection module stub.
   */
  class MockRectangleSelection {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.rectangleSelectionPrepare;
  }

  /**
   * Minimal CrossBlockSelection module stub.
   */
  class MockCrossBlockSelection {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.crossBlockSelectionPrepare;
  }

  /**
   * Minimal ReadOnly module stub.
   */
  class MockReadOnly {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.readOnlyPrepare;
  }

  /**
   * Minimal Renderer module stub.
   */
  class MockRenderer {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.rendererPrepare;
    public render = mockRegistry.modules.rendererRender;
  }

  /**
   * Minimal ModificationsObserver module stub.
   */
  class MockModificationsObserver {
    public state?: BlokModules;
    public prepare = mockRegistry.modules.modificationsObserverPrepare;
    public enable = mockRegistry.modules.modificationsObserverEnable;
  }

  /**
   * Minimal Caret module stub.
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
const { rendererRender: mockRendererRender } = moduleMocks;

// Import Core after mocks are configured
import { Core } from '../../../src/components/core';

const createReadyCore = async (config?: BlokConfig | string): Promise<Core> => {
  const core = new Core(config);

  await core.isReady;

  return core;
};

const noopSave = async (): Promise<void> => {};

/** Every `log(msg, 'warn')` call the boot made, as plain message strings. */
const warnings = (): string[] =>
  mockLog.mock.calls
    .filter((call) => call[1] === 'warn')
    .map((call) => String(call[0]));

const skipWarnings = (): string[] =>
  warnings().filter((message) => message.includes('persistence.load'));

describe('Core — `data` suppresses `persistence.load`', () => {
  const STORED = {
    blocks: [{ id: 's1', type: 'paragraph', data: { text: 'STORED' } }],
  };

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

  /**
   * The gate is `config.data == null`, and `{ blocks: [] }` is not loosely
   * null — so a host that seeds an empty document to mean "start blank" has
   * its stored document silently skipped, and the first autosave then writes
   * the empty document over it. Nothing on the config surface says so, so the
   * only way the host can find out is a warning.
   */
  it('warns that the load is skipped when an EMPTY document is passed alongside persistence', async () => {
    const load = vi.fn().mockResolvedValue({ data: STORED, version: 'etag-1' });

    await createReadyCore({
      holder: 'holder',
      data: { blocks: [] },
      persistence: { load, save: noopSave },
    });

    // The defect itself: the stored document is never read, so the first
    // autosave writes the empty document over it.
    expect(load).not.toHaveBeenCalled();

    expect(skipWarnings()).toHaveLength(1);
    expect(skipWarnings()[0]).toContain('version: null');
  });

  /**
   * The same warning covers the legitimate case — a host that server-rendered
   * the document and passes it as `data` while keeping `persistence` for
   * saving. Their load is skipped too, so no version is ever carried and every
   * `save` is told `version: null`, silently disabling their ETag handshake.
   */
  it('warns when a NON-EMPTY document is passed alongside persistence', async () => {
    const load = vi.fn().mockResolvedValue({ data: STORED, version: 'etag-1' });

    await createReadyCore({
      holder: 'holder',
      data: { blocks: [{ id: 'h1', type: 'paragraph', data: { text: 'host' } }] },
      persistence: { load, save: noopSave },
    });

    expect(skipWarnings()).toHaveLength(1);
    expect(load).not.toHaveBeenCalled();
  });

  // Nothing is being skipped, so there is nothing to warn about.
  it('stays silent when persistence is configured without `data`', async () => {
    const load = vi.fn().mockResolvedValue({ data: STORED, version: 'etag-1' });

    await createReadyCore({
      holder: 'holder',
      persistence: { load, save: noopSave },
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(skipWarnings()).toEqual([]);
  });

  // No persistence at all: `data` is the only source, as it always was.
  it('stays silent when `data` is passed without persistence', async () => {
    await createReadyCore({
      holder: 'holder',
      data: { blocks: [{ id: 'h1', type: 'paragraph', data: { text: 'host' } }] },
    });

    expect(skipWarnings()).toEqual([]);
  });

  /**
   * The warning must survive `setLogLevel`, which runs AFTER the gate is
   * computed and resets the module-level level the previous editor left. A
   * warning emitted before it would be filtered by that stale level.
   */
  it('emits the warning after the configured log level is applied', async () => {
    const { setLogLevel } = mockRegistry.utils;

    await createReadyCore({
      holder: 'holder',
      data: { blocks: [] },
      persistence: { load: vi.fn().mockResolvedValue(null), save: noopSave },
    });

    expect(setLogLevel).toHaveBeenCalled();

    const setLevelOrder = setLogLevel.mock.invocationCallOrder[0];
    const warnCall = mockLog.mock.calls.findIndex(
      (call) => call[1] === 'warn' && String(call[0]).includes('persistence.load')
    );

    expect(warnCall).toBeGreaterThanOrEqual(0);
    expect(mockLog.mock.invocationCallOrder[warnCall]).toBeGreaterThan(setLevelOrder);
  });
});

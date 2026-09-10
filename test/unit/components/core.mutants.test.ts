import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BlokConfig, OutputBlockData } from '../../../types';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import type * as UtilsModule from '../../../src/components/utils';

/**
 * Registries the mocked `Modules` map reads at call time. Every entry is
 * re-primed in beforeEach because afterEach's restoreAllMocks wipes
 * implementations created inside a vi.mock factory.
 */
const registry = vi.hoisted(() => ({
  flags: {
    /** Makes the Tools stub throw from its constructor. */
    throwOnTools: false,
    /** Makes the Collaboration stub report itself enabled. */
    collaborationEnabled: false,
    /** Blocks the BlockManager stub reports. */
    blockManagerBlocks: [ { id: 'block-1' } ] as { id: string }[],
  },
  calls: {
    i18nPrepare: vi.fn(),
    toolsPrepare: vi.fn(),
    uiPrepare: vi.fn(),
    uiCheckEmptiness: vi.fn(),
    blockManagerPrepare: vi.fn(),
    pastePrepare: vi.fn(),
    blockSelectionPrepare: vi.fn(),
    rectangleSelectionPrepare: vi.fn(),
    crossBlockSelectionPrepare: vi.fn(),
    readOnlyPrepare: vi.fn(),
    themeManagerPrepare: vi.fn(),
    rendererPrepare: vi.fn(),
    rendererRender: vi.fn(),
    modificationsObserverPrepare: vi.fn(),
    modificationsObserverEnable: vi.fn(),
    caretPrepare: vi.fn(),
    caretSetToBlock: vi.fn(),
    collaborationLoad: vi.fn(),
  },
  log: vi.fn(),
}));

vi.mock('../../../src/components/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof UtilsModule>();

  return {
    ...actual,
    // Spied so the warn/error paths can be asserted on their exact payload.
    log: registry.log,
  };
});

/**
 * The real module graph pulls in the whole editor; only the map itself is
 * stubbed, and every stub is a real class so `new module(...)` works.
 */
vi.mock('../../../src/components/modules', () => {
  const { calls } = registry;

  class MockI18n {
    public state?: BlokModules;
    public prepare = calls.i18nPrepare;
  }

  class MockTools {
    public state?: BlokModules;
    public prepare = calls.toolsPrepare;

    constructor() {
      if (registry.flags.throwOnTools) {
        throw new Error('tools constructor refused');
      }
    }
  }

  class MockUI {
    public state?: BlokModules;
    public prepare = calls.uiPrepare;
    public checkEmptiness = calls.uiCheckEmptiness;
  }

  class MockBlockManager {
    public state?: BlokModules;
    public prepare = calls.blockManagerPrepare;

    public get blocks(): { id: string }[] {
      return registry.flags.blockManagerBlocks;
    }
  }

  class MockPaste {
    public state?: BlokModules;
    public prepare = calls.pastePrepare;
  }

  class MockBlockSelection {
    public state?: BlokModules;
    public prepare = calls.blockSelectionPrepare;
  }

  class MockRectangleSelection {
    public state?: BlokModules;
    public prepare = calls.rectangleSelectionPrepare;
  }

  class MockCrossBlockSelection {
    public state?: BlokModules;
    public prepare = calls.crossBlockSelectionPrepare;
  }

  class MockReadOnly {
    public state?: BlokModules;
    public prepare = calls.readOnlyPrepare;
  }

  class MockThemeManager {
    public state?: BlokModules;
    public prepare = calls.themeManagerPrepare;
  }

  class MockRenderer {
    public state?: BlokModules;
    public prepare = calls.rendererPrepare;
    public render = calls.rendererRender;
  }

  class MockModificationsObserver {
    public state?: BlokModules;
    public prepare = calls.modificationsObserverPrepare;
    public enable = calls.modificationsObserverEnable;
  }

  class MockCaret {
    public state?: BlokModules;
    public prepare = calls.caretPrepare;
    public setToBlock = calls.caretSetToBlock;

    public get positions(): { START: string } {
      return {
        START: 'start',
      };
    }
  }

  class MockCollaboration {
    public state?: BlokModules;
    public prepare = vi.fn();
    public load = calls.collaborationLoad;

    public get isEnabled(): boolean {
      return registry.flags.collaborationEnabled;
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
      ThemeManager: MockThemeManager,
      Renderer: MockRenderer,
      ModificationsObserver: MockModificationsObserver,
      Caret: MockCaret,
      Collaboration: MockCollaboration,
    },
  };
});

const { calls, flags, log: mockLog } = registry;

import { Core } from '../../../src/components/core';

/**
 * Builds a Core and waits for its ready promise, so the async bootstrap has
 * settled before the test touches the instance.
 */
const createReadyCore = async (config?: BlokConfig | string): Promise<Core> => {
  const core = new Core(config);

  await core.isReady;

  return core;
};

/** Reads a tool entry off the normalized config without a cast at the call site. */
const toolEntry = (core: Core, name: string): unknown => {
  const tools: Record<string, unknown> | undefined = core.configuration.tools;

  return tools?.[name];
};

const DOM_FIXTURE =
  '<div id="holder">holder-marker-text</div><div id="blok">blok-default-marker-text</div>';

describe('Core mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    document.body.innerHTML = DOM_FIXTURE;

    flags.throwOnTools = false;
    flags.collaborationEnabled = false;
    flags.blockManagerBlocks = [ { id: 'block-1' } ];

    calls.rendererRender.mockResolvedValue(undefined);
    calls.collaborationLoad.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('isSingleDocSegment (via collaboration validation)', () => {
    it('accepts a single-segment doc and lets the editor come up', async () => {
      const core = new Core({
        collaboration: { doc: 'quarterly-report-draft' },
        server: 'https://blok.example.com',
      });

      // A rejecting promise here means the guard refused a legal document id.
      await expect(core.isReady).resolves.toBeUndefined();
    });

    it.each([
      [ 'a path separator', 'team/quarterly-report' ],
      [ 'an encoded separator', 'quarterly%2Freport' ],
      [ 'an uppercase encoded separator', 'quarterly%2freport' ],
      [ 'the current-directory segment', '.' ],
      [ 'the parent-directory segment', '..' ],
      [ 'an empty string', '' ],
    ])('refuses a doc with %s', async (_label, doc) => {
      const core = new Core({
        collaboration: { doc },
        server: 'https://blok.example.com',
      });

      await expect(core.isReady).rejects.toThrow('collaboration.doc must be a single path segment');
    });

    it('refuses a non-string doc', async () => {
      const core = new Core({
        collaboration: { doc: 42 as unknown as string },
        server: 'https://blok.example.com',
      });

      await expect(core.isReady).rejects.toThrow('collaboration.doc must be a single path segment');
    });

    it('refuses persistence alongside collaboration', async () => {
      const core = new Core({
        collaboration: { doc: 'quarterly-report-draft' },
        server: 'https://blok.example.com',
        persistence: { load: async () => null, save: async () => undefined },
      });

      await expect(core.isReady).rejects.toThrow(
        'collaboration and persistence cannot be combined: the sync service owns the document round-trip'
      );
    });

    it('requires the server option for collaboration', async () => {
      const core = new Core({ collaboration: { doc: 'quarterly-report-draft' } });

      await expect(core.isReady).rejects.toThrow('collaboration requires the server option');
    });

    it('refuses a non-boolean offline flag', async () => {
      const core = new Core({
        collaboration: { doc: 'quarterly-report-draft', offline: 'yes' as unknown as boolean },
        server: 'https://blok.example.com',
      });

      await expect(core.isReady).rejects.toThrow('collaboration.offline must be a boolean');
    });

    it('requires a non-empty offlineScope when offline is true', async () => {
      const core = new Core({
        collaboration: { doc: 'quarterly-report-draft', offline: true },
        server: 'https://blok.example.com',
      });

      await expect(core.isReady).rejects.toThrow(
        'collaboration.offlineScope must be a non-empty string when collaboration.offline is true'
      );
    });

    it('accepts offline with a non-empty offlineScope', async () => {
      const core = new Core({
        collaboration: { doc: 'quarterly-report-draft', offline: true, offlineScope: 'workspace-a' },
        server: 'https://blok.example.com',
      });

      await expect(core.isReady).resolves.toBeUndefined();
    });
  });

  describe('validate', () => {
    it('rejects ready when the holder id has no element', async () => {
      const core = new Core({ holder: 'absent-holder-id' });

      await expect(core.isReady).rejects.toThrow(
        'element with ID «absent-holder-id» is missing. Pass correct holder\'s ID.'
      );
    });

    it('reports the ready failure through the logger with the error label', async () => {
      const core = new Core({ holder: 'absent-holder-id' });

      await expect(core.isReady).rejects.toThrow();

      expect(mockLog).toHaveBeenCalledWith(
        'Blok is not ready because of Error: element with ID «absent-holder-id» is missing. Pass correct holder\'s ID.',
        'error'
      );
    });

    it('accepts a holder that is already an Element', async () => {
      const core = await createReadyCore({ holder: 'holder' });
      const element = document.getElementById('holder');

      core.configuration = { holder: element as HTMLElement };

      // A real Element must never be refused by the object-holder check.
      expect(() => core.validate()).not.toThrow();
    });

    it('accepts a non-object holder value without entering the element check', async () => {
      const core = await createReadyCore({ holder: 'holder' });

      // A function is truthy and not an Element: the object guard must still
      // keep it out of the "must be an Element node" refusal.
      core.configuration = { holder: ((): void => {}) as unknown as HTMLElement };

      expect(() => core.validate()).not.toThrow();
    });

    it('refuses an object holder that is not an Element', async () => {
      const core = await createReadyCore({ holder: 'holder' });

      core.configuration = { holder: {} as unknown as HTMLElement };

      expect(() => core.validate()).toThrow('«holder» value must be an Element node');
    });
  });

  describe('start', () => {
    it('prepares every module named in the sequence', async () => {
      await createReadyCore({ holder: 'holder' });

      expect(calls.blockSelectionPrepare).toHaveBeenCalledTimes(1);
      expect(calls.rectangleSelectionPrepare).toHaveBeenCalledTimes(1);
      expect(calls.crossBlockSelectionPrepare).toHaveBeenCalledTimes(1);
      expect(calls.themeManagerPrepare).toHaveBeenCalledTimes(1);
      expect(calls.i18nPrepare).toHaveBeenCalledTimes(1);
      expect(calls.toolsPrepare).toHaveBeenCalledTimes(1);
      expect(calls.uiPrepare).toHaveBeenCalledTimes(1);
      expect(calls.blockManagerPrepare).toHaveBeenCalledTimes(1);
      expect(calls.pastePrepare).toHaveBeenCalledTimes(1);
      expect(calls.readOnlyPrepare).toHaveBeenCalledTimes(1);
    });
  });

  describe('autofocus', () => {
    it('moves the caret to the first block when autofocus is on', async () => {
      await createReadyCore({ holder: 'holder', autofocus: true });

      expect(calls.caretSetToBlock).toHaveBeenCalledWith({ id: 'block-1' }, 'start');
    });

    it('leaves the caret alone when autofocus is off', async () => {
      await createReadyCore({ holder: 'holder', autofocus: false });

      expect(calls.caretSetToBlock).not.toHaveBeenCalled();
    });

    it('leaves the caret alone when the editor is read-only', async () => {
      await createReadyCore({ holder: 'holder', autofocus: true, readOnly: true });

      expect(calls.caretSetToBlock).not.toHaveBeenCalled();
    });

    it('leaves the caret alone when the editor has no blocks', async () => {
      flags.blockManagerBlocks = [];

      await createReadyCore({ holder: 'holder', autofocus: true });

      expect(calls.caretSetToBlock).not.toHaveBeenCalled();
    });

    it('leaves the caret alone when autofocus is on but read-only and blockless coincide', async () => {
      flags.blockManagerBlocks = [];

      await createReadyCore({ holder: 'holder', autofocus: true, readOnly: true });

      expect(calls.caretSetToBlock).not.toHaveBeenCalled();
    });
  });

  describe('configuration setter — basics', () => {
    it('treats a bare string config as the holder id', async () => {
      const core = await createReadyCore('holder');

      expect(core.configuration.holder).toBe('holder');
    });

    it('defaults the holder to blok when none is given', async () => {
      const core = await createReadyCore({});

      expect(core.configuration.holder).toBe('blok');
    });

    it('defaults the log level to VERBOSE', async () => {
      const core = await createReadyCore({ holder: 'holder' });

      expect(core.configuration.logLevel).toBe('VERBOSE');
    });

    it('keeps a host-provided log level', async () => {
      const core = await createReadyCore({ holder: 'holder', logLevel: 'ERROR' as BlokConfig['logLevel'] });

      expect(core.configuration.logLevel).toBe('ERROR');
    });

    it('warns verbatim when data and persistence are both configured', async () => {
      await createReadyCore({
        holder: 'holder',
        data: { blocks: [ { id: 'kept-block', type: 'paragraph', data: { text: 'kept text' } } ] },
        persistence: { load: async () => null, save: async () => undefined },
      });

      expect(mockLog).toHaveBeenCalledWith(
        'Both `data` and `persistence` are configured, so `persistence.load` will not run: ' +
        'the `data` you passed wins, even when it holds no blocks. Nothing is loaded, so no ' +
        'document version is carried either — every `save` is told `version: null`. ' +
        'Pass no `data` to load the document from `persistence`.',
        'warn'
      );
    });

    it('stays silent about persistence when no data was passed', async () => {
      await createReadyCore({
        holder: 'holder',
        persistence: { load: async () => null, save: async () => undefined },
      });

      const warnedAboutData = mockLog.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].startsWith('Both `data` and `persistence`')
      );

      expect(warnedAboutData).toBe(false);
    });
  });

  describe('configuration setter — default block fallback', () => {
    it('falls back to paragraph when the default block tool is missing', async () => {
      const core = await createReadyCore({ holder: 'holder', defaultBlock: 'header' });

      expect(core.configuration.defaultBlock).toBe('paragraph');
    });

    it('warns with the fallback message naming the unconfigured block', async () => {
      await createReadyCore({ holder: 'holder', defaultBlock: 'header' });

      expect(mockLog).toHaveBeenCalledWith(
        'Default block "header" is not configured. Falling back to "paragraph" tool.',
        'warn'
      );
    });

    it('falls back to paragraph when the document holds an empty block list', async () => {
      const core = await createReadyCore({
        holder: 'holder',
        defaultBlock: 'header',
        data: { blocks: [] },
      });

      expect(core.configuration.defaultBlock).toBe('paragraph');
    });

    it('keeps the default block when its tool is configured', async () => {
      const core = await createReadyCore({
        holder: 'holder',
        defaultBlock: 'header',
        tools: { header: { class: class MockHeaderTool {} } },
      });

      expect(core.configuration.defaultBlock).toBe('header');
    });

    it('keeps the default block when the document already has blocks', async () => {
      const core = await createReadyCore({
        holder: 'holder',
        defaultBlock: 'header',
        data: { blocks: [ { id: 'seeded-block', type: 'header', data: { text: 'seeded heading' } } ] },
      });

      expect(core.configuration.defaultBlock).toBe('header');
    });

    it('does not fall back for a paragraph default block', async () => {
      const core = await createReadyCore({ holder: 'holder', defaultBlock: 'paragraph' });

      expect(core.configuration.defaultBlock).toBe('paragraph');
      expect(toolEntry(core, 'paragraph')).toBeUndefined();
    });
  });

  describe('configuration setter — paragraph tool config', () => {
    it('creates a preserveBlank paragraph config when the tool is absent', async () => {
      const core = await createReadyCore({ holder: 'holder', defaultBlock: 'header' });

      expect(toolEntry(core, 'paragraph')).toStrictEqual({
        config: { preserveBlank: true },
      });
    });

    it('wraps a function paragraph tool as the class', async () => {
      const paragraphTool = class MockCustomParagraph {};

      const core = await createReadyCore({
        holder: 'holder',
        defaultBlock: 'header',
        // The bare class stands in for a tool that IS function-shaped; only the
        // identity of the wrapped value matters to this mutant.
        tools: { paragraph: paragraphTool } as unknown as BlokConfig['tools'],
      });

      expect(toolEntry(core, 'paragraph')).toStrictEqual({
        class: paragraphTool,
        config: { preserveBlank: true },
      });
    });

    it('merges preserveBlank into an object paragraph tool config', async () => {
      const core = await createReadyCore({
        holder: 'holder',
        defaultBlock: 'header',
        tools: { paragraph: { class: class MockGivenParagraph {}, config: { placeholder: 'write here' } } },
      });

      expect(toolEntry(core, 'paragraph')).toStrictEqual({
        class: expect.any(Function),
        config: { placeholder: 'write here', preserveBlank: true },
      });
    });

    it('adds a config to an object paragraph tool that has none', async () => {
      const core = await createReadyCore({
        holder: 'holder',
        defaultBlock: 'header',
        tools: { paragraph: { class: class MockGivenParagraph {} } },
      });

      expect(toolEntry(core, 'paragraph')).toStrictEqual({
        class: expect.any(Function),
        config: { preserveBlank: true },
      });
    });

    it('falls back to a plain preserveBlank config for an unusable entry', async () => {
      const core = await createReadyCore({
        holder: 'holder',
        defaultBlock: 'header',
        tools: { paragraph: 'custom-paragraph-string' } as unknown as BlokConfig['tools'],
      });

      expect(toolEntry(core, 'paragraph')).toStrictEqual({
        config: { preserveBlank: true },
      });
    });

    it('falls back to a plain preserveBlank config for a numeric entry', async () => {
      const core = await createReadyCore({
        holder: 'holder',
        defaultBlock: 'header',
        tools: { paragraph: 42 } as unknown as BlokConfig['tools'],
      });

      expect(toolEntry(core, 'paragraph')).toStrictEqual({
        config: { preserveBlank: true },
      });
    });

    it('keeps the other tools when the paragraph entry is rewritten', async () => {
      const core = await createReadyCore({
        holder: 'holder',
        defaultBlock: 'header',
        tools: { quote: { class: class MockQuoteTool {} } },
      });

      expect(toolEntry(core, 'quote')).toStrictEqual({ class: expect.any(Function) });
    });
  });

  describe('configuration setter — defaults', () => {
    it('defaults minHeight to 300', async () => {
      const core = await createReadyCore({ holder: 'holder' });

      expect(core.configuration.minHeight).toBe(300);
    });

    it('keeps a host-provided minHeight', async () => {
      const core = await createReadyCore({ holder: 'holder', minHeight: 512 });

      expect(core.configuration.minHeight).toBe(512);
    });

    it('keeps a truthy placeholder setting', async () => {
      const core = await createReadyCore({ holder: 'holder', placeholder: true as unknown as string });

      expect(core.configuration.placeholder).toBe(true);
    });

    it('defaults the placeholder to false', async () => {
      const core = await createReadyCore({ holder: 'holder' });

      expect(core.configuration.placeholder).toBe(false);
    });

    it('keeps a host-provided sanitizer config', async () => {
      const sanitizer = { p: { br: true } };

      const core = await createReadyCore({ holder: 'holder', sanitizer });

      expect(core.configuration.sanitizer).toStrictEqual(sanitizer);
    });

    it('clones and normalizes the initial blocks', async () => {
      const core = await createReadyCore({
        holder: 'holder',
        data: {
          blocks: [
            {
              id: 'initial-block-id',
              type: 'paragraph',
              data: { text: 'first initial text' },
            },
          ],
        },
      });

      const blocks = core.configuration.data?.blocks ?? [];

      expect(blocks).toHaveLength(1);
      expect(blocks[0].id).toBe('initial-block-id');
      expect(blocks[0].data).toStrictEqual({ text: 'first initial text' });
    });

    it('drops a null block id from the wire shape when cloning', async () => {
      const core = await createReadyCore({
        holder: 'holder',
        data: {
          blocks: [
            { id: null, type: 'paragraph', data: { text: 'second initial text' } },
          ],
        },
      });

      const block = core.configuration.data?.blocks?.[0];

      expect(block).not.toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(block, 'id')).toBe(false);
    });

    it('leaves data that carries no blocks array to the default block seed', async () => {
      const core = await createReadyCore({ holder: 'holder', data: {} as unknown as BlokConfig['data'] });

      const blocks = core.configuration.data?.blocks ?? [];

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('paragraph');
    });

    it('does not mutate the host-provided block objects', async () => {
      const hostBlock: OutputBlockData = {
        id: 'host-owned-block',
        type: 'paragraph',
        data: { text: 'host owned text' },
      };

      const core = await createReadyCore({ holder: 'holder', data: { blocks: [ hostBlock ] } });
      const rendered = core.configuration.data?.blocks?.[0];

      expect(rendered).not.toBe(hostBlock);
      expect(rendered).toStrictEqual(hostBlock);
    });

    it('installs a no-op onReady when the host gave none', async () => {
      const core = await createReadyCore({ holder: 'holder' });

      expect(typeof core.configuration.onReady).toBe('function');
    });

    it('keeps the host-provided onReady by identity', async () => {
      const onReady = (): void => {};

      const core = await createReadyCore({ holder: 'holder', onReady });

      expect(core.configuration.onReady).toBe(onReady);
    });

    it('defaults inlineToolbar to true', async () => {
      const core = await createReadyCore({ holder: 'holder' });

      expect(core.configuration.inlineToolbar).toBe(true);
    });

    it('keeps a disabled inlineToolbar', async () => {
      const core = await createReadyCore({ holder: 'holder', inlineToolbar: false });

      expect(core.configuration.inlineToolbar).toBe(false);
    });

    it('leaves the onChange handler absent when the host gave none', async () => {
      const core = await createReadyCore({ holder: 'holder' });

      expect('onChange' in core.configuration).toBe(false);
    });

    it('seeds a default block when no data was passed', async () => {
      const core = await createReadyCore({ holder: 'holder', defaultBlock: 'header' });

      const blocks = core.configuration.data?.blocks ?? [];

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('paragraph');
    });
  });

  describe('render — persisted document load', () => {
    it('renders the configured data when the store has nothing saved', async () => {
      const load = vi.fn(async () => null);

      await createReadyCore({
        holder: 'holder',
        persistence: { load, save: async () => undefined },
      });

      expect(load).toHaveBeenCalledTimes(1);
      expect(calls.rendererRender).toHaveBeenCalledWith([
        { type: 'paragraph', data: {} },
      ]);
    });

    it('renders the configured data when the loaded document holds no blocks', async () => {
      const load = vi.fn(async () => ({ blocks: [] }));

      await createReadyCore({
        holder: 'holder',
        persistence: { load, save: async () => undefined },
      });

      expect(calls.rendererRender).toHaveBeenCalledWith([
        { type: 'paragraph', data: {} },
      ]);
    });

    it('renders the loaded document when it holds blocks', async () => {
      const load = vi.fn(async () => ({
        blocks: [ { id: 'loaded-block', type: 'paragraph', data: { text: 'loaded text' } } ],
      }));

      await createReadyCore({
        holder: 'holder',
        persistence: { load, save: async () => undefined },
      });

      expect(calls.rendererRender).toHaveBeenCalledWith([
        { id: 'loaded-block', type: 'paragraph', data: { text: 'loaded text' } },
      ]);
    });

    it('unwraps a versioned envelope before rendering', async () => {
      const load = vi.fn(async () => ({
        data: { blocks: [ { id: 'enveloped-block', type: 'paragraph', data: { text: 'enveloped text' } } ] },
        version: 'etag-7',
      }));

      await createReadyCore({
        holder: 'holder',
        persistence: { load, save: async () => undefined },
      });

      expect(calls.rendererRender).toHaveBeenCalledWith([
        { id: 'enveloped-block', type: 'paragraph', data: { text: 'enveloped text' } },
      ]);
    });

    it('clones the loaded blocks away from the host objects', async () => {
      const loadedBlock = { id: 'store-owned-block', type: 'paragraph', data: { text: 'store owned text' } };
      const load = vi.fn(async () => ({ blocks: [ loadedBlock ] }));

      const core = await createReadyCore({
        holder: 'holder',
        persistence: { load, save: async () => undefined },
      });

      const rendered = core.configuration.data?.blocks?.[0];

      expect(rendered).not.toBe(loadedBlock);
      expect(rendered).toStrictEqual(loadedBlock);
    });

    it('skips the store entirely once data was configured', async () => {
      const load = vi.fn(async () => null);

      await createReadyCore({
        holder: 'holder',
        data: { blocks: [ { id: 'configured-block', type: 'paragraph', data: { text: 'configured text' } } ] },
        persistence: { load, save: async () => undefined },
      });

      expect(load).not.toHaveBeenCalled();
    });
  });

  describe('render — collaboration', () => {
    it('hands the configured blocks to the sync document and skips the renderer', async () => {
      flags.collaborationEnabled = true;

      const core = new Core({
        collaboration: { doc: 'quarterly-report-draft' },
        server: 'https://blok.example.com',
        data: { blocks: [ { id: 'collab-block', type: 'paragraph', data: { text: 'collab text' } } ] },
      });

      await core.isReady;

      expect(calls.collaborationLoad).toHaveBeenCalledWith([
        { id: 'collab-block', type: 'paragraph', data: { text: 'collab text' } },
      ]);
      expect(calls.rendererRender).not.toHaveBeenCalled();
    });
  });

  describe('constructModules', () => {
    it('logs the skipped module with its label when a constructor throws', async () => {
      flags.throwOnTools = true;

      await createReadyCore({ holder: 'holder' });

      expect(mockLog).toHaveBeenCalledWith(
        '[constructModules] Module Tools skipped because',
        'error',
        expect.any(Error)
      );
    });

    it('keeps constructing the modules after one throws', async () => {
      flags.throwOnTools = true;

      await createReadyCore({ holder: 'holder' });

      expect(calls.i18nPrepare).toHaveBeenCalledTimes(1);
      expect(calls.rendererRender).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Three mutants on src/components/core.ts are equivalent, not alive:
 * - 1214 (`if (paragraphEntry === undefined)` -> `if (false)`) and 1216 (that
 *   branch's body -> `{}`) both fall through to the final
 *   `return { config: { preserveBlank: true } }` — the same value the removed
 *   branch returned, since isFunction(undefined) and isObject(undefined) are
 *   both false. No input can tell them apart.
 * - 1209 (`hasOwnProperty.call(this.moduleInstances, name)` -> `true`):
 *   moduleInstances is a plain object literal filled by own assignment and
 *   Object.prototype exposes no enumerable key, so the guard is already true
 *   for every name a for-in can visit.
 */

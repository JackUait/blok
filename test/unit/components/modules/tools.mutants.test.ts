import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Tools } from '../../../../src/components/modules/tools';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import { ToolsFactory } from '../../../../src/components/tools/factory';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { ModuleConfig } from '../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../types';
import type { ToolConstructable, ToolSettings } from '../../../../types/tools';

/**
 * Builds a Tools module wired to the given user config.
 * The config object is handed back untouched, so a test can assert what
 * `prepare()` wrote into it.
 * @param config - blok configuration the module will read and mutate
 */
const createModule = (config: BlokConfig): Tools => {
  const moduleConfig: ModuleConfig = {
    config,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  };

  const module = new Tools(moduleConfig);

  const apiMethods = {
    i18n: {
      t: (key: string): string => key,
      has: (): boolean => false,
      getEnglishTranslation: (key: string): string => key,
      getLocale: (): string => 'en',
    },
  };

  module.state = {
    API: {
      getMethodsForTool(): typeof apiMethods {
        return apiMethods;
      },
      methods: apiMethods,
    },
  } as unknown as BlokModules;

  return module;
};

/**
 * Reads the protected constructable an adapter was built from.
 * @param adapter - block tool adapter to inspect
 */
const constructableOf = (adapter: BlockToolAdapter | undefined): unknown =>
  (adapter as unknown as { constructable: unknown } | undefined)?.constructable;

/**
 * Minimal block tool.
 */
class BasicBlockTool {
  /**
   * Renders an empty holder.
   */
  public render(): HTMLElement {
    return document.createElement('div');
  }

  /**
   * Saves nothing.
   */
  public save(): void {}
}

/**
 * Inline tool contributing a `b` sanitize rule.
 */
class BoldInlineTool {
  public static isInline = true;

  public static sanitize = { b: {} };

  /**
   * Renders an empty menu config.
   */
  public render(): Record<string, unknown> {
    return {};
  }
}

/**
 * Inline tool contributing an `i` sanitize rule.
 */
class ItalicInlineTool {
  public static isInline = true;

  public static sanitize = { i: {} };

  /**
   * Renders an empty menu config.
   */
  public render(): Record<string, unknown> {
    return {};
  }
}

/**
 * Block tune with no behaviour.
 */
class NamedBlockTune {
  public static isTune = true;
}

/**
 * Block tool that records the config the module hands to its static prepare.
 */
class ConfigCapturingTool {
  public static seen: Record<string, unknown> | null = null;

  /**
   * Records the tool config the module resolved for this tool.
   * @param data - prepare payload built by the Tools module
   */
  public static prepare(data: { config: Record<string, unknown> }): void {
    ConfigCapturingTool.seen = data.config;
  }

  /**
   * Renders an empty holder.
   */
  public render(): HTMLElement {
    return document.createElement('div');
  }
}

describe('tools module — mutant coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('internal tool registration', () => {
    it('names the stub tool and registers it', async () => {
      const module = createModule({ tools: {} });

      await module.prepare();

      expect(module.stubTool).toBe('stub');
      expect(module.available.has(module.stubTool)).toBe(true);
    });

    it('registers exactly the four bundled internal tools and flags them internal', async () => {
      const module = createModule({ tools: {} });

      await module.prepare();

      expect(Array.from(module.available.keys())).toStrictEqual([
        'stub',
        'delete',
        'copyLink',
        'convertTo',
      ]);
      expect(Array.from(module.internal.keys())).toStrictEqual([
        'stub',
        'delete',
        'copyLink',
        'convertTo',
      ]);
    });
  });

  describe('.defaultTool', () => {
    it('reports a missing defaultBlock config separately from a missing tool', async () => {
      const module = createModule({ tools: {} });

      await module.prepare();

      expect(() => module.defaultTool).toThrowError(
        new Error('Default block tool name is not configured')
      );
    });

    it('names the configured default block that no available tool provides', async () => {
      const module = createModule({
        defaultBlock: 'ghost',
        tools: {},
      });

      await module.prepare();

      expect(() => module.defaultTool).toThrowError(
        new Error('Default block tool "ghost" not found in available block tools')
      );
    });
  });

  describe('.updateToolConfig()', () => {
    it('refuses an unregistered tool before it reaches the factory', async () => {
      const module = createModule({
        tools: { para: BasicBlockTool as unknown as ToolConstructable },
      });

      await module.prepare();

      // The factory throws the SAME message, so only "never reached it" separates
      // the module guard from the factory's own.
      const updateConfig = vi.spyOn(ToolsFactory.prototype, 'updateConfig');

      expect(() => module.updateToolConfig('ghost', { foo: 'bar' })).toThrowError(
        new Error('Tool "ghost" is not registered.')
      );
      expect(updateConfig).not.toHaveBeenCalled();
    });

    it('accepts a tool that failed preparation and lives in the unavailable list', async () => {
      /**
       * Block tool whose prepare always fails.
       */
      class FailingBlockTool {
        /**
         * Fails preparation.
         */
        public static prepare(): void {
          throw new Error('prepare failed');
        }

        /**
         * Renders an empty holder.
         */
        public render(): HTMLElement {
          return document.createElement('div');
        }
      }

      const module = createModule({
        tools: { failing: FailingBlockTool as unknown as ToolConstructable },
      });

      await module.prepare();

      expect(module.available.has('failing')).toBe(false);
      expect(module.unavailable.has('failing')).toBe(true);
      expect(() => module.updateToolConfig('failing', { foo: 'bar' })).not.toThrow();
    });

    it('leaves a non-block adapter alone when a toolbox key is updated', async () => {
      const module = createModule({
        tools: { bold: BoldInlineTool as unknown as ToolConstructable },
      });

      await module.prepare();

      expect(() => module.updateToolConfig('bold', { toolbox: false })).not.toThrow();
    });

    it('survives a toolbox update after the modules object is gone', async () => {
      const module = createModule({
        defaultBlock: 'para',
        tools: { para: BasicBlockTool as unknown as ToolConstructable },
      });

      await module.prepare();

      module.state = undefined as unknown as BlokModules;

      expect(() => module.updateToolConfig('para', { toolbox: false })).not.toThrow();
    });
  });

  describe('.destroy()', () => {
    it('warns once per failing reset, for both the sync throw and the rejected promise', async () => {
      const syncError = new Error('sync reset failure');
      const asyncError = new Error('async reset failure');

      /**
       * Block tool whose reset throws synchronously.
       */
      class ThrowingBlockTool {
        /**
         * Throws on reset.
         */
        public static reset(): void {
          throw syncError;
        }

        /**
         * Renders an empty holder.
         */
        public render(): HTMLElement {
          return document.createElement('div');
        }
      }

      /**
       * Block tool whose reset rejects.
       */
      class RejectingBlockTool {
        /**
         * Rejects on reset.
         */
        public static reset(): Promise<void> {
          return Promise.reject(asyncError);
        }

        /**
         * Renders an empty holder.
         */
        public render(): HTMLElement {
          return document.createElement('div');
        }
      }

      const module = createModule({
        tools: {
          throwing: ThrowingBlockTool as unknown as ToolConstructable,
          rejecting: RejectingBlockTool as unknown as ToolConstructable,
        },
      });

      await module.prepare();

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      module.destroy();

      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });

      expect(warn.mock.calls).toStrictEqual([
        ['Tool "throwing" reset failed %o', syncError],
        ['Tool "rejecting" reset failed %o', asyncError],
      ]);
    });
  });

  describe('inline tool validation', () => {
    it('warns with the tool name and the missing method list', async () => {
      /**
       * Inline tool missing the required render method.
       */
      class RenderlessInlineTool {
        public static isInline = true;
      }

      const module = createModule({
        tools: { broken: RenderlessInlineTool as unknown as ToolConstructable },
      });

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await module.prepare();

      expect(warn.mock.calls).toStrictEqual([
        [
          'Incorrect Inline Tool: broken. Some of required methods is not implemented %o %o',
          ['render'],
        ],
      ]);
      expect(module.unavailable.has('broken')).toBe(true);
    });
  });

  describe('tool group expansion', () => {
    /**
     * Provided block tool.
     */
    class RowTool {
      /**
       * Renders an empty holder.
       */
      public render(): HTMLElement {
        return document.createElement('div');
      }
    }

    /**
     * Provided block tool.
     */
    class SlotTool {
      /**
       * Renders an empty holder.
       */
      public render(): HTMLElement {
        return document.createElement('div');
      }
    }

    it('forwards only the group settings that are not the class ref or the internal flag', async () => {
      /**
       * Tool group providing two block tools.
       */
      class SettingsGroup {
        public static provides = { row: RowTool, slot: SlotTool };
      }

      const blokConfig: BlokConfig = {
        tools: {
          group: {
            class: SettingsGroup as unknown as ToolConstructable,
            isInternal: true,
            shortcut: 'CMD+SHIFT+X',
          } as unknown as ToolSettings,
        },
      };

      const module = createModule(blokConfig);

      await module.prepare();

      const rowEntry = blokConfig.tools?.row as unknown as Record<string, unknown>;

      expect(Object.keys(rowEntry)).toStrictEqual(['class', 'shortcut']);
      expect(rowEntry.class).toBe(RowTool);
      expect(constructableOf(module.blockTools.get('row'))).toBe(RowTool);
      expect(constructableOf(module.blockTools.get('slot'))).toBe(SlotTool);
      expect(Array.from(module.internal.keys())).toStrictEqual([
        'stub',
        'delete',
        'copyLink',
        'convertTo',
      ]);
    });

    it('keeps a settings-free group entry as the bare provided class', async () => {
      /**
       * Tool group registered as a bare class.
       */
      class BareGroup {
        public static provides = { alpha: RowTool, beta: SlotTool };
      }

      const blokConfig: BlokConfig = {
        tools: { group: BareGroup as unknown as ToolConstructable },
      };

      const module = createModule(blokConfig);

      await module.prepare();

      expect(blokConfig.tools?.alpha).toBe(RowTool);
      expect(blokConfig.tools?.beta).toBe(SlotTool);
      expect(module.blockTools.has('alpha')).toBe(true);
    });

    it('rejects a settings object that carries no class', async () => {
      const module = createModule({
        tools: { broken: { inlineToolbar: true } as unknown as ToolSettings },
      });

      await expect(module.prepare()).rejects.toThrowError(
        new Error(
          'Tool «broken» must be a constructor function or an object with function in the «class» property'
        )
      );
    });
  });

  describe('config iteration guards', () => {
    it('ignores an enumerable key inherited from Object.prototype', async () => {
      Object.defineProperty(Object.prototype, 'pollutedTool', {
        value: { class: BasicBlockTool },
        enumerable: true,
        configurable: true,
        writable: true,
      });

      try {
        const module = createModule({
          tools: { para: BasicBlockTool as unknown as ToolConstructable },
        });

        await expect(module.prepare()).resolves.toBeUndefined();

        expect(module.available.has('pollutedTool')).toBe(false);
        expect(module.unavailable.has('pollutedTool')).toBe(false);
      } finally {
        delete (Object.prototype as unknown as Record<string, unknown>).pollutedTool;
      }
    });

    it('skips validation for a user entry registered under an internal tool name', async () => {
      const module = createModule({
        tools: { stub: { class: {} } as unknown as ToolSettings },
      });

      await expect(module.prepare()).resolves.toBeUndefined();

      expect(module.available.has('stub')).toBe(true);
    });
  });

  describe('inline tool assignment', () => {
    it('assigns no inline tools when the global inlineToolbar is false', async () => {
      const module = createModule({
        defaultBlock: 'para',
        tools: {
          para: BasicBlockTool as unknown as ToolConstructable,
          bold: BoldInlineTool as unknown as ToolConstructable,
        },
        inlineToolbar: false,
      });

      await module.prepare();

      expect(Array.from(module.blockTools.get('para')?.inlineTools.keys() ?? [])).toStrictEqual([]);
    });

    it('prepends convertTo to the default order without asking for an unnamed tool', async () => {
      const module = createModule({
        defaultBlock: 'para',
        tools: {
          para: BasicBlockTool as unknown as ToolConstructable,
          bold: BoldInlineTool as unknown as ToolConstructable,
          italic: ItalicInlineTool as unknown as ToolConstructable,
        },
      });

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await module.prepare();

      expect(Array.from(module.blockTools.get('para')?.inlineTools.keys() ?? [])).toStrictEqual([
        'convertTo',
        'bold',
        'italic',
      ]);
      expect(warn).not.toHaveBeenCalled();
    });

    it('prepends convertTo to a per-tool list and skips names it cannot resolve', async () => {
      const module = createModule({
        defaultBlock: 'para',
        tools: {
          para: {
            class: BasicBlockTool as unknown as ToolConstructable,
            inlineToolbar: ['bold', 'missingInline'],
          },
          bold: BoldInlineTool as unknown as ToolConstructable,
        },
      });

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await module.prepare();

      expect(Array.from(module.blockTools.get('para')?.inlineTools.keys() ?? [])).toStrictEqual([
        'convertTo',
        'bold',
      ]);
      expect(warn.mock.calls).toStrictEqual([
        ['Inline tool "missingInline" is not available and will be skipped'],
      ]);
    });
  });

  describe('block tune assignment', () => {
    it('skips tune names it cannot resolve and keeps the internal tunes last', async () => {
      const module = createModule({
        defaultBlock: 'para',
        tools: {
          para: {
            class: BasicBlockTool as unknown as ToolConstructable,
            tunes: ['myTune', 'missingTune'],
          },
          myTune: NamedBlockTune as unknown as ToolConstructable,
        },
      });

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await module.prepare();

      expect(Array.from(module.blockTools.get('para')?.tunes.keys() ?? [])).toStrictEqual([
        'myTune',
        'delete',
        'copyLink',
      ]);
      expect(warn.mock.calls).toStrictEqual([
        ['Block tune "missingTune" is not available and will be skipped'],
      ]);
    });
  });

  describe('.setInlineToolbar()', () => {
    it('rewrites the config, reassigns every block tool and drops the memoized sanitize config', async () => {
      const blokConfig: BlokConfig = {
        defaultBlock: 'para',
        tools: {
          para: BasicBlockTool as unknown as ToolConstructable,
          bold: BoldInlineTool as unknown as ToolConstructable,
          italic: ItalicInlineTool as unknown as ToolConstructable,
        },
        inlineToolbar: ['bold'],
      };

      const module = createModule(blokConfig);

      await module.prepare();

      const para = module.blockTools.get('para');

      // Reading it first is what fills the memo the setter must invalidate.
      expect(para?.sanitizeConfig).toStrictEqual({ b: {} });

      module.setInlineToolbar(['italic']);

      expect(blokConfig.inlineToolbar).toStrictEqual(['italic']);
      expect(Array.from(para?.inlineTools.keys() ?? [])).toStrictEqual(['italic']);
      expect(para?.sanitizeConfig).toStrictEqual({ i: {} });
    });
  });

  describe('internal tool modules replaced at import time', () => {
    const stubPath = '../../../../src/tools/stub';
    const deletePath = '../../../../src/components/block-tunes/block-tune-delete';
    const copyLinkPath = '../../../../src/components/block-tunes/block-tune-copy-link';
    const convertPath = '../../../../src/components/inline-tools/inline-tool-convert';

    afterEach(() => {
      vi.doUnmock(stubPath);
      vi.doUnmock(deletePath);
      vi.doUnmock(copyLinkPath);
      vi.doUnmock(convertPath);
      vi.resetModules();
    });

    it('refuses an internal tool constructable that is not a function', async () => {
      vi.resetModules();
      vi.doMock(stubPath, () => ({ Stub: 'not-a-function' }));

      const { Tools: FreshTools } = await import('../../../../src/components/modules/tools');
      const module = createModule({ tools: {} });
      const fresh = new FreshTools({
        config: { tools: {} },
        eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
      });

      fresh.state = (module as unknown as { Blok: BlokModules }).Blok;

      await expect(fresh.prepare()).rejects.toThrowError(
        new Error('Tool constructable must be a function')
      );
    });

    it('refuses to start once tool expansion leaves no tools at all', async () => {
      vi.resetModules();

      /**
       * Tool group that provides nothing, so expansion drops its handle key.
       */
      class EmptyGroup {
        public static provides: Record<string, ToolConstructable> = {};
      }

      vi.doMock(stubPath, () => ({ Stub: EmptyGroup }));
      vi.doMock(deletePath, () => ({ DeleteTune: EmptyGroup }));
      vi.doMock(copyLinkPath, () => ({ CopyLinkTune: EmptyGroup }));
      vi.doMock(convertPath, () => ({ ConvertInlineTool: EmptyGroup }));

      const { Tools: FreshTools } = await import('../../../../src/components/modules/tools');
      const module = createModule({ tools: {} });
      const fresh = new FreshTools({
        config: { tools: {} },
        eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
      });

      fresh.state = (module as unknown as { Blok: BlokModules }).Blok;

      await expect(fresh.prepare()).rejects.toThrowError(new Error('Can\'t start without tools'));
    });
  });

  describe('tool config extraction', () => {
    it('hands the tool its non-blok settings flattened over the nested config, and nothing else', async () => {
      ConfigCapturingTool.seen = null;

      const module = createModule({
        tools: {
          capture: {
            class: ConfigCapturingTool as unknown as ToolConstructable,
            inlineToolbar: false,
            tunes: [],
            shortcut: 'CMD+SHIFT+K',
            toolbox: { title: 'Capture' },
            config: { nestedOnly: 'nested' },
            isInternal: false,
            customOption: 42,
          } as unknown as ToolSettings,
        },
      });

      await module.prepare();

      // Every key listed in BLOK_SETTINGS_KEYS must be withheld from the tool.
      expect(Object.keys(ConfigCapturingTool.seen ?? {})).toStrictEqual([
        'nestedOnly',
        'customOption',
      ]);
      expect(ConfigCapturingTool.seen).toStrictEqual({
        nestedOnly: 'nested',
        customOption: 42,
      });
    });
  });

  describe('prepare metadata guard', () => {
    /**
     * A value that coerces to a registered tool name but is not a primitive
     * string, so `typeof` cannot vouch for it. A tool's prepare receives the
     * SAME object the module reads its `toolName` back from, so a tool can put
     * this in place of its own name before the registration callbacks run.
     * @param name - the registered name the value must coerce to
     */
    const nameLike = (name: string): { toString(): string } => ({ toString: (): string => name });

    /**
     * Block tool whose prepare replaces the metadata name with such a value.
     */
    class OpaqueNameTool {
      /**
       * Replaces the tool name with a name-like non-string.
       * @param data - prepare payload built by the Tools module
       */
      public static prepare(data: { toolName: string }): void {
        Reflect.set(data, 'toolName', nameLike('opaque'));
      }

      /**
       * Renders an empty holder.
       */
      public render(): HTMLElement {
        return document.createElement('div');
      }
    }

    /**
     * Block tool that does the same and then fails preparation.
     */
    class OpaqueNameRejectingTool {
      /**
       * Replaces the tool name with a name-like non-string, then rejects.
       * @param data - prepare payload built by the Tools module
       */
      public static prepare(data: { toolName: string }): Promise<void> {
        Reflect.set(data, 'toolName', nameLike('opaqueRejecting'));

        return Promise.reject(new Error('prepare failed'));
      }

      /**
       * Renders an empty holder.
       */
      public render(): HTMLElement {
        return document.createElement('div');
      }
    }

    it('registers neither a successful tool nor a failed one once the metadata name is not a string', async () => {
      const module = createModule({
        tools: {
          opaque: OpaqueNameTool as unknown as ToolConstructable,
          opaqueRejecting: OpaqueNameRejectingTool as unknown as ToolConstructable,
        },
      });

      await module.prepare();

      // The internal tools are the only survivors.
      expect(Array.from(module.available.keys())).toStrictEqual([
        'stub',
        'delete',
        'copyLink',
        'convertTo',
      ]);
      expect(Array.from(module.unavailable.keys())).toStrictEqual([]);
    });
  });

  /*
   * MEASURED equivalent (swept, verdict "alive" for every one of these) —
   * no test can observe them on the current source:
   *
   * L176 `sequenceData.length === 0` (2 mutants): line 160 already threw unless
   *   `Object.keys(toolsConfig).length > 0`, and getListOfPrepareFunctions maps
   *   one entry per own key of the very same object, so the length is never 0.
   * L620 `!toolsConfig` in validateTools (2 mutants): its only caller reads
   *   `this.config.tools` two lines after assigning it the object expandToolGroups
   *   returned. Even a config whose `tools` accessor drops the write is dead here:
   *   line 160 reads the same falsy value and throws first, and a `for…in` over
   *   undefined iterates zero times, so the emptied guard is a no-op either way.
   * L630 hasOwnProperty in validateTools (2 mutants): the only keys it can skip
   *   are inherited ones, and line 634 skips those again — `toolName in
   *   internalTools` resolves through the same Object.prototype the key came from.
   *   The "ignores an enumerable key inherited from Object.prototype" test drives
   *   that path and stays green under both mutants, which is what the sweep saw.
   * L691 `candidate?.toolName` (1 mutant, OptionalChaining): both callers pass
   *   `callbackData`, which line 200 pins to `chainData.data` — always the
   *   `{ toolName, config }` object built in getListOfPrepareFunctions — or to
   *   `{}`. It is never nullish, so dropping `?.` cannot change anything.
   * L699 `this.factory === null` (3 mutants): all three call sites run after line
   *   166 assigned the factory — toolPrepareMethodSuccess/Fallback from inside
   *   prepare's queue, and updateToolConfig only past a registration check that no
   *   tool can pass before prepare filled the collections. Confirmed by triage:
   *   line 700 provably never executes, so the throw is unreachable.
   *
   * The two pairs at L181/L189 and the L691 `typeof` check are NOT equivalent —
   * they are killed by the "prepare metadata guard" tests above. A tool's
   * `prepare` receives the very object `handlePrepareSuccess` reads back, so it
   * can leave a non-primitive name-like value there. Two traps met on the way:
   * a plain number is invisible (the twin guard at L189 swallows the resulting
   * TypeError, and the queue's `completed` getter reads `failure` before the
   * catch handler sets it, so prepare() resolves anyway), and the value must
   * coerce back to a registered name or `factory.get` throws instead of
   * registering.
   */
});

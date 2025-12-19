import { describe, it, expect, beforeEach } from 'vitest';
import { Tools } from '../../../../src/components/modules/tools';
import { BlockToolAdapter } from '../../../../src/components/tools/block';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { ModuleConfig } from '../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../types';
import type { ToolConstructable } from '../../../../types/tools';
import type { BlokEventMap } from '../../../../src/components/events';

/**
 * Creates a Tools module instance with provided blok config.
 * @param config - optional blok configuration
 */
const createModule = (config?: BlokConfig): Tools => {
  const blokConfig: BlokConfig = config ?? {
    tools: {},
  };

  const moduleConfig: ModuleConfig = {
    config: blokConfig,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  };

  const module = new Tools(moduleConfig);

  const APIMethods = {
    method(): void {},
  };

  const blokModules = {
    API: {
      getMethodsForTool(): typeof APIMethods {
        return APIMethods;
      },
    },
  } as unknown as BlokModules;

  module.state = blokModules;

  return module;
};

describe('tools module', () => {
  describe('.prepare()', () => {
    it('resolves without errors when tools config is valid', async () => {
      const module = createModule();

      await expect(module.prepare()).resolves.toBeUndefined();
    });

    it('throws when tool configuration is corrupted', async () => {
      const module = createModule({
        tools: {
          corruptedTool: 'value' as unknown as ToolConstructable,
        },
      });

      await expect(module.prepare()).rejects.toThrowError(Error);
    });

    it('calls a tool prepare method with user config', async () => {
      /**
       *
       */
      class WithSuccessfulPrepare {
        public static calls: Array<{ toolName: string; config: unknown }> = [];

        /**
         * Forwards tool name and config to tool-level prepare handler.
         * @param data object containing tool identifier and its configuration
         */
        public static prepare(data: { toolName: string; config: unknown }): void {
          this.calls.push(data);
        }
      }

      const config = {
        property: 'value',
      };

      const module = createModule({
        defaultBlock: 'withSuccessfulPrepare',
        tools: {
          withSuccessfulPrepare: {
            class: WithSuccessfulPrepare as unknown as ToolConstructable,
            config,
          },
        },
      });

      WithSuccessfulPrepare.calls = [];

      await module.prepare();

      expect(WithSuccessfulPrepare.calls).toStrictEqual([
        {
          toolName: 'withSuccessfulPrepare',
          config,
        },
      ]);
    });
  });

  describe('collection accessors', () => {
    let module: Tools;

    beforeEach(async () => {
      /**
       *
       */
      class InlineTool {
        public static isInline = true;

        /**
         *
         */
        public render(): object {
          return {};
        }
      }

      /**
       *
       */
      class InlineTool2 {
        public static isInline = true;

        /**
         *
         */
        public render(): object {
          return {};
        }
      }

      /**
       *
       */
      class UnavailableInlineTool {
        public static isInline = true;
      }

      /**
       *
       */
      class WithSuccessfulPrepare {
        /**
         *
         */
        public static prepare(): void {}
      }

      /**
       *
       */
      class WithFailedPrepare {
        /**
         *
         */
        public static prepare(): void {
          throw new Error();
        }
      }

      /**
       *
       */
      class UnavailableBlockTune {
        public static isTune = true;

        /**
         *
         */
        public static prepare(): void {
          throw new Error();
        }
      }

      /**
       *
       */
      class BasicBlockTool {
        /**
         *
         */
        public render(): HTMLElement {
          const element = document.createElement('div');

          element.contentEditable = 'true';

          return element;
        }

        /**
         *
         */
        public save(): void {}
      }

      /**
       *
       */
      class BlockToolWithoutSettings extends BasicBlockTool {}

      /**
       *
       */
      class BlockToolWithInline extends BasicBlockTool {}

      const moduleInstance = createModule({
        defaultBlock: 'withoutPrepare',
        tools: {
          withSuccessfulPrepare: {
            class: WithSuccessfulPrepare as unknown as ToolConstructable,
            inlineToolbar: [ 'inlineTool2' ],
            tunes: [ 'blockTune2' ],
          },
          withFailedPrepare: WithFailedPrepare as unknown as ToolConstructable,
          withoutPrepare: {
            class: BlockToolWithoutSettings as unknown as ToolConstructable,
            inlineToolbar: false,
            tunes: false,
          },
          blockTool: {
            class: BlockToolWithInline as unknown as ToolConstructable,
            inlineToolbar: true,
          },
          blockToolWithoutSettings: BlockToolWithoutSettings as unknown as ToolConstructable,
          inlineTool: InlineTool as unknown as ToolConstructable,
          inlineTool2: InlineTool2 as unknown as ToolConstructable,
          unavailableInlineTool: UnavailableInlineTool as unknown as ToolConstructable,
          blockTune: class {
            public static isTune = true;
          } as unknown as ToolConstructable,
          blockTune2: class {
            public static isTune = true;
          } as unknown as ToolConstructable,
          unavailableBlockTune: UnavailableBlockTune as unknown as ToolConstructable,
        },
        inlineToolbar: ['inlineTool2', 'inlineTool'],
        tunes: ['blockTune2', 'blockTune'],
      });

      await moduleInstance.prepare();

      module = moduleInstance;
    });

    it('.available returns only ready to use tools', () => {
      expect(module.available).toBeInstanceOf(Map);
      expect(module.available.has('withSuccessfulPrepare')).toBe(true);
      expect(module.available.has('withoutPrepare')).toBe(true);
      expect(module.available.has('withFailedPrepare')).toBe(false);
      expect(module.available.has('unavailableInlineTool')).toBe(false);
    });

    it('.unavailable returns tools that failed preparation', () => {
      expect(module.unavailable).toBeInstanceOf(Map);
      expect(module.unavailable.has('withSuccessfulPrepare')).toBe(false);
      expect(module.unavailable.has('withoutPrepare')).toBe(false);
      expect(module.unavailable.has('withFailedPrepare')).toBe(true);
      expect(module.unavailable.has('unavailableInlineTool')).toBe(true);
    });

    it('.inlineTools contains only available inline tools', () => {
      expect(module.inlineTools).toBeInstanceOf(Map);
      expect(module.inlineTools.has('inlineTool')).toBe(true);
      expect(module.inlineTools.has('unavailableInlineTool')).toBe(false);
      expect(Array.from(module.inlineTools.values()).every(tool => tool.isInline())).toBe(true);
    });

    it('.blockTools contains only available block tools', () => {
      expect(module.blockTools).toBeInstanceOf(Map);
      expect(module.blockTools.has('withSuccessfulPrepare')).toBe(true);
      expect(module.blockTools.has('withoutPrepare')).toBe(true);
      expect(module.blockTools.has('withFailedPrepare')).toBe(false);
      expect(Array.from(module.blockTools.values()).every(tool => tool.isBlock())).toBe(true);
    });

    it('block tools without settings contain default tunes', () => {
      const tool = module.blockTools.get('blockToolWithoutSettings');

      expect(tool?.tunes.has('delete')).toBe(true);
    });

    it('block tools contain default tunes', () => {
      const tool = module.blockTools.get('blockTool');

      expect(tool?.tunes.has('delete')).toBe(true);
    });

    it('block tools include tunes in the correct order', () => {
      const toolWithInline = module.blockTools.get('blockTool');
      const tunesOrder = Array.from(toolWithInline?.tunes.keys() ?? []);

      expect(toolWithInline?.tunes.has('blockTune')).toBe(true);
      expect(toolWithInline?.tunes.has('blockTune2')).toBe(true);
      expect(tunesOrder).toStrictEqual(['blockTune2', 'blockTune', 'delete']);

      const toolWithSuccessfulPrepare = module.blockTools.get('withSuccessfulPrepare');

      expect(toolWithSuccessfulPrepare?.tunes.has('blockTune')).toBe(false);
      expect(toolWithSuccessfulPrepare?.tunes.has('blockTune2')).toBe(true);

      const toolWithoutPrepare = module.blockTools.get('withoutPrepare');

      expect(toolWithoutPrepare?.tunes.has('blockTune')).toBe(false);
      expect(toolWithoutPrepare?.tunes.has('blockTune2')).toBe(false);
    });

    it('block tools include inline tools in the correct order', () => {
      const toolWithInline = module.blockTools.get('blockTool');
      const inlineToolsOrder = Array.from(toolWithInline?.inlineTools.keys() ?? []);

      expect(toolWithInline?.inlineTools.has('inlineTool')).toBe(true);
      expect(toolWithInline?.inlineTools.has('inlineTool2')).toBe(true);
      expect(inlineToolsOrder).toStrictEqual(['inlineTool2', 'inlineTool']);

      const toolWithSuccessfulPrepare = module.blockTools.get('withSuccessfulPrepare');

      expect(toolWithSuccessfulPrepare?.inlineTools.has('inlineTool')).toBe(false);
      expect(toolWithSuccessfulPrepare?.inlineTools.has('inlineTool2')).toBe(true);

      const toolWithoutPrepare = module.blockTools.get('withoutPrepare');

      expect(toolWithoutPrepare?.inlineTools.has('inlineTool')).toBe(false);
      expect(toolWithoutPrepare?.inlineTools.has('inlineTool2')).toBe(false);
    });

    it('.blockTunes contains only available block tunes', () => {
      expect(module.blockTunes).toBeInstanceOf(Map);
      expect(module.blockTunes.has('blockTune')).toBe(true);
      expect(module.blockTunes.has('unavailableBlockTune')).toBe(false);
      expect(Array.from(module.blockTunes.values()).every(tool => tool.isTune())).toBe(true);
    });

    it('.internal contains only internal tools', () => {
      expect(module.internal).toBeInstanceOf(Map);
      expect(Array.from(module.internal.values()).every(tool => tool.isInternal)).toBe(true);
    });

    it('.defaultTool returns a block tool adapter for the default tool', () => {
      expect(module.defaultTool).toBeInstanceOf(BlockToolAdapter);
      expect(module.defaultTool.isDefault).toBe(true);
    });
  });

  describe('.getAllInlineToolsSanitizeConfig()', () => {
    it('returns merged inline tool sanitize configuration', async () => {
      /**
       *
       */
      class InlineToolWithSanitize {
        public static isInline = true;

        public static sanitize = {
          span: {
            class: true,
          },
        };

        /**
         *
         */
        public render(): object {
          return {};
        }
      }

      /**
       *
       */
      class AnotherInlineToolWithSanitize {
        public static isInline = true;

        public static sanitize = {
          mark: {
            style: true,
          },
        };

        /**
         *
         */
        public render(): object {
          return {};
        }
      }

      const module = createModule({
        tools: {
          inlineToolOne: InlineToolWithSanitize as unknown as ToolConstructable,
          inlineToolTwo: AnotherInlineToolWithSanitize as unknown as ToolConstructable,
        },
        inlineToolbar: ['inlineToolOne', 'inlineToolTwo'],
      });

      await module.prepare();

      const sanitizeConfig = module.getAllInlineToolsSanitizeConfig();

      expect(sanitizeConfig).toMatchObject({
        span: {
          class: true,
        },
        mark: {
          style: true,
        },
      });

      expect(module.getAllInlineToolsSanitizeConfig()).toBe(sanitizeConfig);
    });
  });

  describe('.destroy()', () => {
    it('calls reset on all available tools', async () => {
      /**
       *
       */
      class AsyncResetBlockTool {
        public static calls = 0;

        /**
         *
         */
        public static reset(): Promise<void> {
          this.calls += 1;

          return Promise.resolve();
        }
      }

      const module = createModule({
        tools: {
          asyncResetTool: AsyncResetBlockTool as unknown as ToolConstructable,
        },
      });

      await module.prepare();

      AsyncResetBlockTool.calls = 0;

      module.destroy();

      expect(AsyncResetBlockTool.calls).toBe(1);
    });

    it('handles errors raised during tool reset', async () => {
      /**
       *
       */
      class ThrowingBlockTool {
        public static wasResetCalled = false;

        /**
         *
         */
        public static reset(): void {
          this.wasResetCalled = true;

          throw new Error('reset failure');
        }
      }

      /**
       *
       */
      class RejectingBlockTool {
        /**
         *
         */
        public static reset(): Promise<void> {
          return Promise.reject(new Error('async reset failure'));
        }
      }

      const module = createModule({
        tools: {
          throwing: ThrowingBlockTool as unknown as ToolConstructable,
          rejecting: RejectingBlockTool as unknown as ToolConstructable,
        },
      });

      await module.prepare();

      let unhandledRejection: unknown;
      const handleUnhandledRejection = (reason: unknown): void => {
        unhandledRejection = reason;
      };

      process.on('unhandledRejection', handleUnhandledRejection);

      expect(() => module.destroy()).not.toThrow();

      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });

      process.off('unhandledRejection', handleUnhandledRejection);

      expect(unhandledRejection).toBeUndefined();
      expect(ThrowingBlockTool.wasResetCalled).toBe(true);
    });
  });
});


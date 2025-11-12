/* eslint-disable @typescript-eslint/no-explicit-any, jsdoc/require-jsdoc */
import { expect, test } from '@playwright/test';
import Tools from '../../../../src/components/modules/tools';
import BlockToolAdapter from '../../../../src/components/tools/block';
import type { EditorModules } from '../../../../src/types-internal/editor-modules';
import type { ModuleConfig } from '../../../../src/types-internal/module-config';
import type { EditorConfig } from '../../../../types';

const createModule = (config?: EditorConfig): Tools => {
  const moduleConfig: EditorConfig = config ?? {
    tools: {},
  };

  const module = new Tools({
    config: moduleConfig,
    eventsDispatcher: {},
  } as unknown as ModuleConfig);

  const APIMethods = {
    method(): void {},
  };

  const editorModules = {
    API: {
      getMethodsForTool(): typeof APIMethods {
        return APIMethods;
      },
    },
  } as unknown as EditorModules;

  module.state = editorModules;

  return module;
};

test.describe('tools module', () => {
  test.describe('.prepare()', () => {
    test('resolves without errors when tools config is valid', async () => {
      const module = createModule();

      await expect(module.prepare()).resolves.toBeUndefined();
    });

    test('throws when tool configuration is corrupted', async () => {
      const module = createModule({
        tools: {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore misconfigured tool
          corruptedTool: 'value',
        },
      });

      await expect(module.prepare()).rejects.toThrowError(Error);
    });

    test('calls a tool prepare method with user config', async () => {
      class WithSuccessfulPrepare {
        public static calls: Array<{ toolName: string; config: unknown }> = [];

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
            class: WithSuccessfulPrepare as unknown as any,
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

  test.describe('collection accessors', () => {
    let module: Tools;

    test.beforeEach(async () => {
      class InlineTool {
        public static isInline = true;

        public render(): void {}

        public surround(): void {}

        public checkState(): void {}
      }

      class InlineTool2 {
        public static isInline = true;

        public render(): void {}

        public surround(): void {}

        public checkState(): void {}
      }

      class UnavailableInlineTool {
        public static isInline = true;
      }

      class WithSuccessfulPrepare {
        public static prepare(): void {}
      }

      class WithFailedPrepare {
        public static prepare(): void {
          throw new Error();
        }
      }

      class UnavailableBlockTune {
        public static isTune = true;

        public static prepare(): void {
          throw new Error();
        }
      }

      module = createModule({
        defaultBlock: 'withoutPrepare',
        tools: {
          withSuccessfulPrepare: {
            class: WithSuccessfulPrepare as unknown as any,
            inlineToolbar: [ 'inlineTool2' ],
            tunes: [ 'blockTune2' ],
          },
          withFailedPrepare: WithFailedPrepare as unknown as any,
          withoutPrepare: {
            class: class {} as unknown as any,
            inlineToolbar: false,
            tunes: false,
          },
          blockTool: {
            class: class {} as unknown as any,
            inlineToolbar: true,
          },
          blockToolWithoutSettings: class {} as unknown as any,
          inlineTool: InlineTool as unknown as any,
          inlineTool2: InlineTool2 as unknown as any,
          unavailableInlineTool: UnavailableInlineTool as unknown as any,
          blockTune: class {
            public static isTune = true;
          } as unknown as any,
          blockTune2: class {
            public static isTune = true;
          } as unknown as any,
          unavailableBlockTune: UnavailableBlockTune as unknown as any,
        },
        inlineToolbar: ['inlineTool2', 'inlineTool'],
        tunes: ['blockTune2', 'blockTune'],
      });

      await module.prepare();
    });

    test('.available returns only ready to use tools', () => {
      expect(module.available).toBeInstanceOf(Map);
      expect(module.available.has('withSuccessfulPrepare')).toBe(true);
      expect(module.available.has('withoutPrepare')).toBe(true);
      expect(module.available.has('withFailedPrepare')).toBe(false);
      expect(module.available.has('unavailableInlineTool')).toBe(false);
    });

    test('.unavailable returns tools that failed preparation', () => {
      expect(module.unavailable).toBeInstanceOf(Map);
      expect(module.unavailable.has('withSuccessfulPrepare')).toBe(false);
      expect(module.unavailable.has('withoutPrepare')).toBe(false);
      expect(module.unavailable.has('withFailedPrepare')).toBe(true);
      expect(module.unavailable.has('unavailableInlineTool')).toBe(true);
    });

    test('.inlineTools contains only available inline tools', () => {
      expect(module.inlineTools).toBeInstanceOf(Map);
      expect(module.inlineTools.has('inlineTool')).toBe(true);
      expect(module.inlineTools.has('unavailableInlineTool')).toBe(false);
      expect(Array.from(module.inlineTools.values()).every(tool => tool.isInline())).toBe(true);
    });

    test('.blockTools contains only available block tools', () => {
      expect(module.blockTools).toBeInstanceOf(Map);
      expect(module.blockTools.has('withSuccessfulPrepare')).toBe(true);
      expect(module.blockTools.has('withoutPrepare')).toBe(true);
      expect(module.blockTools.has('withFailedPrepare')).toBe(false);
      expect(Array.from(module.blockTools.values()).every(tool => tool.isBlock())).toBe(true);
    });

    test('block tools without settings contain default tunes', () => {
      const tool = module.blockTools.get('blockToolWithoutSettings');

      expect(tool?.tunes.has('delete')).toBe(true);
      expect(tool?.tunes.has('moveUp')).toBe(true);
      expect(tool?.tunes.has('moveDown')).toBe(true);
    });

    test('block tools contain default tunes', () => {
      const tool = module.blockTools.get('blockTool');

      expect(tool?.tunes.has('delete')).toBe(true);
      expect(tool?.tunes.has('moveUp')).toBe(true);
      expect(tool?.tunes.has('moveDown')).toBe(true);
    });

    test('block tools include tunes in the correct order', () => {
      const toolWithInline = module.blockTools.get('blockTool');
      const tunesOrder = Array.from(toolWithInline?.tunes.keys() ?? []);

      expect(toolWithInline?.tunes.has('blockTune')).toBe(true);
      expect(toolWithInline?.tunes.has('blockTune2')).toBe(true);
      expect(tunesOrder).toStrictEqual(['blockTune2', 'blockTune', 'moveUp', 'delete', 'moveDown']);

      const toolWithSuccessfulPrepare = module.blockTools.get('withSuccessfulPrepare');

      expect(toolWithSuccessfulPrepare?.tunes.has('blockTune')).toBe(false);
      expect(toolWithSuccessfulPrepare?.tunes.has('blockTune2')).toBe(true);

      const toolWithoutPrepare = module.blockTools.get('withoutPrepare');

      expect(toolWithoutPrepare?.tunes.has('blockTune')).toBe(false);
      expect(toolWithoutPrepare?.tunes.has('blockTune2')).toBe(false);
    });

    test('block tools include inline tools in the correct order', () => {
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

    test('.blockTunes contains only available block tunes', () => {
      expect(module.blockTunes).toBeInstanceOf(Map);
      expect(module.blockTunes.has('blockTune')).toBe(true);
      expect(module.blockTunes.has('unavailableBlockTune')).toBe(false);
      expect(Array.from(module.blockTunes.values()).every(tool => tool.isTune())).toBe(true);
    });

    test('.internal contains only internal tools', () => {
      expect(module.internal).toBeInstanceOf(Map);
      expect(Array.from(module.internal.values()).every(tool => tool.isInternal)).toBe(true);
    });

    test('.defaultTool returns a block tool adapter for the default tool', () => {
      expect(module.defaultTool).toBeInstanceOf(BlockToolAdapter);
      expect(module.defaultTool.isDefault).toBe(true);
    });
  });
});


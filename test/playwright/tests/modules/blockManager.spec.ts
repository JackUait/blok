import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import type { OutputData } from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';

type SerializableToolConfig = {
  className?: string;
  classCode?: string;
  config?: Record<string, unknown>;
};

type CreateEditorOptions = {
  data?: OutputData | null;
  tools?: Record<string, SerializableToolConfig>;
  config?: Record<string, unknown>;
};


declare global {
  interface Window {
    editorInstance?: EditorJS;
  }
}

const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holderId }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holderId)?.remove();

    const container = document.createElement('div');

    container.id = holderId;
    container.dataset.cy = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

const createEditor = async (page: Page, options: CreateEditorOptions = {}): Promise<void> => {
  const { data = null, tools = {}, config = {} } = options;

  await resetEditor(page);
  await page.waitForFunction(() => typeof window.EditorJS === 'function');

  const serializedTools = Object.entries(tools).map(([name, tool]) => {
    return {
      name,
      className: tool.className ?? null,
      classCode: tool.classCode ?? null,
      config: tool.config ?? {},
    };
  });

  await page.evaluate(
    async ({ holderId, data: initialData, serializedTools: toolsConfig, config: editorConfigOverrides }) => {
      const resolveToolClass = (
        toolConfig: { name?: string; className: string | null; classCode: string | null }
      ): unknown => {
        if (toolConfig.className) {
          const toolClass = (window as unknown as Record<string, unknown>)[toolConfig.className];

          if (toolClass) {
            return toolClass;
          }
        }

        if (toolConfig.classCode) {
          const revivedClassCode = toolConfig.classCode.trim().replace(/;+\s*$/, '');

          try {
            return window.eval?.(revivedClassCode) ?? eval(revivedClassCode);
          } catch (error) {
            throw new Error(
              `Failed to evaluate class code for tool "${toolConfig.name ?? 'unknown'}": ${(error as Error).message}`
            );
          }
        }

        return null;
      };

      const resolvedTools = toolsConfig.reduce<Record<string, Record<string, unknown>>>((accumulator, toolConfig) => {
        if (toolConfig.name === undefined) {
          return accumulator;
        }

        const toolClass = resolveToolClass(toolConfig);

        if (!toolClass) {
          throw new Error(`Tool "${toolConfig.name}" is not available globally`);
        }

        return {
          ...accumulator,
          [toolConfig.name]: {
            class: toolClass,
            ...toolConfig.config,
          },
        };
      }, {});

      const editorConfig: Record<string, unknown> = {
        holder: holderId,
        ...editorConfigOverrides,
        ...(initialData ? { data: initialData } : {}),
        ...(toolsConfig.length > 0 ? { tools: resolvedTools } : {}),
      };

      const editor = new window.EditorJS(editorConfig);

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
      data,
      serializedTools,
      config,
    }
  );
};

const createEditorWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await createEditor(page, {
    data: {
      blocks,
    },
  });
};

const saveEditor = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.editorInstance) {
      throw new Error('Editor instance not found');
    }

    return await window.editorInstance.save();
  });
};

test.describe('modules/blockManager', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('deletes the last block without adding fillers when other blocks remain', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        id: 'block1',
        type: 'paragraph',
        data: { text: 'First block' },
      },
      {
        id: 'block2',
        type: 'paragraph',
        data: { text: 'Second block' },
      },
    ]);

    await page.evaluate(async () => {
      if (!window.editorInstance) {
        throw new Error('Editor instance not found');
      }

      await window.editorInstance.blocks.delete(1);
    });

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect((blocks[0]?.data as { text: string }).text).toBe('First block');
  });

  test('replaces a single deleted block with a new default block', async ({ page }) => {
    const initialId = 'single-block';

    await createEditorWithBlocks(page, [
      {
        id: initialId,
        type: 'paragraph',
        data: { text: 'Only block' },
      },
    ]);

    await page.evaluate(async () => {
      if (!window.editorInstance) {
        throw new Error('Editor instance not found');
      }

      await window.editorInstance.blocks.delete(0);
    });

    // Check internal state because Saver.save() returns an empty array
    // if there is only one empty block in the editor.
    const block = await page.evaluate(async () => {
      if (!window.editorInstance) {
        throw new Error('Editor instance not found');
      }

      const firstBlock = window.editorInstance.blocks.getBlockByIndex(0);

      if (!firstBlock) {
        return null;
      }

      const savedData = await firstBlock.save();

      return {
        id: firstBlock.id,
        data: savedData?.data,
      };
    });

    expect(block).not.toBeNull();
    expect(block?.id).not.toBe(initialId);
    expect((block?.data as { text?: string }).text ?? '').toBe('');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(0);
  });

  test('converts a block to a compatible tool via API', async ({ page }) => {
    const CONVERTABLE_SOURCE_TOOL = `(() => {
      return class ConvertableSourceTool {
        constructor({ data }) {
          this.data = data || {};
        }

        static get toolbox() {
          return { icon: '', title: 'Convertible Source' };
        }

        static get conversionConfig() {
          return {
            export: (data) => data.text ?? '',
          };
        }

        render() {
          const element = document.createElement('div');

          element.contentEditable = 'true';
          element.innerHTML = this.data.text ?? '';

          return element;
        }

        save(element) {
          return { text: element.innerHTML };
        }
      };
    })();`;

    const CONVERTABLE_TARGET_TOOL = `(() => {
      return class ConvertableTargetTool {
        constructor({ data }) {
          this.data = data || {};
        }

        static get toolbox() {
          return { icon: '', title: 'Convertible Target' };
        }

        static get conversionConfig() {
          return {
            import: (content) => ({ text: content.toUpperCase() }),
          };
        }

        render() {
          const element = document.createElement('div');

          element.contentEditable = 'true';
          element.innerHTML = this.data.text ?? '';

          return element;
        }

        save(element) {
          return { text: element.innerHTML };
        }
      };
    })();`;

    await createEditor(page, {
      tools: {
        convertibleSource: {
          classCode: CONVERTABLE_SOURCE_TOOL,
        },
        convertibleTarget: {
          classCode: CONVERTABLE_TARGET_TOOL,
        },
      },
      data: {
        blocks: [
          {
            id: 'source-block',
            type: 'convertibleSource',
            data: { text: 'convert me' },
          },
        ],
      },
      config: {
        defaultBlock: 'convertibleSource',
      },
    });

    await page.evaluate(async () => {
      if (!window.editorInstance) {
        throw new Error('Editor instance not found');
      }

      await window.editorInstance.blocks.convert('source-block', 'convertibleTarget');
    });

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('convertibleTarget');
    expect((blocks[0]?.data as { text?: string }).text).toBe('CONVERT ME');
  });

  test('fails conversion when target tool lacks conversionConfig', async ({ page }) => {
    const CONVERTABLE_SOURCE_TOOL = `(() => {
      return class ConvertableSourceTool {
        constructor({ data }) {
          this.data = data || {};
        }

        static get toolbox() {
          return { icon: '', title: 'Convertible Source' };
        }

        static get conversionConfig() {
          return {
            export: (data) => data.text ?? '',
          };
        }

        render() {
          const element = document.createElement('div');

          element.contentEditable = 'true';
          element.innerHTML = this.data.text ?? '';

          return element;
        }

        save(element) {
          return { text: element.innerHTML };
        }
      };
    })();`;

    const TOOL_WITHOUT_CONVERSION = `(() => {
      return class ToolWithoutConversionConfig {
        constructor({ data }) {
          this.data = data || {};
        }

        render() {
          const element = document.createElement('div');

          element.contentEditable = 'true';
          element.innerHTML = this.data.text ?? '';

          return element;
        }

        save(element) {
          return { text: element.innerHTML };
        }
      };
    })();`;

    await createEditor(page, {
      tools: {
        convertibleSource: {
          classCode: CONVERTABLE_SOURCE_TOOL,
        },
        withoutConversion: {
          classCode: TOOL_WITHOUT_CONVERSION,
        },
      },
      data: {
        blocks: [
          {
            id: 'non-convertable',
            type: 'convertibleSource',
            data: { text: 'stay text' },
          },
        ],
      },
      config: {
        defaultBlock: 'convertibleSource',
      },
    });

    const errorMessage = await page.evaluate(async () => {
      if (!window.editorInstance) {
        throw new Error('Editor instance not found');
      }

      try {
        await window.editorInstance.blocks.convert('non-convertable', 'withoutConversion');

        return null;
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(errorMessage).toContain('Conversion from "convertibleSource" to "withoutConversion" is not possible');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('convertibleSource');
    expect((blocks[0]?.data as { text?: string }).text).toBe('stay text');
  });


  test('generates unique ids for newly inserted blocks', async ({ page }) => {
    await createEditor(page);

    const blockCount = await page.evaluate(async () => {
      if (!window.editorInstance) {
        throw new Error('Editor instance not found');
      }

      const firstBlock = window.editorInstance.blocks.getBlockByIndex?.(0);

      if (!firstBlock) {
        throw new Error('Initial block not found');
      }

      await window.editorInstance.blocks.update(firstBlock.id, { text: 'First block' });
      window.editorInstance.blocks.insert('paragraph', { text: 'Second block' });
      window.editorInstance.blocks.insert('paragraph', { text: 'Third block' });

      return window.editorInstance.blocks.getBlocksCount?.() ?? 0;
    });

    expect(blockCount).toBe(3);

    const { blocks } = await saveEditor(page);
    const ids = blocks.map((block) => block.id);

    expect(blocks).toHaveLength(3);
    ids.forEach((id, index) => {
      if (id === undefined) {
        throw new Error(`Block id at index ${index} is undefined`);
      }

      expect(typeof id).toBe('string');
      expect(id).not.toHaveLength(0);
    });
    expect(new Set(ids).size).toBe(ids.length);
  });
});

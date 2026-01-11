import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok';

type SerializableToolConfig = {
  className?: string;
  classCode?: string;
  config?: Record<string, unknown>;
};

type CreateBlokOptions = {
  data?: OutputData | null;
  tools?: Record<string, SerializableToolConfig>;
  config?: Record<string, unknown>;
};


declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  const { data = null, tools = {}, config = {} } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  const serializedTools = Object.entries(tools).map(([name, tool]) => {
    return {
      name,
      className: tool.className ?? null,
      classCode: tool.classCode ?? null,
      config: tool.config ?? {},
    };
  });

  await page.evaluate(
    async ({ holder, data: initialData, serializedTools: toolsConfig, config: blokConfigOverrides }) => {
      const resolveToolClass = (
        toolConfig: { name?: string; className: string | null; classCode: string | null }
      ): unknown => {
        if (toolConfig.className) {
          // Handle dot notation (e.g., 'Blok.Header')
          const toolClass = toolConfig.className.split('.').reduce(
            (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
            window
          );

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

      const blokConfig: Record<string, unknown> = {
        holder: holder,
        ...blokConfigOverrides,
        ...(initialData ? { data: initialData } : {}),
        ...(toolsConfig.length > 0 ? { tools: resolvedTools } : {}),
      };

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      data,
      serializedTools,
      config,
    }
  );
};

const createBlokWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await createBlok(page, {
    data: {
      blocks,
    },
  });
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });
};

test.describe('modules/blockManager', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('@smoke deletes the last block without adding fillers when other blocks remain', async ({ page }) => {
    await createBlokWithBlocks(page, [
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
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      await window.blokInstance.blocks.delete(1);
    });

    const { blocks } = await saveBlok(page);

    expect(blocks).toHaveLength(1);
    expect((blocks[0]?.data as { text: string }).text).toBe('First block');
  });

  test('replaces a single deleted block with a new default block', async ({ page }) => {
    const initialId = 'single-block';

    await createBlokWithBlocks(page, [
      {
        id: initialId,
        type: 'paragraph',
        data: { text: 'Only block' },
      },
    ]);

    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      await window.blokInstance.blocks.delete(0);
    });

    // Check internal state because Saver.save() returns an empty array
    // if there is only one empty block in the blok.
    const block = await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const firstBlock = window.blokInstance.blocks.getBlockByIndex(0);

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

    const { blocks } = await saveBlok(page);

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

    await createBlok(page, {
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
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      await window.blokInstance.blocks.convert('source-block', 'convertibleTarget');
    });

    const { blocks } = await saveBlok(page);

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

    await createBlok(page, {
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
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      try {
        await window.blokInstance.blocks.convert('non-convertable', 'withoutConversion');

        return null;
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(errorMessage).toContain('Conversion from "convertibleSource" to "withoutConversion" is not possible');

    const { blocks } = await saveBlok(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('convertibleSource');
    expect((blocks[0]?.data as { text?: string }).text).toBe('stay text');
  });


  test('generates unique ids for newly inserted blocks', async ({ page }) => {
    await createBlok(page);

    const blockCount = await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const firstBlock = window.blokInstance.blocks.getBlockByIndex?.(0);

      if (!firstBlock) {
        throw new Error('Initial block not found');
      }

      await window.blokInstance.blocks.update(firstBlock.id, { text: 'First block' });
      window.blokInstance.blocks.insert('paragraph', { text: 'Second block' });
      window.blokInstance.blocks.insert('paragraph', { text: 'Third block' });

      return window.blokInstance.blocks.getBlocksCount?.() ?? 0;
    });

    expect(blockCount).toBe(3);

    const { blocks } = await saveBlok(page);
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

  test('updates currentBlockIndex when clicking on a different block', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        id: 'block-0',
        type: 'paragraph',
        data: { text: 'First block' },
      },
      {
        id: 'block-1',
        type: 'paragraph',
        data: { text: 'Second block' },
      },
    ]);

    // Click on the first block to establish currentBlockIndex at 0
    await page.getByText('First block').click();

    const initialIndex = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      // Access internal module to check currentBlockIndex
      const blok = window.blokInstance as unknown as { module: { blockManager: { currentBlockIndex: number } } };

      return blok.module.blockManager.currentBlockIndex;
    });

    expect(initialIndex).toBe(0);

    // Click on second block to move focus
    await page.getByText('Second block').click();

    // Verify currentBlockIndex updated to 1
    const updatedIndex = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const blok = window.blokInstance as unknown as { module: { blockManager: { currentBlockIndex: number } } };

      return blok.module.blockManager.currentBlockIndex;
    });

    expect(updatedIndex).toBe(1);
  });

  test('updates currentBlockIndex when navigating blocks with Tab key', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        id: 'tab-block-0',
        type: 'paragraph',
        data: { text: 'First block' },
      },
      {
        id: 'tab-block-1',
        type: 'paragraph',
        data: { text: 'Second block' },
      },
    ]);

    // Click on first block to ensure focus
    await page.getByText('First block').click();

    const initialIndex = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const blok = window.blokInstance as unknown as { module: { blockManager: { currentBlockIndex: number } } };

      return blok.module.blockManager.currentBlockIndex;
    });

    expect(initialIndex).toBe(0);

    // Press Tab to move to next block
    await page.keyboard.press('Tab');

    // Wait for focus change to propagate by polling the index
    await expect(async () => {
      const updatedIndex = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const blok = window.blokInstance as unknown as { module: { blockManager: { currentBlockIndex: number } } };

        return blok.module.blockManager.currentBlockIndex;
      });

      expect(updatedIndex).toBe(1);
    }).toPass();
  });
});

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { nanoid } from 'nanoid';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BlockChangedMutationType } from '../../../../types/events/block/BlockChanged';
import type { BlockMutationEvent } from '../../../../types';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok-';
const BLOCK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const getBlockWrapperSelectorByIndex = (index: number): string => {
  return `:nth-match(${BLOCK_WRAPPER_SELECTOR}, ${index + 1})`;
};

type ToolDefinition = {
  name: string;
  classSource: string;
  config?: Record<string, unknown>;
};

type BlokSetupOptions = {
  data?: Record<string, unknown>;
  config?: Record<string, unknown>;
  tools?: ToolDefinition[];
  tunes?: string[];
  onChange?: boolean; // If true, track onChange events in window.onChangeEvents
};

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

const createBlok = async (page: Page, options: BlokSetupOptions = {}): Promise<void> => {
  const { data, config, tools = [], tunes, onChange } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  // Initialize onChange tracking in window if onChange callback is provided
  if (onChange) {
    await page.evaluate(() => {
      (window as unknown as { onChangeEvents?: unknown[]; onChangeCalled?: boolean }).onChangeEvents = [];
      (window as unknown as { onChangeEvents?: unknown[]; onChangeCalled?: boolean }).onChangeCalled = false;
    });
  }

  await page.evaluate(
    async ({ holder, rawData, rawConfig, serializedTools, tunes: tunesArray, hasOnChange }) => {
      const reviveToolClass = (classSource: string): unknown => {
        return new Function(`return (${classSource});`)();
      };

      const revivedTools = serializedTools.reduce<Record<string, Record<string, unknown>>>((accumulator, toolConfig) => {
        const revivedClass = reviveToolClass(toolConfig.classSource);

        const toolSettings: Record<string, unknown> = {
          class: revivedClass,
        };

        if (toolConfig.config !== undefined) {
          toolSettings.config = toolConfig.config;
        }

        return {
          ...accumulator,
          [toolConfig.name]: toolSettings,
        };
      }, {});

      const blokConfig: Record<string, unknown> = {
        holder: holder,
        ...rawConfig,
        ...(serializedTools.length > 0 ? { tools: revivedTools } : {}),
        ...(rawData ? { data: rawData } : {}),
      };

      if (tunesArray && tunesArray.length > 0) {
        blokConfig.tunes = tunesArray;
      }

      if (hasOnChange) {
        blokConfig.onChange = (api: unknown, event: unknown) => {
          const windowObj = window as unknown as { onChangeEvents?: unknown[]; onChangeCalled?: boolean };

          if (windowObj.onChangeEvents) {
            windowObj.onChangeEvents.push(event);
            windowObj.onChangeCalled = true;
          }
        };
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      rawData: data ?? null,
      rawConfig: config ?? {},
      serializedTools: tools,
      tunes: tunes ?? [],
      hasOnChange: onChange !== undefined,
    }
  );
};

const focusBlockByIndex = async (page: Page, index: number = 0): Promise<void> => {
  await page.evaluate(({ blockIndex }) => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    const didSetCaret = window.blokInstance.caret.setToBlock(blockIndex);
    if (!didSetCaret) {
      throw new Error(`Failed to set caret to block at index ${blockIndex}`);
    }
  }, { blockIndex: index });
};

const openBlockSettings = async (page: Page, index: number = 0): Promise<void> => {
  await focusBlockByIndex(page, index);

  const block = page.locator(getBlockWrapperSelectorByIndex(index));

  await block.scrollIntoViewIfNeeded();
  await block.click();
  await block.hover();

  const settingsButton = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`);

  await settingsButton.waitFor({ state: 'visible' });
  await settingsButton.click();
};


/**
 * There will be described test cases of 'blocks.*' API
 */
test.describe('api.blocks', () => {
  const firstBlock = {
    id: 'bwnFX5LoX7',
    type: 'paragraph',
    data: {
      text: 'The first block content mock.',
    },
  };
  const blokDataMock = {
    blocks: [
      firstBlock,
    ],
  };

  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  /**
   * api.blocks.getById(id)
   */
  test.describe('.getById()', () => {
    /**
     * Check that api.blocks.getById(id) returns the Block for existed id
     */
    test('should return Block API for existed id', async ({ page }) => {
      await createBlok(page, {
        data: blokDataMock,
      });

      const result = await page.evaluate(({ blockId }) => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const block = window.blokInstance.blocks.getById(blockId);
        return {
          blockExists: block !== null && block !== undefined,
          blockId: block?.id,
        };
      }, { blockId: firstBlock.id });

      expect(result.blockExists).toBe(true);
      expect(result.blockId).toBe(firstBlock.id);
    });

    /**
     * Check that api.blocks.getById(id) returns null for the not-existed id
     */
    test('should return null for not-existed id', async ({ page }) => {
      await createBlok(page, {
        data: blokDataMock,
      });

      const result = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        return window.blokInstance.blocks.getById('not-existed-id');
      });

      expect(result).toBeNull();
    });
  });

  test.describe('.renderFromHTML()', () => {
    test('should clear existing content and render provided HTML string', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'initial content' },
            },
          ],
        },
      });

      await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        await window.blokInstance.blocks.renderFromHTML('<p>Rendered from HTML</p>');
      });

      const blocks = page.locator(BLOCK_WRAPPER_SELECTOR);

      await expect(blocks).toHaveCount(1);
      await expect(blocks).toHaveText([ 'Rendered from HTML' ]);

      const savedData = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        return await window.blokInstance.save();
      });

      expect(savedData.blocks).toHaveLength(1);
      expect(savedData.blocks[0].type).toBe('paragraph');
      expect(savedData.blocks[0].data.text).toBe('Rendered from HTML');
    });
  });

  test.describe('.composeBlockData()', () => {
    const PREFILLED_TOOL_SOURCE = `class PrefilledTool {
      constructor({ data }) {
        this.initialData = {
          text: data.text ?? 'Composed paragraph',
        };
      }

      static get toolbox() {
        return {
          icon: 'P',
          title: 'Prefilled',
        };
      }

      render() {
        const element = document.createElement('div');
        element.contentEditable = 'true';
        element.innerHTML = this.initialData.text;

        return element;
      }

      save() {
        return this.initialData;
      }
    }`;

    test('should compose default block data for an existing tool', async ({ page }) => {
      await createBlok(page, {
        tools: [
          {
            name: 'prefilled',
            classSource: PREFILLED_TOOL_SOURCE,
          },
        ],
      });

      const data = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        return await window.blokInstance.blocks.composeBlockData('prefilled');
      });

      expect(data).toStrictEqual({ text: 'Composed paragraph' });
    });

    test('should throw when tool is not registered', async ({ page }) => {
      await createBlok(page);

      const error = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        try {
          await window.blokInstance.blocks.composeBlockData('missing-tool');
          return null;
        } catch (err) {
          return {
            message: (err as Error).message,
          };
        }
      });

      expect(error?.message).toBe('Block Tool with type "missing-tool" not found');
    });
  });

  /**
   * api.blocks.update(id, newData)
   */
  test.describe('.update()', () => {
    /**
     * Check if block is updated in DOM
     */
    test('should update block in DOM', async ({ page }) => {
      await createBlok(page, {
        data: blokDataMock,
      });

      const idToUpdate = firstBlock.id;
      const newBlockData = {
        text: 'Updated text',
      };

      await page.evaluate(async ({ id, newData }) => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        await window.blokInstance.blocks.update(id, newData);
      }, { id: idToUpdate,
        newData: newBlockData });

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveText(newBlockData.text);
    });

    /**
     * Check if block's data is updated after saving
     */
    test('should update block in saved data', async ({ page }) => {
      await createBlok(page, {
        data: blokDataMock,
      });

      const idToUpdate = firstBlock.id;
      const newBlockData = {
        text: 'Updated text',
      };

      await page.evaluate(async ({ id, newData }) => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        await window.blokInstance.blocks.update(id, newData);
      }, { id: idToUpdate,
        newData: newBlockData });

      // wait for async hydration - wait for DOM to reflect the update
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveText(newBlockData.text);

      const output = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        return await window.blokInstance.save();
      });

      const text = output.blocks[0].data.text;

      expect(text).toBe(newBlockData.text);
    });

    test('should update tune data when it is provided', async ({ page }) => {
      /**
       * Example Tune Class
       */
      const EXAMPLE_TUNE_SOURCE = `class ExampleTune {
        constructor({ data }) {
          this.data = data;
        }

        static get isTune() {
          return true;
        }

        static get CSS() {
          return {};
        }

        render() {
          return document.createElement('div');
        }

        save() {
          return this.data ?? '';
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: 'exampleTune',
            classSource: EXAMPLE_TUNE_SOURCE,
          },
        ],
        tunes: [ 'exampleTune' ],
        data: {
          blocks: [
            {
              id: nanoid(),
              type: 'paragraph',
              data: {
                text: 'First block',
              },
              tunes: {
                exampleTune: 'citation',
              },
            },
          ],
        },
      });

      // Update the tunes data of a block
      // Check if it is updated
      const data = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const block = window.blokInstance.blocks.getBlockByIndex(0);
        if (!block) {
          throw new Error('Block at index 0 not found');
        }

        await window.blokInstance.blocks.update(block.id, undefined, {
          exampleTune: 'test',
        });

        return await window.blokInstance.save();
      });

      const actual = JSON.stringify(data.blocks[0].tunes);
      const expected = JSON.stringify({ exampleTune: 'test' });

      expect(actual).toBe(expected);
    });

    /**
     * When incorrect id passed, blok should not update any block
     */
    test('shouldn\'t update any block if not-existed id passed', async ({ page }) => {
      await createBlok(page, {
        data: blokDataMock,
      });

      const idToUpdate = 'wrong-id-123';
      const newBlockData = {
        text: 'Updated text',
      };

      const error = await page.evaluate(async ({ id, newData }) => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        try {
          await window.blokInstance.blocks.update(id, newData);

          return null;
        } catch (err) {
          return {
            message: (err as Error).message,
          };
        }
      }, { id: idToUpdate,
        newData: newBlockData }).catch(() => null);

      expect(error?.message).toBe(`Block with id "${idToUpdate}" not found`);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveText(firstBlock.data.text);
    });
  });

  /**
   * api.blocks.insert(type, data, config, index, needToFocus, replace, id)
   */
  test.describe('.insert()', () => {
    test('should preserve block id if it is passed', async ({ page }) => {
      await createBlok(page, {
        data: blokDataMock,
      });

      const result = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const type = 'paragraph';
        const data = { text: 'blok' };
        const config = undefined;
        const index = undefined;
        const needToFocus = undefined;
        const replace = undefined;
        const id = 'test-id-123';

        const block = window.blokInstance.blocks.insert(type, data, config, index, needToFocus, replace, id);

        return {
          blockExists: block !== null && block !== undefined,
          blockId: block.id,
        };
      });

      expect(result.blockExists).toBe(true);
      expect(result.blockId).toBe('test-id-123');
    });
  });

  /**
   * api.blocks.insertMany(blocks, index)
   */
  test.describe('.insertMany()', () => {
    test('should insert several blocks to passed index', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'first block' },
            },
          ],
        },
      });

      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const index = 0;

        window.blokInstance.blocks.insertMany([
          {
            type: 'paragraph',
            data: { text: 'inserting block #1' },
          },
          {
            type: 'paragraph',
            data: { text: 'inserting block #2' },
          },
        ], index); // paste to the 0 index
      });

      const blocks = page.locator(BLOCK_WRAPPER_SELECTOR);

      await expect(blocks).toHaveText([
        'inserting block #1',
        'inserting block #2',
        'first block',
      ]);
    });
  });

  test.describe('.convert()', () => {
    test('should convert a Block to another type if original Tool has "conversionConfig.export" and target Tool has "conversionConfig.import". Should return BlockAPI as well.', async ({ page }) => {
      /**
       * Mock of Tool with conversionConfig
       */
      const CONVERTABLE_TOOL_SOURCE = `class ConvertableTool {
        constructor(options) {
          this.data = options.data;
        }

        static get conversionConfig() {
          return {
            import: 'text',
          };
        }

        static get toolbox() {
          return {
            icon: '',
            title: 'Convertable tool',
          };
        }

        render() {
          const contenteditable = document.createElement('div');

          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }

          contenteditable.contentEditable = 'true';

          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      const existingBlock = {
        id: 'test-id-123',
        type: 'paragraph',
        data: {
          text: 'Some text',
        },
      };

      await createBlok(page, {
        tools: [
          {
            name: 'convertableTool',
            classSource: CONVERTABLE_TOOL_SOURCE,
          },
        ],
        data: {
          blocks: [
            existingBlock,
          ],
        },
      });

      const convertedBlock = await page.evaluate(async ({ blockId }) => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const { convert } = window.blokInstance.blocks;
        const result = await convert(blockId, 'convertableTool');

        return {
          id: result?.id ?? null,
          name: result?.name ?? null,
        };
      }, { blockId: existingBlock.id });

      // wait for block to be converted - wait until saved data shows converted type
      await page.waitForFunction(async () => {
        if (!window.blokInstance) {
          return false;
        }

        const { blocks } = await window.blokInstance.save();
        return blocks.length > 0 && blocks[0].type === 'convertableTool';
      });

      /**
       * Check that block was converted
       */
      const { blocks } = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        return await window.blokInstance.save();
      });

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('convertableTool');
      expect(blocks[0].data.text).toBe(existingBlock.data.text);

      /**
       * Check that returned value is BlockAPI
       */
      expect(convertedBlock.name).toBe('convertableTool');
      expect(convertedBlock.id).toBe(blocks[0].id);
    });

    test('should throw an error if nonexisting Block id passed', async ({ page }) => {
      await createBlok(page, {});

      const error = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        /**
         * Call the 'convert' api method with nonexisting Block id
         */
        const fakeId = 'WRONG_ID';
        const { convert } = window.blokInstance.blocks;

        try {
          await convert(fakeId, 'convertableTool');

          return null;
        } catch (err) {
          return {
            message: (err as Error).message,
          };
        }
      });

      expect(error?.message).toBe(`Block with id "WRONG_ID" not found`);
    });

    test('should throw an error if nonexisting Tool name passed', async ({ page }) => {
      const existingBlock = {
        id: 'test-id-123',
        type: 'paragraph',
        data: {
          text: 'Some text',
        },
      };

      await createBlok(page, {
        data: {
          blocks: [
            existingBlock,
          ],
        },
      });

      const error = await page.evaluate(async ({ blockId }) => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        /**
         * Call the 'convert' api method with nonexisting tool name
         */
        const nonexistingToolName = 'WRONG_TOOL_NAME';
        const { convert } = window.blokInstance.blocks;

        try {
          await convert(blockId, nonexistingToolName);

          return null;
        } catch (err) {
          return {
            message: (err as Error).message,
          };
        }
      }, { blockId: existingBlock.id });

      expect(error?.message).toBe(`Block Tool with type "WRONG_TOOL_NAME" not found`);
    });

    test('should throw an error if some tool does not provide "conversionConfig"', async ({ page }) => {
      const existingBlock = {
        id: 'test-id-123',
        type: 'paragraph',
        data: {
          text: 'Some text',
        },
      };

      /**
       * Mock of Tool without conversionConfig
       */
      const TOOL_WITHOUT_CONVERSION_CONFIG_SOURCE = `class ToolWithoutConversionConfig {
        constructor(options) {
          this.data = options.data;
        }

        render() {
          const contenteditable = document.createElement('div');

          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }

          contenteditable.contentEditable = 'true';

          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: 'nonConvertableTool',
            classSource: TOOL_WITHOUT_CONVERSION_CONFIG_SOURCE,
            config: {
              shortcut: 'CMD+SHIFT+H',
            },
          },
        ],
        data: {
          blocks: [
            existingBlock,
          ],
        },
      });

      const error = await page.evaluate(async ({ blockId }) => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        /**
         * Call the 'convert' api method with tool that does not provide "conversionConfig"
         */
        const { convert } = window.blokInstance.blocks;

        try {
          await convert(blockId, 'nonConvertableTool');

          return null;
        } catch (err) {
          return {
            message: (err as Error).message,
          };
        }
      }, { blockId: existingBlock.id });

      expect(error?.message).toBe(`Conversion from "paragraph" to "nonConvertableTool" is not possible. NonConvertableTool tool(s) should provide a "conversionConfig"`);
    });

    test('should pass tool config to the conversionConfig.import method of the tool', async ({ page }) => {
      const existingBlock = {
        id: 'test-id-123',
        type: 'paragraph',
        data: {
          text: 'Some text',
        },
      };

      const conversionTargetToolConfig = {
        defaultStyle: 'defaultStyle',
      };

      /**
       * Mock of Tool with conversionConfig
       */
      const TOOL_WITH_CONVERSION_CONFIG_SOURCE = `class ToolWithConversionConfig {
        constructor(options) {
          this.data = options.data;
        }

        static get conversionConfig() {
          return {
            export: (data) => data,
            import: (_content, config) => {
              return { text: JSON.stringify(config) };
            },
          };
        }

        render() {
          const contenteditable = document.createElement('div');

          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }

          contenteditable.contentEditable = 'true';

          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: 'conversionTargetTool',
            classSource: TOOL_WITH_CONVERSION_CONFIG_SOURCE,
            config: conversionTargetToolConfig,
          },
        ],
        data: {
          blocks: [
            existingBlock,
          ],
        },
      });

      await page.evaluate(async ({ blockId }) => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const { convert } = window.blokInstance.blocks;
        await convert(blockId, 'conversionTargetTool');
      }, { blockId: existingBlock.id });

      // wait for block to be converted - wait until saved data shows converted type
      await page.waitForFunction(async () => {
        if (!window.blokInstance) {
          return false;
        }

        const { blocks } = await window.blokInstance.save();
        return blocks.length > 0 && blocks[0].type === 'conversionTargetTool';
      });

      /**
       * Check that block was converted
       */
      const { blocks } = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        return await window.blokInstance.save();
      });

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('conversionTargetTool');

      /**
       * Check that tool converted returned config as a result of import
       */
      expect(blocks[0].data.text).toBe(JSON.stringify(conversionTargetToolConfig));
    });

    test('should apply provided data overrides when converting a Block', async ({ page }) => {
      const SOURCE_TOOL_SOURCE = `class SourceTool {
        constructor({ data }) {
          this.data = data;
        }

        static get conversionConfig() {
          return {
            export: 'text',
          };
        }

        static get toolbox() {
          return {
            icon: 'S',
            title: 'Source',
          };
        }

        render() {
          const element = document.createElement('div');

          element.contentEditable = 'true';
          element.innerHTML = this.data?.text ?? '';

          return element;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      const TARGET_TOOL_SOURCE = `class TargetTool {
        constructor({ data, config }) {
          this.data = data ?? {};
          this.config = config ?? {};
        }

        static get conversionConfig() {
          return {
            import: (text, config) => ({
              text: (config?.prefix ?? '') + text,
              level: config?.defaultLevel ?? 1,
            }),
          };
        }

        static get toolbox() {
          return {
            icon: 'T',
            title: 'Target',
          };
        }

        render() {
          const element = document.createElement('div');

          element.contentEditable = 'true';
          element.innerHTML = this.data?.text ?? '';

          return element;
        }

        save(block) {
          return {
            ...this.data,
            text: block.innerHTML,
          };
        }
      }`;

      const blockId = 'convert-source-block';
      const initialText = 'Source tool content';
      const dataOverrides = {
        level: 4,
        customStyle: 'attention',
      };

      await createBlok(page, {
        tools: [
          {
            name: 'sourceTool',
            classSource: SOURCE_TOOL_SOURCE,
          },
          {
            name: 'targetTool',
            classSource: TARGET_TOOL_SOURCE,
            config: {
              prefix: '[Converted] ',
              defaultLevel: 1,
            },
          },
        ],
        data: {
          blocks: [
            {
              id: blockId,
              type: 'sourceTool',
              data: {
                text: initialText,
              },
            },
          ],
        },
      });

      await page.evaluate(async ({ targetBlockId, overrides }) => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const { convert } = window.blokInstance.blocks;
        await convert(targetBlockId, 'targetTool', overrides);
      }, { targetBlockId: blockId,
        overrides: dataOverrides });

      await page.waitForFunction(async () => {
        if (!window.blokInstance) {
          return false;
        }

        const saved = await window.blokInstance.save();
        return saved.blocks.length > 0 && saved.blocks[0].type === 'targetTool';
      });

      const savedData = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        return await window.blokInstance.save();
      });

      expect(savedData.blocks).toHaveLength(1);
      expect(savedData.blocks[0].type).toBe('targetTool');
      expect(savedData.blocks[0].data).toStrictEqual({
        text: `${'[Converted] '}${initialText}`,
        level: dataOverrides.level,
        customStyle: dataOverrides.customStyle,
      });
    });

    test('should throw when block data cannot be extracted before conversion', async ({ page }) => {
      const NON_SAVABLE_TOOL_SOURCE = `class NonSavableTool {
        constructor({ data }) {
          this.data = data;
        }

        static get conversionConfig() {
          return {
            export: 'text',
          };
        }

        static get toolbox() {
          return {
            icon: 'N',
            title: 'Non savable',
          };
        }

        render() {
          const element = document.createElement('div');

          element.contentEditable = 'true';
          element.innerHTML = this.data?.text ?? '';

          return element;
        }

        save() {
          return undefined;
        }
      }`;

      const TARGET_TOOL_SOURCE = `class ConvertibleTargetTool {
        constructor({ data }) {
          this.data = data ?? {};
        }

        static get conversionConfig() {
          return {
            import: 'text',
          };
        }

        static get toolbox() {
          return {
            icon: 'T',
            title: 'Target',
          };
        }

        render() {
          const element = document.createElement('div');

          element.contentEditable = 'true';
          element.innerHTML = this.data?.text ?? '';

          return element;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      const blockId = 'non-savable-block';

      await createBlok(page, {
        tools: [
          {
            name: 'nonSavable',
            classSource: NON_SAVABLE_TOOL_SOURCE,
          },
          {
            name: 'convertibleTarget',
            classSource: TARGET_TOOL_SOURCE,
          },
        ],
        data: {
          blocks: [
            {
              id: blockId,
              type: 'nonSavable',
              data: {
                text: 'Broken block',
              },
            },
          ],
        },
      });

      const error = await page.evaluate(async ({ targetBlockId }) => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const { convert } = window.blokInstance.blocks;

        try {
          await convert(targetBlockId, 'convertibleTarget');

          return null;
        } catch (err) {
          return {
            message: (err as Error).message,
          };
        }
      }, { targetBlockId: blockId });

      expect(error?.message).toBe('Could not convert Block. Failed to extract original Block data.');

      const savedData = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        return await window.blokInstance.save();
      });

      expect(savedData.blocks).toHaveLength(1);
      expect(savedData.blocks[0].type).toBe('nonSavable');
    });
  });

  /**
   * Tests for getConvertibleToolsForBlock utility function
   * These test the conversion options UI which uses getConvertibleToolsForBlock
   */
  test.describe('getConvertibleToolsForBlock (via UI)', () => {
    const BLOCK_TUNES_SELECTOR = `[data-blok-testid="block-tunes-popover"]`;
    const CONVERT_TO_SELECTOR = `${BLOCK_TUNES_SELECTOR} [data-blok-item-name="convert-to"]`;

    const openConvertToMenu = async (page: Page): Promise<Locator> => {
      const convertToItem = page.locator(CONVERT_TO_SELECTOR);

      await expect(convertToItem).toBeVisible();
      await convertToItem.hover();

      const nestedMenu = page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-nested="true"]`);

      await nestedMenu.waitFor({ state: 'attached' });

      return nestedMenu;
    };

    test('should show conversion options in block settings when block has export config', async ({ page }) => {
      const HEADER_TOOL_SOURCE = `class HeaderTool {
        constructor(options) {
          this.data = options.data;
        }

        static get conversionConfig() {
          return {
            export: 'text',
            import: 'text',
          };
        }

        static get toolbox() {
          return {
            icon: 'H',
            title: 'Header',
          };
        }

        render() {
          const contenteditable = document.createElement('div');
          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }
          contenteditable.contentEditable = 'true';
          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      const QUOTE_TOOL_SOURCE = `class QuoteTool {
        constructor(options) {
          this.data = options.data;
        }

        static get conversionConfig() {
          return {
            export: 'text',
            import: 'text',
          };
        }

        static get toolbox() {
          return {
            icon: '"',
            title: 'Quote',
          };
        }

        render() {
          const contenteditable = document.createElement('div');
          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }
          contenteditable.contentEditable = 'true';
          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: 'header',
            classSource: HEADER_TOOL_SOURCE,
          },
          {
            name: 'quote',
            classSource: QUOTE_TOOL_SOURCE,
          },
        ],
        data: {
          blocks: [
            {
              id: 'block-1',
              type: 'paragraph',
              data: {
                text: 'Test paragraph',
              },
            },
          ],
        },
      });

      await openBlockSettings(page);

      // Check if block tunes popover is visible
      await expect(page.locator(BLOCK_TUNES_SELECTOR).locator('[data-blok-testid="popover-container"]')).toBeVisible();

      // Check if delete tune is visible (debug)
      await expect(page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-item-name="delete"]`)).toBeVisible();

      // Check that "Convert to" menu item is visible
      await expect(page.locator(CONVERT_TO_SELECTOR)).toBeVisible();

      // Open "Convert to" submenu
      const convertToMenu = await openConvertToMenu(page);

      // Check that both header and quote tools are available
      await expect(convertToMenu.locator('[data-blok-item-name="header"]')).toBeVisible();
      await expect(convertToMenu.locator('[data-blok-item-name="quote"]')).toBeVisible();
    });

    test('should not show conversion options when block has no export config', async ({ page }) => {
      const NON_CONVERTABLE_TOOL_SOURCE = `class NonConvertableTool {
        constructor(options) {
          this.data = options.data;
        }

        static get toolbox() {
          return {
            icon: 'X',
            title: 'Non-convertable',
          };
        }

        render() {
          const contenteditable = document.createElement('div');
          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }
          contenteditable.contentEditable = 'true';
          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      const CONVERTABLE_TOOL_SOURCE = `class ConvertableTool {
        constructor(options) {
          this.data = options.data;
        }

        static get conversionConfig() {
          return {
            import: 'text',
          };
        }

        static get toolbox() {
          return {
            icon: 'C',
            title: 'Convertable',
          };
        }

        render() {
          const contenteditable = document.createElement('div');
          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }
          contenteditable.contentEditable = 'true';
          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: 'nonConvertable',
            classSource: NON_CONVERTABLE_TOOL_SOURCE,
          },
          {
            name: 'convertable',
            classSource: CONVERTABLE_TOOL_SOURCE,
          },
        ],
        data: {
          blocks: [
            {
              id: 'block-1',
              type: 'nonConvertable',
              data: {
                text: 'Test',
              },
            },
          ],
        },
      });

      await openBlockSettings(page);

      // Check that "Convert to" menu item is NOT visible (block has no export config)
      await expect(page.locator(CONVERT_TO_SELECTOR)).toBeHidden();
    });

    test('should filter out tools without import config from conversion options', async ({ page }) => {
      const HEADER_TOOL_SOURCE = `class HeaderTool {
        constructor(options) {
          this.data = options.data;
        }

        static get conversionConfig() {
          return {
            export: 'text',
            import: 'text',
          };
        }

        static get toolbox() {
          return {
            icon: 'H',
            title: 'Header',
          };
        }

        render() {
          const contenteditable = document.createElement('div');
          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }
          contenteditable.contentEditable = 'true';
          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      const TOOL_WITHOUT_IMPORT_SOURCE = `class ToolWithoutImport {
        constructor(options) {
          this.data = options.data;
        }

        static get conversionConfig() {
          return {
            export: 'text',
            // No import config
          };
        }

        static get toolbox() {
          return {
            icon: 'X',
            title: 'No Import',
          };
        }

        render() {
          const contenteditable = document.createElement('div');
          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }
          contenteditable.contentEditable = 'true';
          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: 'header',
            classSource: HEADER_TOOL_SOURCE,
          },
          {
            name: 'noImport',
            classSource: TOOL_WITHOUT_IMPORT_SOURCE,
          },
        ],
        data: {
          blocks: [
            {
              id: 'block-1',
              type: 'paragraph',
              data: {
                text: 'Test paragraph',
              },
            },
          ],
        },
      });

      await openBlockSettings(page);

      const convertToMenu = await openConvertToMenu(page);

      // Check that header tool is available
      await expect(convertToMenu.locator('[data-blok-item-name="header"]')).toBeVisible();

      // Check that tool without import config is NOT shown
      await expect(convertToMenu.locator('[data-blok-item-name="noImport"]')).toBeHidden();
    });

    test('should filter out duplicate toolbox items with same data (isSameBlockData)', async ({ page }) => {
      const HEADER_TOOL_SOURCE = `class HeaderTool {
        constructor(options) {
          this.data = options.data;
        }

        static get conversionConfig() {
          return {
            export: 'text',
            import: 'text',
          };
        }

        static get toolbox() {
          return [
            {
              icon: 'H1',
              title: 'Header 1',
              data: {
                level: 1,
              },
            },
            {
              icon: 'H2',
              title: 'Header 2',
              data: {
                level: 2,
              },
            },
            {
              icon: 'H3',
              title: 'Header 3',
              data: {
                level: 3,
              },
            },
          ];
        }

        render() {
          const contenteditable = document.createElement('div');
          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }
          contenteditable.contentEditable = 'true';
          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
            level: this.data?.level || 1,
          };
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: 'header',
            classSource: HEADER_TOOL_SOURCE,
          },
        ],
        data: {
          blocks: [
            {
              id: 'block-1',
              type: 'paragraph',
              data: {
                text: 'Test paragraph',
              },
            },
          ],
        },
      });

      await openBlockSettings(page);

      const convertToMenu = await openConvertToMenu(page);

      const headerItems = convertToMenu.locator('[data-blok-item-name="header"]');
      const firstHeaderItem = convertToMenu.locator(':nth-match([data-blok-item-name="header"], 1)');

      await expect(headerItems).toHaveCount(3);
      await expect(firstHeaderItem).toBeVisible();
    });

    test('should filter out toolbox item with same data as current block (isSameBlockData)', async ({ page }) => {
      const HEADER_TOOL_SOURCE = `class HeaderTool {
        constructor(options) {
          this.data = options.data;
        }

        static get conversionConfig() {
          return {
            export: 'text',
            import: 'text',
          };
        }

        static get toolbox() {
          return [
            {
              icon: 'H1',
              title: 'Header 1',
              data: {
                level: 1,
              },
            },
            {
              icon: 'H2',
              title: 'Header 2',
              data: {
                level: 2,
              },
            },
          ];
        }

        render() {
          const contenteditable = document.createElement('div');
          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }
          contenteditable.contentEditable = 'true';
          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
            level: this.data?.level || 1,
          };
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: 'header',
            classSource: HEADER_TOOL_SOURCE,
          },
        ],
        data: {
          blocks: [
            {
              id: 'block-1',
              type: 'header',
              data: {
                text: 'Test header',
                level: 1,
              },
            },
          ],
        },
      });

      await openBlockSettings(page);

      const convertToMenu = await openConvertToMenu(page);

      // Header tool should be available, but H1 option should be filtered out (same data)
      // H2 should still be available
      await expect(convertToMenu.locator('[data-blok-item-name="header"]')).toBeVisible();
    });

    test('should filter out tools without toolbox from conversion options', async ({ page }) => {
      const HEADER_TOOL_SOURCE = `class HeaderTool {
        constructor(options) {
          this.data = options.data;
        }

        static get conversionConfig() {
          return {
            export: 'text',
            import: 'text',
          };
        }

        static get toolbox() {
          return {
            icon: 'H',
            title: 'Header',
          };
        }

        render() {
          const contenteditable = document.createElement('div');
          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }
          contenteditable.contentEditable = 'true';
          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      const TOOL_WITHOUT_TOOLBOX_SOURCE = `class ToolWithoutToolbox {
        constructor(options) {
          this.data = options.data;
        }

        static get conversionConfig() {
          return {
            export: 'text',
            import: 'text',
          };
        }

        // No toolbox property

        render() {
          const contenteditable = document.createElement('div');
          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }
          contenteditable.contentEditable = 'true';
          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: 'header',
            classSource: HEADER_TOOL_SOURCE,
          },
          {
            name: 'noToolbox',
            classSource: TOOL_WITHOUT_TOOLBOX_SOURCE,
          },
        ],
        data: {
          blocks: [
            {
              id: 'block-1',
              type: 'paragraph',
              data: {
                text: 'Test paragraph',
              },
            },
          ],
        },
      });

      await openBlockSettings(page);

      const convertToMenu = await openConvertToMenu(page);

      // Check that header tool is available
      await expect(convertToMenu.locator('[data-blok-item-name="header"]')).toBeVisible();

      // Check that tool without toolbox is NOT shown
      await expect(convertToMenu.locator('[data-blok-item-name="noToolbox"]')).toBeHidden();
    });

    test('should filter out toolbox items without icon', async ({ page }) => {
      const HEADER_TOOL_SOURCE = `class HeaderTool {
        constructor(options) {
          this.data = options.data;
        }

        static get conversionConfig() {
          return {
            export: 'text',
            import: 'text',
          };
        }

        static get toolbox() {
          return [
            {
              icon: 'H',
              title: 'Header with icon',
            },
            {
              title: 'Header without icon',
              // No icon property
            },
          ];
        }

        render() {
          const contenteditable = document.createElement('div');
          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }
          contenteditable.contentEditable = 'true';
          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: 'header',
            classSource: HEADER_TOOL_SOURCE,
          },
        ],
        data: {
          blocks: [
            {
              id: 'block-1',
              type: 'paragraph',
              data: {
                text: 'Test paragraph',
              },
            },
          ],
        },
      });

      await openBlockSettings(page);

      const convertToMenu = await openConvertToMenu(page);

      // Only the item with icon should be available
      await expect(convertToMenu.locator('[data-blok-item-name="header"]')).toBeVisible();
    });
  });

  /**
   * Additional tests for conversion edge cases
   */
  test.describe('conversion edge cases', () => {
    test('should handle function-based export conversion config', async ({ page }) => {
      const FUNCTION_EXPORT_TOOL_SOURCE = `class FunctionExportTool {
        constructor(options) {
          this.data = options.data;
        }

        static get conversionConfig() {
          return {
            export: (data) => {
              return data.text || '';
            },
            import: 'text',
          };
        }

        static get toolbox() {
          return {
            icon: 'F',
            title: 'Function Export',
          };
        }

        render() {
          const contenteditable = document.createElement('div');
          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }
          contenteditable.contentEditable = 'true';
          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      const existingBlock = {
        id: 'test-id-123',
        type: 'paragraph',
        data: {
          text: 'Some text',
        },
      };

      await createBlok(page, {
        tools: [
          {
            name: 'functionExport',
            classSource: FUNCTION_EXPORT_TOOL_SOURCE,
          },
        ],
        data: {
          blocks: [
            existingBlock,
          ],
        },
      });

      await page.evaluate(async ({ blockId }) => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const { convert } = window.blokInstance.blocks;
        await convert(blockId, 'functionExport');
      }, { blockId: existingBlock.id });

      // Wait for conversion
      await page.waitForFunction(async () => {
        if (!window.blokInstance) {
          return false;
        }

        const { blocks } = await window.blokInstance.save();
        return blocks.length > 0 && blocks[0].type === 'functionExport';
      });

      const { blocks } = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        return await window.blokInstance.save();
      });

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('functionExport');
      expect(blocks[0].data.text).toBe(existingBlock.data.text);
    });

    test('should handle function-based import conversion config', async ({ page }) => {
      const FUNCTION_IMPORT_TOOL_SOURCE = `class FunctionImportTool {
        constructor(options) {
          this.data = options.data;
        }

        static get conversionConfig() {
          return {
            export: 'text',
            import: (content) => {
              return {
                text: content.toUpperCase(),
              };
            },
          };
        }

        static get toolbox() {
          return {
            icon: 'F',
            title: 'Function Import',
          };
        }

        render() {
          const contenteditable = document.createElement('div');
          if (this.data && this.data.text) {
            contenteditable.innerHTML = this.data.text;
          }
          contenteditable.contentEditable = 'true';
          return contenteditable;
        }

        save(block) {
          return {
            text: block.innerHTML,
          };
        }
      }`;

      const existingBlock = {
        id: 'test-id-123',
        type: 'paragraph',
        data: {
          text: 'some text',
        },
      };

      await createBlok(page, {
        tools: [
          {
            name: 'functionImport',
            classSource: FUNCTION_IMPORT_TOOL_SOURCE,
          },
        ],
        data: {
          blocks: [
            existingBlock,
          ],
        },
      });

      await page.evaluate(async ({ blockId }) => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const { convert } = window.blokInstance.blocks;
        await convert(blockId, 'functionImport');
      }, { blockId: existingBlock.id });

      // Wait for conversion
      await page.waitForFunction(async () => {
        if (!window.blokInstance) {
          return false;
        }

        const { blocks } = await window.blokInstance.save();
        return blocks.length > 0 && blocks[0].type === 'functionImport';
      });

      const { blocks } = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        return await window.blokInstance.save();
      });

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('functionImport');
      // Function import should transform the text
      expect(blocks[0].data.text).toBe('SOME TEXT');
    });
  });

  /**
   * block.dispatchChange()
   */
  test.describe('block.dispatchChange()', () => {
    /**
     * Check that block.dispatchChange() triggers Blok's 'onChange' callback
     */
    test('should trigger onChange with corresponded block', async ({ page }) => {
      await createBlok(page, {
        data: blokDataMock,
        onChange: true,
      });

      const result = await page.evaluate(({ blockId }) => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const block = window.blokInstance.blocks.getById(blockId);
        if (!block) {
          throw new Error(`Block with id ${blockId} not found`);
        }

        block.dispatchChange();

        return {
          blockExists: block !== null && block !== undefined,
          blockId: block.id,
        };
      }, { blockId: firstBlock.id });

      expect(result.blockExists).toBe(true);
      expect(result.blockId).toBe(firstBlock.id);

      // Wait for onChange to be called
      await page.waitForFunction(() => {
        const windowObj = window as unknown as { onChangeCalled?: boolean };

        return windowObj.onChangeCalled === true;
      }, { timeout: 1000 });

      // Get the onChange events from the browser context
      const onChangeData = await page.evaluate(() => {
        const windowObj = window as unknown as { onChangeEvents?: unknown[]; onChangeCalled?: boolean };

        return {
          called: windowObj.onChangeCalled ?? false,
          events: windowObj.onChangeEvents ?? [],
        };
      });

      expect(onChangeData.called).toBe(true);
      expect(onChangeData.events.length).toBeGreaterThan(0);

      // Single dispatchChange() call should result in a single unwrapped event (not batched)
      const firstEvent = onChangeData.events[0];

      expect(Array.isArray(firstEvent)).toBe(false);
      const event = firstEvent as BlockMutationEvent;

      expect(event).toBeDefined();
      expect(event.type).toBe(BlockChangedMutationType);
      expect(event.detail).toBeDefined();
      expect(typeof event.detail).toBe('object');
      expect(event.detail).not.toBeNull();
      expect('index' in event.detail).toBe(true);
      expect((event.detail as { index: number }).index).toBe(0);
    });
  });
});


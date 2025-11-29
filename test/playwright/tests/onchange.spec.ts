import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type Blok from '@/types';
import type { BlokConfig, OutputData } from '@/types';
import { modificationsObserverBatchTimeout, BLOK_INTERFACE_SELECTOR } from '../../../src/components/constants';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';
import { BlockAddedMutationType } from '../../../types/events/block/BlockAdded';
import { BlockChangedMutationType } from '../../../types/events/block/BlockChanged';
import { BlockMovedMutationType } from '../../../types/events/block/BlockMoved';
import { BlockRemovedMutationType } from '../../../types/events/block/BlockRemoved';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const TOOLBAR_PLUS_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const WAIT_FOR_BATCH = modificationsObserverBatchTimeout + 100;

type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const getRequiredBoundingBox = async (locator: Locator): Promise<BoundingBox> => {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error('Could not get bounding box');
  }

  return box;
};

type SerializableToolConfig = {
  name: string;
  className?: string;
  classCode?: string;
  config?: Record<string, unknown>;
};

type SerializedBlockMutationEvent = {
  type: string;
  detail?: Record<string, unknown>;
};

type SerializedOnChangeCall = SerializedBlockMutationEvent | SerializedBlockMutationEvent[];

const ensureSerializedBlockMutationEvent = (
  value: SerializedOnChangeCall
): SerializedBlockMutationEvent => {
  if (Array.isArray(value)) {
    throw new Error('Expected a single serialized block mutation event');
  }

  return value;
};

const ensureSerializedBlockMutationEvents = (
  value: SerializedOnChangeCall
): SerializedBlockMutationEvent[] => {
  if (!Array.isArray(value)) {
    throw new Error('Expected an array of serialized block mutation events');
  }

  return value;
};

type CreateBlokOptions = {
  blocks?: OutputData['blocks'];
  readOnly?: boolean;
  tools?: SerializableToolConfig[];
  callSaveInsideOnChange?: boolean;
  config?: Record<string, unknown>;
};

type WindowTestState = Partial<Record<'__onChangeCalls', SerializedOnChangeCall[]>> &
  Partial<Record<'__testToolWrapper', HTMLElement>> &
  Partial<Record<'__testToolChild', HTMLElement>>;

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
  const {
    blocks,
    readOnly,
    tools = [],
    callSaveInsideOnChange = false,
    config = {},
  } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({
      holder,
      blocks: initialBlocks,
      readOnly: readOnlyOption,
      tools: serializedTools,
      callSaveInsideOnChange: shouldCallSave,
      config: blokConfigOptions,
    }) => {
      const windowObj = window as unknown as Window & WindowTestState;

      windowObj.__onChangeCalls = [];

      const reviveTools = serializedTools.reduce<Record<string, Record<string, unknown>>>((accumulator, tool) => {
        let toolClass: unknown = null;

        if (tool.className) {
          // Handle dot notation (e.g., 'Blok.Header')
          toolClass = tool.className.split('.').reduce(
            (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
            window
          ) ?? null;
        }

        if (!toolClass && tool.classCode) {

          toolClass = new Function(`return (${tool.classCode});`)();
        }

        if (!toolClass) {
          throw new Error(`Tool "${tool.name}" is not available globally`);
        }

        return {
          ...accumulator,
          [tool.name]: {
            class: toolClass,
            ...(tool.config ?? {}),
          },
        };
      }, {});

      const blokConfig: Record<string, unknown> = {
        holder: holder,
        ...blokConfigOptions,
      };

      if (typeof readOnlyOption === 'boolean') {
        blokConfig.readOnly = readOnlyOption;
      }

      if (initialBlocks) {
        blokConfig.data = {
          blocks: initialBlocks,
        };
      }

      if (Object.keys(reviveTools).length > 0) {
        blokConfig.tools = reviveTools;
      }

      const cloneDetail = <T>(value: T): T => {
        const structuredCloneFn = typeof globalThis.structuredClone === 'function'
          ? globalThis.structuredClone
          : null;

        if (structuredCloneFn) {
          return structuredCloneFn(value);
        }

        try {
          return JSON.parse(JSON.stringify(value));
        } catch (_error) {
          return value;
        }
      };

      const serializeEvent = (event: CustomEvent | CustomEvent[]): SerializedOnChangeCall => {
        const serializeSingle = (singleEvent: CustomEvent): SerializedBlockMutationEvent => {
          const { type, detail } = singleEvent;

          return {
            type,
            detail: detail ? cloneDetail(detail) : undefined,
          };
        };

        return Array.isArray(event)
          ? event.map(serializeSingle)
          : serializeSingle(event);
      };

      blokConfig.onChange = (api: unknown, event: CustomEvent | CustomEvent[]) => {
        windowObj.__onChangeCalls = windowObj.__onChangeCalls ?? [];

        windowObj.__onChangeCalls.push(serializeEvent(event));

        if (shouldCallSave && typeof (api as { saver?: { save: () => Promise<unknown> } }).saver?.save === 'function') {
          const saveResult = (api as { saver?: { save: () => Promise<unknown> } }).saver?.save();

          if (saveResult && typeof (saveResult as Promise<unknown>).catch === 'function') {
            void (saveResult as Promise<unknown>).catch(() => {
              // Swallow errors to match the previous e2e behaviour where Promise rejections were ignored.
            });
          }
        }
      };

      const blok = new window.Blok(blokConfig as BlokConfig);

      windowObj.blokInstance = blok;

      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      blocks: blocks ?? null,
      readOnly,
      tools,
      callSaveInsideOnChange,
      config,
    }
  );
};

const waitForOnChangeCallCount = async (page: Page, expectedCount: number): Promise<void> => {
  await page.waitForFunction(
    ({ expected }) => {
      const calls = (window as unknown as Window & WindowTestState).__onChangeCalls ?? [];

      return calls.length >= expected;
    },
    { expected: expectedCount },
    { timeout: WAIT_FOR_BATCH + 1000 }
  );
};

const getOnChangeCalls = async (page: Page): Promise<SerializedOnChangeCall[]> => {
  return await page.evaluate(() => {
    const calls = (window as unknown as Window & WindowTestState).__onChangeCalls ?? [];

    return calls.slice();
  });
};

const waitForDelay = async (page: Page, delayMs: number): Promise<void> => {
  await page.evaluate(
    async (timeout) => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeout);
      });
    },
    delayMs
  );
};

const waitForBatchProcessing = async (page: Page): Promise<void> => {
  await waitForDelay(page, WAIT_FOR_BATCH);
};

const openBlockSettings = async (page: Page, index: number = 0): Promise<void> => {
  const block = page.locator(`${BLOCK_SELECTOR}:nth-of-type(${index + 1})`);

  await block.scrollIntoViewIfNeeded();
  await block.click();
  await block.hover();

  const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

  await settingsButton.waitFor({ state: 'visible' });
  await settingsButton.click();
};

test.describe('onChange callback', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('should batch events when several changes happened at once', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'The first paragraph',
          },
        },
      ],
    });

    const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);

    await paragraph.click();
    await paragraph.type('change');
    await page.keyboard.press('Enter');

    await waitForOnChangeCallCount(page, 1);

    const [ firstCall ] = await getOnChangeCalls(page);
    const events = ensureSerializedBlockMutationEvents(firstCall);

    expect(events).toStrictEqual([
      expect.objectContaining({
        type: BlockChangedMutationType,
        detail: expect.objectContaining({
          index: 0,
        }),
      }),
      expect.objectContaining({
        type: BlockAddedMutationType,
        detail: expect.objectContaining({
          index: 1,
        }),
      }),
    ]);
  });

  test('should filter out similar events on batching', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'The first paragraph',
          },
        },
      ],
    });

    const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);

    await paragraph.click();
    await paragraph.type('first change');
    await waitForDelay(page, 100);
    await paragraph.type('second change');

    await waitForOnChangeCallCount(page, 1);

    const [ event ] = await getOnChangeCalls(page);
    const singleEvent = ensureSerializedBlockMutationEvent(event);

    expect(singleEvent).toStrictEqual(expect.objectContaining({
      type: BlockChangedMutationType,
      detail: expect.objectContaining({
        index: 0,
        target: expect.objectContaining({
          name: 'paragraph',
        }),
      }),
    }));
  });

  test('should be fired with correct index on block insertion above the current block', async ({ page }) => {
    await createBlok(page);

    const firstBlock = page.locator(`${BLOCK_SELECTOR}:first-of-type`);

    await firstBlock.click();
    await page.keyboard.press('Enter');

    await waitForOnChangeCallCount(page, 1);

    const [ event ] = await getOnChangeCalls(page);
    const singleEvent = ensureSerializedBlockMutationEvent(event);

    expect(singleEvent).toStrictEqual(expect.objectContaining({
      type: BlockAddedMutationType,
      detail: expect.objectContaining({
        index: 0,
        target: expect.objectContaining({
          name: 'paragraph',
        }),
      }),
    }));
  });

  test('should be fired with only single "block-added" event by pressing Enter at the end of a block', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'some text',
          },
        },
      ],
    });

    const block = page.locator(`${BLOCK_SELECTOR}:first-of-type`);

    await block.click();
    await page.keyboard.press('Enter');

    await waitForOnChangeCallCount(page, 1);

    const [ event ] = await getOnChangeCalls(page);
    const singleEvent = ensureSerializedBlockMutationEvent(event);

    expect(singleEvent).toStrictEqual(expect.objectContaining({
      type: BlockAddedMutationType,
      detail: expect.objectContaining({
        target: expect.objectContaining({
          name: 'paragraph',
        }),
      }),
    }));
  });

  test('should be fired with correct index on block insertion after the current block', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'some text',
          },
        },
      ],
    });

    const block = page.locator(`${BLOCK_SELECTOR}:first-of-type`);

    await block.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    await waitForOnChangeCallCount(page, 1);

    const [ event ] = await getOnChangeCalls(page);
    const singleEvent = ensureSerializedBlockMutationEvent(event);

    expect(singleEvent).toStrictEqual(expect.objectContaining({
      type: BlockAddedMutationType,
      detail: expect.objectContaining({
        index: 1,
      }),
    }));
  });

  test('should be fired on typing into block', async ({ page }) => {
    await createBlok(page);

    const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);

    await paragraph.click();
    await paragraph.type('some text');

    await waitForOnChangeCallCount(page, 1);

    const [ event ] = await getOnChangeCalls(page);
    const singleEvent = ensureSerializedBlockMutationEvent(event);

    expect(singleEvent).toStrictEqual(expect.objectContaining({
      type: BlockChangedMutationType,
      detail: expect.objectContaining({
        index: 0,
      }),
    }));
  });

  test('should be fired on block replacement for both blocks', async ({ page }) => {
    await createBlok(page, {
      tools: [
        {
          name: 'header',
          className: 'Blok.Header',
        },
      ],
    });

    const block = page.locator(`${BLOCK_SELECTOR}:first-of-type`);

    await block.click();

    const plusButton = page.locator(TOOLBAR_PLUS_SELECTOR);

    await plusButton.click();

    const headerOption = page.getByTestId('toolbox-popover').locator('[data-blok-testid="popover-item"][data-blok-item-name=header]');

    await headerOption.click();

    await waitForOnChangeCallCount(page, 1);

    const [ events ] = await getOnChangeCalls(page);
    const eventsBatch = ensureSerializedBlockMutationEvents(events);

    expect(eventsBatch).toStrictEqual([
      expect.objectContaining({
        type: BlockRemovedMutationType,
        detail: expect.objectContaining({
          index: 0,
          target: expect.objectContaining({
            name: 'paragraph',
          }),
        }),
      }),
      expect.objectContaining({
        type: BlockAddedMutationType,
        detail: expect.objectContaining({
          index: 0,
          target: expect.objectContaining({
            name: 'header',
          }),
        }),
      }),
    ]);
  });

  test('should be fired on tune modifying', async ({ page }) => {
    await createBlok(page, {
      tools: [
        {
          name: 'header',
          className: 'Blok.Header',
        },
      ],
      blocks: [
        {
          type: 'header',
          data: {
            text: 'Header block',
          },
        },
      ],
    });

    await openBlockSettings(page, 0);

    const tuneOption = page.getByTestId('block-tunes-popover').locator('[data-blok-testid="popover-item"]:nth-of-type(4)');

    await tuneOption.click();

    await waitForOnChangeCallCount(page, 1);

    const [ event ] = await getOnChangeCalls(page);
    const singleEvent = ensureSerializedBlockMutationEvent(event);

    expect(singleEvent).toStrictEqual(expect.objectContaining({
      type: BlockChangedMutationType,
      detail: expect.objectContaining({
        index: 0,
        target: expect.objectContaining({
          name: 'header',
        }),
      }),
    }));
  });

  test('should be fired when block is removed', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'some text',
          },
        },
      ],
    });

    await openBlockSettings(page, 0);

    const deleteOption = page.getByTestId('block-tunes-popover').locator('[data-blok-item-name=delete]:visible');

    await deleteOption.click();
    await deleteOption.click();

    await waitForOnChangeCallCount(page, 1);

    const [ events ] = await getOnChangeCalls(page);
    const eventsBatch = ensureSerializedBlockMutationEvents(events);

    expect(eventsBatch).toStrictEqual([
      expect.objectContaining({
        type: BlockRemovedMutationType,
        detail: expect.objectContaining({
          index: 0,
        }),
      }),
      expect.objectContaining({
        type: BlockAddedMutationType,
        detail: expect.objectContaining({
          index: 0,
        }),
      }),
    ]);
  });

  test('should be fired when block is moved', async ({ page, browserName }) => {
    // WebKit doesn't properly fire drag events with programmatic mouse movements
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(browserName === 'webkit', 'WebKit does not support programmatic drag-and-drop');

    await createBlok(page, {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'first block',
          },
        },
        {
          type: 'paragraph',
          data: {
            text: 'second block',
          },
        },
      ],
    });

    const firstBlock = page.locator(`${BLOCK_SELECTOR}:nth-of-type(1)`);
    const secondBlock = page.locator(`${BLOCK_SELECTOR}:nth-of-type(2)`);

    await secondBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await settingsButton.waitFor({ state: 'visible' });

    const settingsBox = await getRequiredBoundingBox(settingsButton);
    const targetBox = await getRequiredBoundingBox(firstBlock);

    await page.mouse.move(
      settingsBox.x + settingsBox.width / 2,
      settingsBox.y + settingsBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + 5,
      { steps: 20 }
    );
    await page.mouse.up();

    await waitForOnChangeCallCount(page, 1);

    const [ event ] = await getOnChangeCalls(page);
    const singleEvent = ensureSerializedBlockMutationEvent(event);

    expect(singleEvent).toStrictEqual(expect.objectContaining({
      type: BlockMovedMutationType,
      detail: expect.objectContaining({
        fromIndex: 1,
        toIndex: 0,
      }),
    }));
  });

  test('should not be fired on fake cursor adding and removing', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'some text',
          },
        },
      ],
    });

    const block = page.locator(`${BLOCK_SELECTOR}:first-of-type`);

    await block.click();

    await openBlockSettings(page, 0);

    await block.click();

    await waitForBatchProcessing(page);

    const calls = await getOnChangeCalls(page);

    expect(calls).toHaveLength(0);
  });

  test('should be fired when the whole text inside block is removed', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'a',
          },
        },
      ],
    });

    const block = page.locator(`${BLOCK_SELECTOR}:first-of-type`);

    await block.click();
    await page.keyboard.press('Backspace');

    await waitForOnChangeCallCount(page, 1);

    const [ event ] = await getOnChangeCalls(page);
    const singleEvent = ensureSerializedBlockMutationEvent(event);

    expect(singleEvent).toStrictEqual(expect.objectContaining({
      type: BlockChangedMutationType,
      detail: expect.objectContaining({
        index: 0,
      }),
    }));
  });

  test('should not be fired when element with the "data-blok-mutation-free" mark changes some attribute', async ({ page }) => {
    await page.evaluate(() => {
      const toolWrapper = document.createElement('div');

      toolWrapper.setAttribute('data-blok-mutation-free', 'true');

      const windowTestState = window as unknown as Window & WindowTestState;

      windowTestState.__testToolWrapper = toolWrapper;
    });

    const toolClassCode = `
      (() => {
        return class ToolWithMutationFreeAttribute {
          render() {
            return window.__testToolWrapper;
          }
          save() {
            return {};
          }
        };
      })()
    `;

    await createBlok(page, {
      tools: [
        {
          name: 'testTool',
          classCode: toolClassCode,
        },
      ],
      blocks: [
        {
          type: 'testTool',
          data: {},
        },
      ],
    });

    await waitForDelay(page, 100);

    await page.evaluate(() => {
      const windowTestState = window as unknown as Window & WindowTestState;

      windowTestState.__testToolWrapper?.setAttribute('some-changed-attr', 'some-new-value');
    });

    await waitForBatchProcessing(page);

    const calls = await getOnChangeCalls(page);

    expect(calls).toHaveLength(0);
  });

  test('should not be fired when mutation happened in a child of element with the "data-blok-mutation-free" mark', async ({ page }) => {
    await page.evaluate(() => {
      const toolWrapper = document.createElement('div');
      const child = document.createElement('div');

      toolWrapper.setAttribute('data-blok-mutation-free', 'true');
      toolWrapper.appendChild(child);

      const windowTestState = window as unknown as Window & WindowTestState;

      windowTestState.__testToolWrapper = toolWrapper;
      windowTestState.__testToolChild = child;
    });

    const toolClassCode = `
      (() => {
        return class ToolWithMutationFreeAttribute {
          render() {
            return window.__testToolWrapper;
          }
          save() {
            return {};
          }
        };
      })()
    `;

    await createBlok(page, {
      tools: [
        {
          name: 'testTool',
          classCode: toolClassCode,
        },
      ],
      blocks: [
        {
          type: 'testTool',
          data: {},
        },
      ],
    });

    await waitForDelay(page, 100);

    await page.evaluate(() => {
      const windowTestState = window as unknown as Window & WindowTestState;

      windowTestState.__testToolChild?.setAttribute('some-changed-attr', 'some-new-value');
    });

    await waitForBatchProcessing(page);

    const calls = await getOnChangeCalls(page);

    expect(calls).toHaveLength(0);
  });

  test('should not be fired when "characterData" mutation happened in a child of element with the "data-blok-mutation-free" mark', async ({ page }) => {
    await page.evaluate(() => {
      const toolWrapper = document.createElement('div');
      const child = document.createElement('div');

      child.setAttribute('data-blok-testid', 'tool-child');
      child.setAttribute('contenteditable', 'true');
      child.textContent = '';

      toolWrapper.setAttribute('data-blok-mutation-free', 'true');
      toolWrapper.appendChild(child);

      const windowTestState = window as unknown as Window & WindowTestState;

      windowTestState.__testToolWrapper = toolWrapper;
      windowTestState.__testToolChild = child;
    });

    const toolClassCode = `
      (() => {
        return class ToolWithMutationFreeAttribute {
          render() {
            return window.__testToolWrapper;
          }
          save() {
            return {};
          }
        };
      })()
    `;

    await createBlok(page, {
      tools: [
        {
          name: 'testTool',
          classCode: toolClassCode,
        },
      ],
      blocks: [
        {
          type: 'testTool',
          data: {},
        },
      ],
    });

    const child = page.getByTestId('tool-child');

    await child.click();
    await child.type('some text');

    await waitForBatchProcessing(page);

    const calls = await getOnChangeCalls(page);

    expect(calls).toHaveLength(0);
  });

  test('should be called on blocks.clear() with removed and added blocks', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'The first paragraph',
          },
        },
        {
          type: 'paragraph',
          data: {
            text: 'The second paragraph',
          },
        },
      ],
    });

    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      await window.blokInstance.blocks.clear();
    });

    await waitForOnChangeCallCount(page, 1);

    const [ events ] = await getOnChangeCalls(page);
    const eventsBatch = ensureSerializedBlockMutationEvents(events);

    expect(eventsBatch).toStrictEqual([
      expect.objectContaining({
        type: BlockRemovedMutationType,
      }),
      expect.objectContaining({
        type: BlockRemovedMutationType,
      }),
      expect.objectContaining({
        type: BlockAddedMutationType,
      }),
    ]);
  });

  test('should not be called on blocks.render() on non-empty blok', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'The first paragraph',
          },
        },
        {
          type: 'paragraph',
          data: {
            text: 'The second paragraph',
          },
        },
      ],
    });

    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      await window.blokInstance.blocks.render({
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'The new paragraph',
            },
          },
        ],
      });
    });

    await waitForBatchProcessing(page);

    const calls = await getOnChangeCalls(page);

    expect(calls).toHaveLength(0);
  });

  test('should be called on blocks.update() with "block-changed" event', async ({ page }) => {
    const block = {
      id: 'bwnFX5LoX7',
      type: 'paragraph',
      data: {
        text: 'The first block mock.',
      },
    };

    await createBlok(page, {
      blocks: [
        block,
      ],
    });

    await page.evaluate(async ({ blockId }) => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      await window.blokInstance.blocks.update(blockId, {
        text: 'Updated text',
      });
    }, { blockId: block.id });

    await waitForOnChangeCallCount(page, 1);

    const [ event ] = await getOnChangeCalls(page);
    const singleEvent = ensureSerializedBlockMutationEvent(event);

    expect(singleEvent).toStrictEqual(expect.objectContaining({
      type: BlockChangedMutationType,
      detail: expect.objectContaining({
        index: 0,
        target: expect.objectContaining({
          id: block.id,
        }),
      }),
    }));
  });

  test('should be fired when the whole text inside some descendant of the block is removed', async ({ page }) => {
    const toolClassCode = `
      (() => {
        return class ToolWithContentEditableDescendant {
          render() {
            const contenteditable = document.createElement('div');

            contenteditable.contentEditable = 'true';
            contenteditable.innerText = 'a';
            contenteditable.setAttribute('data-blok-testid', 'nested-contenteditable');

            const wrapper = document.createElement('div');

            wrapper.appendChild(contenteditable);

            return wrapper;
          }
          save() {
            return {};
          }
        };
      })()
    `;

    await createBlok(page, {
      tools: [
        {
          name: 'testTool',
          classCode: toolClassCode,
        },
      ],
      blocks: [
        {
          type: 'testTool',
          data: {},
        },
      ],
    });

    const nestedContentEditable = page.getByTestId('nested-contenteditable');

    await nestedContentEditable.click();
    await nestedContentEditable.clear();

    await waitForOnChangeCallCount(page, 1);

    const [ event ] = await getOnChangeCalls(page);
    const singleEvent = ensureSerializedBlockMutationEvent(event);

    expect(singleEvent).toStrictEqual(expect.objectContaining({
      type: BlockChangedMutationType,
      detail: expect.objectContaining({
        index: 0,
      }),
    }));
  });

  test('should not be called when blok is initialized with readOnly mode', async ({ page }) => {
    await createBlok(page, {
      readOnly: true,
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'The first paragraph',
          },
        },
      ],
    });

    await waitForBatchProcessing(page);

    const calls = await getOnChangeCalls(page);

    expect(calls).toHaveLength(0);
  });

  test('should not be called when blok is switched to and from readOnly mode', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'The first paragraph',
          },
        },
      ],
    });

    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      await window.blokInstance.readOnly.toggle(true);
    });

    await waitForBatchProcessing(page);

    let calls = await getOnChangeCalls(page);

    expect(calls).toHaveLength(0);

    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      await window.blokInstance.readOnly.toggle(false);
    });

    await waitForBatchProcessing(page);

    calls = await getOnChangeCalls(page);

    expect(calls).toHaveLength(0);
  });
});



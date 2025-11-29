import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Blok from '@/types';
import type { BlokConfig, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../fixtures/test.html')
).href;

const HEADER_TOOL_UMD_PATH = path.resolve(
  __dirname,
  '../../../node_modules/@editorjs/header/dist/header.umd.js'
);

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const getBlockByIndex = (page: Page, index: number): Locator => {
  return page.locator(`${BLOCK_SELECTOR}:nth-of-type(${index + 1})`);
};

const getParagraphByIndex = (page: Page, index: number): Locator => {
  return getBlockByIndex(page, index).locator('[contenteditable]');
};

const getCommandModifierKey = async (page: Page): Promise<'Meta' | 'Control'> => {
  const isMac = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = (nav.userAgentData?.platform ?? nav.platform ?? '').toLowerCase();

    return platform.includes('mac');
  });

  return isMac ? 'Meta' : 'Control';
};

type SerializableToolConfig = {
  className?: string;
  classCode?: string;
  config?: Record<string, unknown>;
};

type CreateBlokOptions = Pick<BlokConfig, 'data' | 'inlineToolbar' | 'placeholder' | 'readOnly'> & {
  tools?: Record<string, SerializableToolConfig>;
};

type ClipboardFileDescriptor = {
  name: string;
  type: string;
  content: string;
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

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  await resetBlok(page);

  const { tools = {}, ...blokOptions } = options;

  const serializedTools = Object.entries(tools).map(([name, tool]) => {
    return {
      name,
      className: tool.className ?? null,
      classCode: tool.classCode ?? null,
      toolConfig: tool.config ?? {},
    };
  });

  await page.evaluate(
    async ({ holder, blokOptions: rawOptions, serializedTools: toolsConfig }) => {
      const { data, ...restOptions } = rawOptions;
      const config: Record<string, unknown> = {
        holder: holder,
        ...restOptions,
      };

      if (data) {
        config.data = data;
      }

      if (toolsConfig.length > 0) {
        const resolvedTools = toolsConfig.reduce<Record<string, { class: unknown } & Record<string, unknown>>>(
          (accumulator, { name, className, classCode, toolConfig }) => {
            let toolClass: unknown;

            if (className) {
              toolClass = (window as unknown as Record<string, unknown>)[className] ?? null;
            }

            if (!toolClass && classCode) {

              toolClass = new Function(`return (${classCode});`)();
            }

            if (!toolClass) {
              throw new Error(`Tool "${name}" is not available globally`);
            }

            return {
              ...accumulator,
              [name]: {
                class: toolClass,
                ...toolConfig,
              },
            };
          },
          {}
        );

        config.tools = resolvedTools;
      }

      const blok = new window.Blok(config as BlokConfig);

      window.blokInstance = blok;

      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      blokOptions,
      serializedTools,
    }
  );
};

const createBlokWithElements = async (page: Page, elements: OutputData['blocks']): Promise<void> => {
  await createBlok(page, {
    data: {
      blocks: elements,
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

const paste = async (page: Page, locator: Locator, data: Record<string, string>): Promise<void> => {
  await locator.evaluate((element: HTMLElement, pasteData: Record<string, string>) => {
    const pasteEvent = Object.assign(new Event('paste', {
      bubbles: true,
      cancelable: true,
    }), {
      clipboardData: {
        getData: (type: string): string => pasteData[type] ?? '',
        types: Object.keys(pasteData),
      },
    });

    element.dispatchEvent(pasteEvent);
  }, data);
};

const pasteFiles = async (page: Page, locator: Locator, files: ClipboardFileDescriptor[]): Promise<void> => {
  await locator.evaluate((element: HTMLElement, fileDescriptors: ClipboardFileDescriptor[]) => {
    const dataTransfer = new DataTransfer();

    fileDescriptors.forEach(({ name, type, content }) => {
      const file = new File([ content ], name, { type });

      dataTransfer.items.add(file);
    });

    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer,
    });

    /**
     * Firefox doesn't always honor the clipboardData passed to the constructor.
     * We force-set it using Object.defineProperty if it differs from our DataTransfer.
     */
    if (pasteEvent.clipboardData !== dataTransfer) {
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: dataTransfer,
        writable: false,
        configurable: true,
      });
    }

    element.dispatchEvent(pasteEvent);
  }, files);
};

const selectAllText = async (locator: Locator): Promise<void> => {
  await locator.evaluate((element) => {
    const ownerDocument = element.ownerDocument;

    if (!ownerDocument) {
      throw new Error('Owner document is not available');
    }

    const selection = ownerDocument.getSelection();

    if (!selection) {
      throw new Error('Selection API is not available');
    }

    const walker = ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes: Node[] = [];
    let currentNode = walker.nextNode();

    while (currentNode) {
      textNodes.push(currentNode);
      currentNode = walker.nextNode();
    }

    if (textNodes.length === 0) {
      throw new Error('Nothing to select');
    }

    const startNode = textNodes[0];
    const endNode = textNodes[textNodes.length - 1];
    const endOffset = endNode.textContent?.length ?? 0;

    const range = ownerDocument.createRange();

    range.setStart(startNode, 0);
    range.setEnd(endNode, endOffset);

    selection.removeAllRanges();
    selection.addRange(range);
    ownerDocument.dispatchEvent(new Event('selectionchange'));
  });
};

const withClipboardEvent = async (
  locator: Locator,
  eventName: 'copy' | 'cut'
): Promise<Record<string, string>> => {
  return await locator.evaluate((element, type) => {
    return new Promise<Record<string, string>>((resolve) => {
      const clipboardStore: Record<string, string> = {};
      const isClipboardEventSupported = typeof ClipboardEvent === 'function';
      const isDataTransferSupported = typeof DataTransfer === 'function';

      if (!isClipboardEventSupported || !isDataTransferSupported) {
        resolve(clipboardStore);

        return;
      }

      const dataTransfer = new DataTransfer();

      /**
       * Firefox doesn't properly expose data set via setData() when reading
       * from the DataTransfer after event dispatch. We wrap setData to capture
       * the data directly as it's being set by the event handler.
       */
      const originalSetData = dataTransfer.setData.bind(dataTransfer);

      dataTransfer.setData = (format: string, data: string): void => {
        clipboardStore[format] = data;
        originalSetData(format, data);
      };

      const event = new ClipboardEvent(type, {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });

      /**
       * Firefox doesn't always honor the clipboardData passed to the constructor.
       * We force-set it using Object.defineProperty if it differs from our DataTransfer.
       */
      if (event.clipboardData !== dataTransfer) {
        Object.defineProperty(event, 'clipboardData', {
          value: dataTransfer,
          writable: false,
          configurable: true,
        });
      }

      element.dispatchEvent(event);

      setTimeout(() => {
        /**
         * Also try reading from DataTransfer directly (works in Chromium).
         * This ensures we capture any data that might have been set without
         * going through our wrapped setData (though this shouldn't happen).
         */
        Array.from(dataTransfer.types).forEach((format) => {
          if (!(format in clipboardStore)) {
            clipboardStore[format] = dataTransfer.getData(format);
          }
        });

        resolve(clipboardStore);
      }, 0);
    });
  }, eventName);
};

const copyFromElement = async (locator: Locator): Promise<Record<string, string>> => {
  return await withClipboardEvent(locator, 'copy');
};

const cutFromElement = async (locator: Locator): Promise<Record<string, string>> => {
  return await withClipboardEvent(locator, 'cut');
};

test.describe('copy and paste', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('pasting', () => {
    test('should paste plain text', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {

        'text/plain': 'Some plain text',
      });

      await expect(block).toContainText('Some plain text');
    });

    test('should paste inline html data', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {

        'text/html': '<p><b>Some text</b></p>',
      });

      await expect(block.getByRole('strong')).toHaveText('Some text');
    });

    test('should paste several blocks if plain text contains new lines', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {

        'text/plain': 'First block\n\nSecond block',
      });

      const blocks = page.locator(BLOCK_SELECTOR);

      await expect(blocks).toHaveText(['First block', 'Second block']);
    });

    test('should paste plain text with special characters intact', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);
      const specialText = 'Emoji 🚀 — “quotes” — 你好 — نص عربي — ñandú';

      await block.click();
      await paste(page, block, {

        'text/plain': specialText,
      });

      await expect(block).toHaveText(specialText);
    });

    test('should paste several blocks if html contains several paragraphs', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {

        'text/html': '<p>First block</p><p>Second block</p>',
      });

      const blocks = page.locator(BLOCK_SELECTOR);

      await expect(blocks).toHaveText(['First block', 'Second block']);
    });

    test('should paste using custom data type', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {

        'application/x-blok': JSON.stringify([
          {
            tool: 'paragraph',
            data: { text: 'First block' },
          },
          {
            tool: 'paragraph',
            data: { text: 'Second block' },
          },
        ]),
      });

      const blocks = page.locator(BLOCK_SELECTOR);

      await expect(blocks).toHaveText(['First block', 'Second block']);
    });

    test('should parse block tags', async ({ page }) => {
      await page.addScriptTag({ path: HEADER_TOOL_UMD_PATH });

      await createBlok(page, {
        tools: {
          header: {
            className: 'Header',
          },
        },
      });

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {

        'text/html': '<h2>First block</h2><p>Second block</p>',
      });

      const headerBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="header"]`);
      const paragraphBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]:nth-last-of-type(1)`);

      await expect(headerBlock).toHaveText('First block');
      await expect(paragraphBlock).toHaveText('Second block');

      const output = await saveBlok(page);

      expect(output.blocks[0]?.type).toBe('header');
      expect(output.blocks[0]?.data).toMatchObject({
        text: 'First block',
        level: 2,
      });
      expect(output.blocks[1]?.type).toBe('paragraph');
      expect(output.blocks[1]?.data).toMatchObject({
        text: 'Second block',
      });
    });

    test('should sanitize dangerous HTML fragments on paste', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);
      const maliciousHtml = `
        <div>
          <p>Safe text</p>
          <script>window.__maliciousPasteExecuted = true;</script>
          <p>Another line</p>
        </div>
      `;

      await block.click();
      await paste(page, block, {

        'text/html': maliciousHtml,
      });

      await expect(page.locator(BLOCK_SELECTOR)).toHaveText(['Safe text', 'Another line']);

      const scriptExecuted = await page.evaluate(() => {
        return window.__maliciousPasteExecuted ?? false;
      });

      expect(scriptExecuted).toBe(false);
    });

    test('should fall back to plain text when invalid Blok data is pasted', async ({ page }) => {
      await createBlok(page);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await paste(page, paragraph, {

        'application/x-blok': '{not-valid-json',

        'text/plain': 'Fallback plain text',
      });

      await expect(getParagraphByIndex(page, 0)).toContainText('Fallback plain text');
    });

    test('should handle file pastes via paste config', async ({ page }) => {
      const fileToolSource = `
      class FilePasteTool {
        constructor({ data }) {
          this.data = data ?? {};
          this.element = null;
        }

        static get pasteConfig() {
          return {
            files: {
              extensions: ['png'],
              mimeTypes: ['image/png'],
            },
          };
        }

        render() {
          this.element = document.createElement('div');
          this.element.className = 'file-paste-tool';
          this.element.setAttribute('data-blok-testid', 'file-paste-tool');
          this.element.contentEditable = 'true';
          this.element.textContent = this.data.text ?? 'Paste file here';

          return this.element;
        }

        save(element) {
          return {
            text: element.textContent ?? '',
          };
        }

        onPaste(event) {
          const file = event.detail?.file ?? null;

          window.__lastPastedFile = file
            ? { name: file.name, type: file.type, size: file.size }
            : null;

          if (file && this.element) {
            this.element.textContent = 'Pasted file: ' + file.name;
          }
        }
      }
      `;

      await createBlok(page, {
        tools: {
          fileTool: {
            classCode: fileToolSource,
          },
        },
        data: {
          blocks: [
            {
              type: 'fileTool',
              data: {},
            },
          ],
        },
      });

      const block = page.getByTestId('file-paste-tool');

      await expect(block).toHaveCount(1);
      await block.click();

      await pasteFiles(page, block, [
        {
          name: 'pasted-image.png',
          type: 'image/png',
          content: 'fake-image-content',
        },
      ]);

      await expect(block).toContainText('Pasted file: pasted-image.png');

      const fileMeta = await page.evaluate(() => window.__lastPastedFile);

      expect(fileMeta).toMatchObject({
        name: 'pasted-image.png',
        type: 'image/png',
      });
    });

    test('should paste content copied from external applications', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);
      const externalHtml = `
        <html>
          <head>
            <meta charset="utf-8">
            <style>p { color: red; }</style>
          </head>
          <body>
            <!--StartFragment-->
            <p>Copied from Word</p>
            <p><b>Styled</b> paragraph</p>
            <!--EndFragment-->
          </body>
        </html>
      `;
      const plainFallback = 'Copied from Word\n\nStyled paragraph';

      await block.click();
      await paste(page, block, {

        'text/html': externalHtml,

        'text/plain': plainFallback,
      });

      const blocks = page.locator(BLOCK_SELECTOR);
      const secondParagraph = getParagraphByIndex(page, 1);

      await expect(blocks).toHaveCount(2);
      await expect(getParagraphByIndex(page, 0)).toContainText('Copied from Word');
      await expect(secondParagraph).toContainText('Styled paragraph');
      await expect(secondParagraph.getByRole('strong')).toHaveText('Styled');
    });
    test('should not prevent default behaviour if block paste config equals false', async ({ page }) => {
      const blockToolSource = `
      class BlockToolWithPasteHandler {
        static get pasteConfig() {
          return false;
        }

        render() {
          const block = document.createElement('div');

          block.className = 'blok-element-with-disabled-prevent-default';
          block.setAttribute('data-blok-testid', 'block-with-disabled-prevent-default');
          block.contentEditable = 'true';

          block.addEventListener('paste', (event) => {
            if (!Array.isArray(window.blockToolPasteEvents)) {
              window.blockToolPasteEvents = [];
            }

            window.blockToolPasteEvents.push({
              defaultPrevented: event.defaultPrevented,
            });
          });

          return block;
        }

        save() {
          return {};
        }
      }
      `;

      await createBlok(page, {
        tools: {
          blockToolWithPasteHandler: {
            classCode: blockToolSource,
          },
        },
        data: {
          blocks: [
            {
              type: 'blockToolWithPasteHandler',
              data: {},
            },
          ],
        },
      });

      const block = page.getByTestId('block-with-disabled-prevent-default');

      await expect(block).toHaveCount(1);

      await paste(page, block, {

        'text/plain': 'Hello',
      });

      const events = await page.waitForFunction(() => {
        return window.blockToolPasteEvents?.length ? window.blockToolPasteEvents : undefined;
      });

      const eventList = await events.jsonValue();

      expect(eventList).toBeDefined();
      expect(eventList).toHaveLength(1);
      expect(eventList?.[0]?.defaultPrevented).toBe(false);
    });
  });

  test.describe('copying', () => {
    test('should copy inline fragment', async ({ page }) => {
      await createBlok(page);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await paragraph.type('Some text');
      await selectAllText(paragraph);

      const clipboardData = await copyFromElement(paragraph);

      expect(clipboardData).toStrictEqual({});
    });

    test('should copy several blocks', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: 'First block' },
        },
        {
          type: 'paragraph',
          data: { text: 'Second block' },
        },
      ]);
      const secondParagraph = getParagraphByIndex(page, 1);

      await secondParagraph.click();
      const commandModifier = await getCommandModifierKey(page);

      await page.keyboard.press(`${commandModifier}+A`);
      await page.keyboard.press(`${commandModifier}+A`);

      const clipboardData = await copyFromElement(secondParagraph);

      expect(clipboardData['text/html']).toMatch(/<p>First block(<br>)?<\/p><p>Second block(<br>)?<\/p>/);
      expect(clipboardData['text/plain']).toBe('First block\n\nSecond block');

      expect(clipboardData['application/x-blok']).toBeDefined();

      const data = JSON.parse(clipboardData['application/x-blok']);

      expect(data[0]?.tool).toBe('paragraph');
      expect(data[0]?.data?.text).toMatch(/First block(<br>)?/);
      expect(data[1]?.tool).toBe('paragraph');
      expect(data[1]?.data?.text).toMatch(/Second block(<br>)?/);
    });
  });

  test.describe('cutting', () => {
    test('should cut inline fragment', async ({ page }) => {
      await createBlok(page);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await paragraph.type('Some text');
      await selectAllText(paragraph);

      const clipboardData = await cutFromElement(paragraph);

      expect(clipboardData).toStrictEqual({});
    });

    test('should cut several blocks', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: 'First block' },
        },
        {
          type: 'paragraph',
          data: { text: 'Second block' },
        },
      ]);

      const secondParagraph = getParagraphByIndex(page, 1);

      await secondParagraph.click();
      const commandModifier = await getCommandModifierKey(page);

      await page.keyboard.press(`${commandModifier}+A`);
      await page.keyboard.press(`${commandModifier}+A`);

      const clipboardData = await cutFromElement(secondParagraph);

      expect(clipboardData['text/html']).toMatch(/<p>First block(<br>)?<\/p><p>Second block(<br>)?<\/p>/);
      expect(clipboardData['text/plain']).toBe('First block\n\nSecond block');

      const serializedBlocks = clipboardData['application/x-blok'];

      expect(serializedBlocks).toBeDefined();

      const data = JSON.parse(serializedBlocks);

      expect(data[0]?.tool).toBe('paragraph');
      expect(data[0]?.data?.text).toMatch(/First block(<br>)?/);
      expect(data[1]?.tool).toBe('paragraph');
      expect(data[1]?.data?.text).toMatch(/Second block(<br>)?/);

      await expect(page.locator(BLOK_INTERFACE_SELECTOR)).not.toContainText('First block');
      await expect(page.locator(BLOK_INTERFACE_SELECTOR)).not.toContainText('Second block');
    });

    test('should cut lots of blocks', async ({ page }) => {
      const numberOfBlocks = 50;
      const elements: OutputData['blocks'] = Array.from({ length: numberOfBlocks }, (_, index) => ({
        type: 'paragraph',
        data: {
          text: `Block ${index}`,
        },
      }));

      await createBlokWithElements(page, elements);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Control+A');

      const clipboardData = await cutFromElement(firstParagraph);
      const serializedBlocks = clipboardData['application/x-blok'];

      expect(serializedBlocks).toBeDefined();

      const data = JSON.parse(serializedBlocks);

      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(numberOfBlocks);
    });
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    blockToolPasteEvents?: Array<{ defaultPrevented: boolean }>;
    __lastPastedFile?: { name: string; type: string; size: number } | null;
    __maliciousPasteExecuted?: boolean;
  }
}



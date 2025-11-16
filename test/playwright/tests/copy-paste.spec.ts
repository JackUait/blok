import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type EditorJS from '@/types';
import type { EditorConfig, OutputData } from '@/types';
import { ensureEditorBundleBuilt } from './helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR } from '../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../fixtures/test.html')
).href;

const HEADER_TOOL_UMD_PATH = path.resolve(
  __dirname,
  '../../../node_modules/@editorjs/header/dist/header.umd.js'
);

const SIMPLE_IMAGE_TOOL_UMD_PATH = path.resolve(
  __dirname,
  '../../../node_modules/@editorjs/simple-image/dist/simple-image.umd.js'
);

const HOLDER_ID = 'editorjs';
const BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} div.ce-block`;
const getBlockByIndex = (page: Page, index: number): Locator => {
  return page.locator(`${BLOCK_SELECTOR}:nth-of-type(${index + 1})`);
};

const getParagraphByIndex = (page: Page, index: number): Locator => {
  return getBlockByIndex(page, index).locator('.ce-paragraph');
};

type SerializableToolConfig = {
  className?: string;
  classCode?: string;
  config?: Record<string, unknown>;
};

type CreateEditorOptions = Pick<EditorConfig, 'data' | 'inlineToolbar' | 'placeholder' | 'readOnly'> & {
  tools?: Record<string, SerializableToolConfig>;
};

type ClipboardFileDescriptor = {
  name: string;
  type: string;
  content: string;
};

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
  await resetEditor(page);

  const { tools = {}, ...editorOptions } = options;

  const serializedTools = Object.entries(tools).map(([name, tool]) => {
    return {
      name,
      className: tool.className ?? null,
      classCode: tool.classCode ?? null,
      toolConfig: tool.config ?? {},
    };
  });

  await page.evaluate(
    async ({ holderId, editorOptions: rawOptions, serializedTools: toolsConfig }) => {
      const { data, ...restOptions } = rawOptions;
      const config: Record<string, unknown> = {
        holder: holderId,
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
              // eslint-disable-next-line no-new-func -- constructing helper class inside page context
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

      const editor = new window.EditorJS(config as EditorConfig);

      window.editorInstance = editor;

      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
      editorOptions,
      serializedTools,
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

  await page.evaluate(() => {
    return new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  });
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

    element.dispatchEvent(pasteEvent);
  }, files);

  await page.evaluate(() => {
    return new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  });
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
      const clipboardData: Record<string, string> = {};
      const event = Object.assign(new Event(type, {
        bubbles: true,
        cancelable: true,
      }), {
        clipboardData: {
          setData: (format: string, value: string) => {
            clipboardData[format] = value;
          },
        },
      });

      element.dispatchEvent(event);

      setTimeout(() => {
        resolve(clipboardData);
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
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test.describe('pasting', () => {
    test('should paste plain text', async ({ page }) => {
      await createEditor(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/plain': 'Some plain text',
      });

      await expect(block).toContainText('Some plain text');
    });

    test('should paste inline html data', async ({ page }) => {
      await createEditor(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': '<p><b>Some text</b></p>',
      });

      await expect(block.locator('b')).toHaveText('Some text');
    });

    test('should paste several blocks if plain text contains new lines', async ({ page }) => {
      await createEditor(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/plain': 'First block\n\nSecond block',
      });

      const blocks = page.locator(BLOCK_SELECTOR);
      const texts = (await blocks.allTextContents()).map((text) => text.trim()).filter(Boolean);

      expect(texts).toStrictEqual(['First block', 'Second block']);
    });

    test('should paste plain text with special characters intact', async ({ page }) => {
      await createEditor(page);

      const block = getBlockByIndex(page, 0);
      const specialText = 'Emoji 🚀 — “quotes” — 你好 — نص عربي — ñandú';

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/plain': specialText,
      });

      await expect(block).toHaveText(specialText);
    });

    test('should paste several blocks if html contains several paragraphs', async ({ page }) => {
      await createEditor(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': '<p>First block</p><p>Second block</p>',
      });

      const blocks = page.locator(BLOCK_SELECTOR);
      const texts = (await blocks.allTextContents()).map((text) => text.trim()).filter(Boolean);

      expect(texts).toStrictEqual(['First block', 'Second block']);
    });

    test('should paste using custom data type', async ({ page }) => {
      await createEditor(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'application/x-editor-js': JSON.stringify([
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
      const texts = (await blocks.allTextContents()).map((text) => text.trim()).filter(Boolean);

      expect(texts).toStrictEqual(['First block', 'Second block']);
    });

    test('should parse block tags', async ({ page }) => {
      await page.addScriptTag({ path: HEADER_TOOL_UMD_PATH });

      await createEditor(page, {
        tools: {
          header: {
            className: 'Header',
          },
        },
      });

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': '<h2>First block</h2><p>Second block</p>',
      });

      const headerBlock = page.locator(`${EDITOR_INTERFACE_SELECTOR} .ce-header`);
      const paragraphBlock = page.locator(`${EDITOR_INTERFACE_SELECTOR} .ce-paragraph:nth-last-of-type(1)`);

      await expect(headerBlock).toHaveText('First block');
      await expect(paragraphBlock).toHaveText('Second block');

      const output = await saveEditor(page);

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

    test('should parse pattern', async ({ page }) => {
      await page.addScriptTag({ path: SIMPLE_IMAGE_TOOL_UMD_PATH });

      await createEditor(page, {
        tools: {
          image: {
            className: 'SimpleImage',
          },
        },
      });

      const block = getBlockByIndex(page, 0);
      const imageUrl = 'https://codex.so/public/app/img/external/codex2x.png';

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/plain': imageUrl,
      });

      const image = page.locator(`${EDITOR_INTERFACE_SELECTOR} img`);

      await expect(image).toHaveAttribute('src', imageUrl, {
        timeout: 10_000,
      });
    });

    test('should sanitize dangerous HTML fragments on paste', async ({ page }) => {
      await createEditor(page);

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
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': maliciousHtml,
      });

      const texts = (await page.locator(BLOCK_SELECTOR).allTextContents()).map((text) => text.trim()).filter(Boolean);

      expect(texts).toStrictEqual(['Safe text', 'Another line']);

      const scriptExecuted = await page.evaluate(() => {
        return window.__maliciousPasteExecuted ?? false;
      });

      expect(scriptExecuted).toBe(false);
    });

    test('should fall back to plain text when invalid EditorJS data is pasted', async ({ page }) => {
      await createEditor(page);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await paste(page, paragraph, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'application/x-editor-js': '{not-valid-json',
        // eslint-disable-next-line @typescript-eslint/naming-convention
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

      await createEditor(page, {
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

      const block = page.locator('.file-paste-tool');

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
      await createEditor(page);

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
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': externalHtml,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/plain': plainFallback,
      });

      const blocks = page.locator(BLOCK_SELECTOR);
      const secondParagraph = getParagraphByIndex(page, 1);

      await expect(blocks).toHaveCount(2);
      await expect(getParagraphByIndex(page, 0)).toContainText('Copied from Word');
      await expect(secondParagraph).toContainText('Styled paragraph');
      await expect(secondParagraph.locator('b')).toHaveText('Styled');
    });
    test('should not prevent default behaviour if block paste config equals false', async ({ page }) => {
      const blockToolSource = `
      class BlockToolWithPasteHandler {
        static get pasteConfig() {
          return false;
        }

        render() {
          const block = document.createElement('div');

          block.className = 'ce-block-with-disabled-prevent-default';
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

      await createEditor(page, {
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

      const block = page.locator('.ce-block-with-disabled-prevent-default');

      await expect(block).toHaveCount(1);

      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/plain': 'Hello',
      });

      const events = await page.evaluate(() => {
        return window.blockToolPasteEvents ?? [];
      });

      expect(events).toHaveLength(1);
      expect(events[0]?.defaultPrevented).toBe(false);
    });
  });

  test.describe('copying', () => {
    test('should copy inline fragment', async ({ page }) => {
      await createEditor(page);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await paragraph.type('Some text');
      await selectAllText(paragraph);

      const clipboardData = await copyFromElement(paragraph);

      expect(clipboardData).toStrictEqual({});
    });

    test('should copy several blocks', async ({ page }) => {
      await createEditor(page);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await firstParagraph.type('First block');
      await page.keyboard.press('Enter');

      const secondParagraph = getParagraphByIndex(page, 1);

      await secondParagraph.type('Second block');
      await page.keyboard.press('Home');
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.up('Shift');

      const clipboardData = await copyFromElement(secondParagraph);

      expect(clipboardData['text/html']).toMatch(/<p>First block(<br>)?<\/p><p>Second block(<br>)?<\/p>/);
      expect(clipboardData['text/plain']).toBe('First block\n\nSecond block');

      expect(clipboardData['application/x-editor-js']).toBeDefined();

      const data = JSON.parse(clipboardData['application/x-editor-js']);

      expect(data[0]?.tool).toBe('paragraph');
      expect(data[0]?.data?.text).toMatch(/First block(<br>)?/);
      expect(data[1]?.tool).toBe('paragraph');
      expect(data[1]?.data?.text).toMatch(/Second block(<br>)?/);
    });
  });

  test.describe('cutting', () => {
    test('should cut inline fragment', async ({ page }) => {
      await createEditor(page);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await paragraph.type('Some text');
      await selectAllText(paragraph);

      const clipboardData = await cutFromElement(paragraph);

      expect(clipboardData).toStrictEqual({});
    });

    test('should cut several blocks', async ({ page }) => {
      await createEditorWithBlocks(page, [
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
      await page.keyboard.press('Home');
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.up('Shift');

      const clipboardData = await cutFromElement(secondParagraph);

      expect(clipboardData['text/html']).toMatch(/<p>First block(<br>)?<\/p><p>Second block(<br>)?<\/p>/);
      expect(clipboardData['text/plain']).toBe('First block\n\nSecond block');

      const serializedBlocks = clipboardData['application/x-editor-js'];

      expect(serializedBlocks).toBeDefined();

      const data = JSON.parse(serializedBlocks);

      expect(data[0]?.tool).toBe('paragraph');
      expect(data[0]?.data?.text).toMatch(/First block(<br>)?/);
      expect(data[1]?.tool).toBe('paragraph');
      expect(data[1]?.data?.text).toMatch(/Second block(<br>)?/);

      await expect(page.locator(EDITOR_INTERFACE_SELECTOR)).not.toContainText('First block');
      await expect(page.locator(EDITOR_INTERFACE_SELECTOR)).not.toContainText('Second block');
    });

    test('should cut lots of blocks', async ({ page }) => {
      const numberOfBlocks = 50;
      const blocks: OutputData['blocks'] = Array.from({ length: numberOfBlocks }, (_, index) => ({
        type: 'paragraph',
        data: {
          text: `Block ${index}`,
        },
      }));

      await createEditorWithBlocks(page, blocks);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Control+A');

      const clipboardData = await cutFromElement(firstParagraph);
      const serializedBlocks = clipboardData['application/x-editor-js'];

      expect(serializedBlocks).toBeDefined();

      const data = JSON.parse(serializedBlocks);

      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(numberOfBlocks);
    });
  });
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
    blockToolPasteEvents?: Array<{ defaultPrevented: boolean }>;
    __lastPastedFile?: { name: string; type: string; size: number } | null;
    __maliciousPasteExecuted?: boolean;
  }
}



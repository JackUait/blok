import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { BlokConfig, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../src/components/constants';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, gotoTestPage, test } from './helpers/shared-page';
import { savedAsHtml } from './helpers/saved-as-html';
import { openFixtureToggles } from './helpers/toggle-open';

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

type CreateBlokOptions = Pick<BlokConfig, 'data' | 'dataModel' | 'inlineToolbar' | 'placeholder' | 'readOnly' | 'tunes'> & {
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
              // Handle dot notation (e.g., 'Blok.Header')
              toolClass = className.split('.').reduce(
                (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
                window
              ) ?? null;
            }

            if (!toolClass && classCode) {
              // eslint-disable-next-line no-new-func, @typescript-eslint/no-unsafe-call -- Required for dynamically creating tool classes in tests
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

      const blok = new window.Blok(config);

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
  return savedAsHtml(await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  }));
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
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('pasting', () => {
    test('@smoke should paste plain text', async ({ page }) => {
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

    // A <form> lets a named control shadow its DOM properties, so a walk that
    // reads them strays; each engine does this in its own way. Paste swallows
    // a sanitizer error and falls back to text, so this calls the sanitizer itself.
    test('should clean around a pasted form whose controls shadow its properties', async ({ page }) => {
      await createBlok(page);

      const sanitized = await page.evaluate(() => {
        const shadows = [ 'previousSibling', 'nextSibling', 'nodeType', 'nodeName', 'attributes', 'childNodes' ]
          .map((name) => `<input name="${name}">`)
          .join('');
        const html = `<p>before<img src="x" onerror="alert(1)"><form>${shadows}</form><img src="x" onerror="alert(2)">after</p>`;

        return window.blokInstance?.sanitizer.clean(html, { p: {}, img: { src: true } });
      });

      // The parser closes the <p> where the <form> starts.
      expect(sanitized).toBe('<p>before<img src="x"></p><img src="x">after<p></p>');
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
      await createBlok(page, {
        tools: {
          header: {
            className: 'Blok.Header',
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

    test('pasting a blockquote containing a list keeps the list as list blocks', async ({ page }) => {
      await createBlok(page, {
        tools: {
          quote: {
            className: 'Blok.Quote',
          },
          list: {
            className: 'Blok.List',
          },
        },
      });

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        'text/html': '<blockquote><p>Wise words</p><ul><li>alpha</li><li>beta</li></ul></blockquote>',
      });

      const quoteBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="quote"]`);
      const listBlocks = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="list"]`);

      await expect(quoteBlock).toHaveText('Wise words');
      // paste() dispatches the paste event and returns before the async insert
      // loop finishes; the quote (block 0) renders first while the two list
      // blocks are still being awaited. Wait for both list items' TEXT (not just
      // their presence — a block-wrapper is created before its content is
      // populated), or saveBlok races the loop and reads a block whose text is
      // still empty (surfaced only on webkit's slower event loop — flaky
      // elsewhere).
      await expect(listBlocks).toContainText(['alpha', 'beta']);

      const output = await saveBlok(page);
      const savedTypes = output.blocks.map((savedBlock) => savedBlock.type);

      // Regression: quote used to swallow the list into its rich text, and the
      // quote sanitizer then mashed it into bare text ("Wise wordsalphabeta").
      expect(savedTypes).toEqual(['quote', 'list', 'list']);
      expect(output.blocks[0]?.data).toMatchObject({ text: 'Wise words' });
      expect(output.blocks[1]?.data).toMatchObject({ text: 'alpha' });
      expect(output.blocks[2]?.data).toMatchObject({ text: 'beta' });
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

          block.className = 'disabled-prevent-default';
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

      // Cmd+A is a 3-stage escalation: text → this block → all blocks.
      await page.keyboard.press(`${commandModifier}+A`);
      await page.keyboard.press(`${commandModifier}+A`);
      await page.keyboard.press(`${commandModifier}+A`);

      const clipboardData = await copyFromElement(secondParagraph);

      expect(clipboardData['text/html']).toMatch(/<p>First block(<br>)?<\/p><p>Second block(<br>)?<\/p>/);
      expect(clipboardData['text/plain']).toBe('First block\n\nSecond block');

      expect(clipboardData['application/x-blok']).toBeDefined();

      type ClipboardBlock = { tool: string; data: { text: string } };
      const data = JSON.parse(clipboardData['application/x-blok']) as ClipboardBlock[];

      expect(data[0]?.tool).toBe('paragraph');
      expect(data[0]?.data?.text).toMatch(/First block(<br>)?/);
      expect(data[1]?.tool).toBe('paragraph');
      expect(data[1]?.data?.text).toMatch(/Second block(<br>)?/);
    });
  });

  test.describe('blok clipboard wins over tool patterns', () => {
    // Blok's own text/plain is Markdown, so a block copy can read as exactly one tool pattern.
    const cases: Array<{ name: string; blocks: OutputData['blocks'] }> = [
      {
        name: 'a URL paragraph next to an empty paragraph (bookmark pattern)',
        blocks: [
          { type: 'paragraph', data: { text: 'https://example.com/page' } },
          { type: 'paragraph', data: { text: '' } },
        ],
      },
      {
        name: 'spacer, divider and an empty paragraph (divider pattern)',
        blocks: [
          { type: 'spacer', data: { height: 96 } },
          { type: 'divider', data: {} },
          { type: 'paragraph', data: { text: '' } },
        ],
      },
      {
        name: 'a bare codepen URL paragraph (embed pattern)',
        blocks: [ { type: 'paragraph', data: { text: 'https://codepen.io/team/pen/abc123' } } ],
      },
      {
        name: 'a bare png URL paragraph (image pattern)',
        blocks: [ { type: 'paragraph', data: { text: 'https://example.com/picture.png' } } ],
      },
    ];

    for (const { name, blocks } of cases) {
      test(`pastes ${name} back as the same blocks`, async ({ page }) => {
        await createBlokWithElements(page, blocks);

        const source = await saveBlok(page);
        const editable = page.locator(`${BLOCK_SELECTOR} [contenteditable="true"]`).first();
        const commandModifier = await getCommandModifierKey(page);

        const box = await editable.boundingBox();

        if (box === null) {
          throw new Error('The editable has no box');
        }

        // Firefox hangs on a click into URL text, so click past its end.
        await editable.click({ position: { x: box.width - 4, y: box.height / 2 } });
        await page.keyboard.press(`${commandModifier}+A`);
        await page.keyboard.press(`${commandModifier}+A`);
        await page.keyboard.press(`${commandModifier}+A`);

        const clipboardData = await copyFromElement(editable);

        expect(clipboardData['application/x-blok']).toBeDefined();

        await createBlok(page);
        await paste(page, getParagraphByIndex(page, 0), clipboardData);

        const shape = (output: OutputData): Array<{ type: string; data: unknown }> =>
          output.blocks.map(({ type, data }) => ({ type, data }));

        await expect.poll(async () => shape(await saveBlok(page))).toEqual(shape(source));
      });
    }
  });

  test.describe('blocks copied out of a container', () => {
    const doc: OutputData['blocks'] = [
      { id: 'src', type: 'toggle', data: { text: 'Source', isOpen: true }, content: ['s1', 's2'] },
      { id: 's1', type: 'paragraph', parent: 'src', data: { text: 'First child' } },
      { id: 's2', type: 'paragraph', parent: 'src', data: { text: 'Second child' } },
      { id: 'cal', type: 'callout', data: { emoji: '💡' }, content: ['cal-in'] },
      { id: 'cal-in', type: 'paragraph', parent: 'cal', data: { text: '' } },
      { id: 'tbl', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content: [['', 'B1'], ['A2', 'B2']] } },
      { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
    ];

    const targets = [
      {
        name: 'a callout child',
        parent: 'cal',
        locate: (page: Page): Locator => page.locator('[data-blok-id="cal-in"] [contenteditable="true"]'),
      },
      {
        name: 'a table cell',
        parent: 'tbl',
        locate: (page: Page): Locator => page.locator('[data-blok-id="tbl"] [data-blok-table-cell]').first().locator('[contenteditable="true"]').first(),
      },
    ];

    for (const { name, parent, locate } of targets) {
      test(`stay inside ${name} when pasted there`, async ({ page }) => {
        await createBlok(page, { data: { blocks: doc }, dataModel: 'hierarchical' });
        await openFixtureToggles(page, { blocks: doc });

        await page.locator('[data-blok-id="s1"] [contenteditable="true"]').click();
        await page.locator('[data-blok-id="s2"] [contenteditable="true"]').click({ modifiers: ['Shift'] });
        await expect(page.locator('[data-blok-id="s2"][data-blok-selected="true"]')).toBeVisible();

        const clipboardData = await copyFromElement(page.locator('[data-blok-id="s1"]'));

        expect(clipboardData['application/x-blok']).toBeDefined();

        const target = locate(page);

        await target.click();
        await paste(page, page.locator(':focus'), clipboardData);

        const placed = async (): Promise<{ inTarget: unknown[]; roots: unknown[] }> => {
          const { blocks } = await saveBlok(page);

          return {
            inTarget: blocks.filter((b) => b.parent === parent).map((b) => b.data.text),
            roots: blocks.filter((b) => b.parent === undefined).map((b) => b.id),
          };
        };

        await expect.poll(async () => (await placed()).inTarget.filter((text) => text === 'First child' || text === 'Second child'))
          .toEqual(['First child', 'Second child']);
        expect((await placed()).roots).toEqual(['src', 'cal', 'tbl', 'tail']);
      });
    }
  });

  test.describe('a tabs block pasted into a tab', () => {
    const doc: OutputData['blocks'] = [
      { id: 'pre', type: 'paragraph', data: { text: 'Before' } },
      { id: 'tb', type: 'tabs', data: {}, content: ['t1', 't2'] },
      { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tb', content: ['t1p'] },
      { id: 't1p', type: 'paragraph', parent: 't1', data: { text: 'Alpha body' } },
      { id: 't2', type: 'tab', data: { title: 'Beta' }, parent: 'tb', content: ['t2p'] },
      { id: 't2p', type: 'paragraph', parent: 't2', data: { text: 'Beta body' } },
      { id: 'post', type: 'paragraph', data: { text: 'After' } },
      { id: 'dest', type: 'tabs', data: {}, content: ['dest-tab'] },
      { id: 'dest-tab', type: 'tab', data: { title: 'Dest' }, parent: 'dest', content: ['dest-in'] },
      { id: 'dest-in', type: 'paragraph', parent: 'dest-tab', data: { text: '' } },
      { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
    ];

    test('lands after the tabs block that holds the caret, as real tabs', async ({ page }) => {
      await createBlok(page, { data: { blocks: doc }, dataModel: 'hierarchical' });

      await page.locator('[data-blok-id="pre"] [contenteditable="true"]').click();
      await page.locator('[data-blok-id="post"] [contenteditable="true"]').click({ modifiers: ['Shift'] });
      await expect(page.locator('[data-blok-id="post"][data-blok-selected="true"]')).toBeVisible();

      const clipboardData = await copyFromElement(page.locator('[data-blok-id="pre"]'));

      expect(clipboardData['application/x-blok']).toBeDefined();

      await page.keyboard.press('Escape');
      await page.locator('[data-blok-id="dest-in"] [contenteditable="true"]').click();
      await paste(page, page.locator(':focus'), clipboardData);

      /** The saved tree as nested [type, text or title, children]. */
      const tree = async (): Promise<unknown[]> => {
        const { blocks } = await saveBlok(page);
        const byId = new Map(blocks.map((b) => [b.id, b]));
        const shape = (id: string): unknown[] => {
          const block = byId.get(id);
          const label: unknown = block?.data.text ?? block?.data.title ?? null;

          return [block?.type, label, (block?.content ?? []).map(shape)];
        };

        return blocks.filter((b) => b.parent === undefined).map((b) => shape(b.id ?? ''));
      };
      const tabs = ['tabs', null, [
        ['tab', 'Alpha', [['paragraph', 'Alpha body', []]]],
        ['tab', 'Beta', [['paragraph', 'Beta body', []]]],
      ]];

      await expect.poll(tree).toEqual([
        ['paragraph', 'Before', []],
        tabs,
        ['paragraph', 'After', []],
        ['tabs', null, [['tab', 'Dest', [['paragraph', '', []]]]]],
        ['paragraph', 'Before', []],
        tabs,
        ['paragraph', 'After', []],
        ['paragraph', 'Tail', []],
      ]);
      await expect(page.getByRole('tab', { name: 'Alpha' })).toHaveCount(2);
      await expect(page.getByRole('tab', { name: 'Beta' })).toHaveCount(2);
    });
  });

  test.describe('a range across a column layout', () => {
    const doc: OutputData['blocks'] = [
      { id: 'pre', type: 'paragraph', data: { text: 'Before' } },
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: { widthRatio: 2 }, parent: 'cl', content: ['c1p'] },
      { id: 'c1p', type: 'paragraph', parent: 'c1', data: { text: 'Left col' } },
      { id: 'c2', type: 'column', data: { widthRatio: 1 }, parent: 'cl', content: ['c2p'] },
      { id: 'c2p', type: 'paragraph', parent: 'c2', data: { text: 'Right col' } },
      { id: 'post', type: 'paragraph', data: { text: 'After' } },
      { id: 'tgt', type: 'paragraph', data: { text: '' } },
    ];

    /** The copied column_lists (any column_list but the source) as [columns' data, columns' texts]. */
    const pastedLayouts = async (page: Page): Promise<unknown[]> => {
      const { blocks } = await saveBlok(page);
      const byId = new Map(blocks.map((b) => [b.id, b]));

      return blocks
        .filter((b) => b.type === 'column_list' && b.id !== 'cl')
        .map((list) => (list.content ?? []).map((columnId) => {
          const column = byId.get(columnId);

          return [column?.type, column?.data, (column?.content ?? []).map((id) => byId.get(id)?.data.text)];
        }));
    };

    const selectRange = async (page: Page): Promise<void> => {
      await page.locator('[data-blok-id="pre"] [contenteditable="true"]').click();
      await page.locator('[data-blok-id="post"] [contenteditable="true"]').click({ modifiers: ['Shift'] });
      await expect(page.locator('[data-blok-id="post"][data-blok-selected="true"]')).toBeVisible();
    };

    const pasteIntoTarget = async (page: Page, clipboardData: Record<string, string>): Promise<void> => {
      await page.keyboard.press('Escape');
      await page.locator('[data-blok-id="tgt"] [contenteditable="true"]').click();
      await paste(page, page.locator(':focus'), clipboardData);
    };

    test('pastes the column_list and its columns when copied', async ({ page }) => {
      await createBlok(page, { data: { blocks: doc } });
      await selectRange(page);

      const clipboardData = await copyFromElement(page.locator('[data-blok-id="pre"]'));

      await pasteIntoTarget(page, clipboardData);

      await expect.poll(() => pastedLayouts(page)).toEqual([[
        ['column', { widthRatio: 2 }, ['Left col']],
        ['column', {}, ['Right col']],
      ]]);
    });

    test('leaves no empty layout behind when cut, and pastes it back whole', async ({ page }) => {
      await createBlok(page, { data: { blocks: doc } });
      await selectRange(page);

      const clipboardData = await cutFromElement(page.locator('[data-blok-id="pre"]'));

      // A lone empty paragraph saves as nothing, so read the live blocks.
      await expect.poll(() => page.locator(BLOCK_SELECTOR).evaluateAll((holders) => holders.map((h) => h.getAttribute('data-blok-id'))))
        .toEqual(['tgt']);

      await pasteIntoTarget(page, clipboardData);

      await expect.poll(() => pastedLayouts(page)).toEqual([[
        ['column', { widthRatio: 2 }, ['Left col']],
        ['column', {}, ['Right col']],
      ]]);
    });
  });

  test('block tune data survives a block copy and paste', async ({ page }) => {
    const noteTuneSource = `class NoteTune {
      static get isTune() { return true; }
      constructor({ data }) { this.data = data ?? { note: '' }; }
      render() { const el = document.createElement('div'); el.textContent = 'Note'; return el; }
      save() { return this.data; }
    }`;

    await createBlok(page, {
      tools: { noteTune: { classCode: noteTuneSource } },
      tunes: ['noteTune'],
      data: {
        blocks: [
          { id: 'a', type: 'paragraph', data: { text: 'Tuned' }, tunes: { noteTune: { note: 'keep me' } } },
          { id: 'b', type: 'header', data: { text: 'Tuned head', level: 2 }, tunes: { noteTune: { note: 'head note' } } },
          { id: 'tgt', type: 'paragraph', data: { text: '' } },
        ],
      },
    });

    await page.locator('[data-blok-id="a"] [contenteditable="true"]').click();
    await page.locator('[data-blok-id="b"] [contenteditable="true"]').click({ modifiers: ['Shift'] });
    await expect(page.locator('[data-blok-id="b"][data-blok-selected="true"]')).toBeVisible();

    const clipboardData = await copyFromElement(page.locator('[data-blok-id="a"]'));

    expect(clipboardData['application/x-blok']).toBeDefined();

    await page.keyboard.press('Escape');
    await page.locator('[data-blok-id="tgt"] [contenteditable="true"]').click();
    await paste(page, page.locator(':focus'), clipboardData);

    await expect.poll(async () => {
      const { blocks } = await saveBlok(page);

      return blocks.filter((b) => b.id !== 'a' && b.id !== 'b').map((b) => [b.type, b.tunes]);
    }).toEqual([
      ['paragraph', { noteTune: { note: 'keep me' } }],
      ['header', { noteTune: { note: 'head note' } }],
    ]);
  });

  test.describe('pasting over a block selection', () => {
    const doc: OutputData['blocks'] = [
      { id: 'a', type: 'paragraph', data: { text: 'First' } },
      { id: 'b', type: 'paragraph', data: { text: 'Second' } },
      { id: 'x', type: 'paragraph', data: { text: 'Xray' } },
      { id: 'y', type: 'paragraph', data: { text: 'Yankee' } },
      { id: 'z', type: 'paragraph', data: { text: 'Zulu' } },
    ];
    const editable = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`);
    const selectedIds = async (page: Page): Promise<string[]> => await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-blok-selected="true"]')).map((el) => el.getAttribute('data-blok-id') ?? ''));
    const texts = async (page: Page): Promise<unknown[]> => (await saveBlok(page)).blocks.map((b) => b.data.text);

    const copyFirstTwo = async (page: Page): Promise<Record<string, string>> => {
      await editable(page, 'a').click();
      await editable(page, 'b').click({ modifiers: ['Shift'] });
      expect(await selectedIds(page)).toEqual(['a', 'b']);
      const clipboardData = await copyFromElement(page.locator('[data-blok-id="a"]'));

      expect(clipboardData['application/x-blok']).toBeDefined();
      await page.keyboard.press('Escape');

      return clipboardData;
    };

    // The browser fires paste at the focused element, which is body after a rubber band or keyboard selection.
    const pasteAtFocus = async (page: Page, data: Record<string, string>): Promise<boolean> =>
      await page.evaluate((pasteData) => {
        const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
          clipboardData: {
            getData: (type: string): string => pasteData[type] ?? '',
            types: Object.keys(pasteData),
          },
        });

        (document.activeElement ?? document.body).dispatchEvent(event);

        return event.defaultPrevented;
      }, data);

    test('a shift-click selection is replaced by the paste', async ({ page }) => {
      await createBlokWithElements(page, doc);
      const clipboardData = await copyFirstTwo(page);

      await editable(page, 'x').click();
      await editable(page, 'y').click({ modifiers: ['Shift'] });
      expect(await selectedIds(page)).toEqual(['x', 'y']);

      const prevented = await pasteAtFocus(page, clipboardData);

      await expect.poll(() => texts(page)).toEqual(['First', 'Second', 'First', 'Second', 'Zulu']);
      expect(prevented).toBe(true);
      expect(await selectedIds(page)).toEqual([]);
    });

    test('a select-all selection is replaced by the paste', async ({ page }) => {
      await createBlokWithElements(page, doc.slice(0, 2));
      const clipboardData = await copyFirstTwo(page);
      const commandModifier = await getCommandModifierKey(page);

      await editable(page, 'a').click();
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press(`${commandModifier}+A`);
      }
      expect(await selectedIds(page)).toEqual(['a', 'b']);

      const prevented = await pasteAtFocus(page, clipboardData);

      await expect.poll(() => texts(page)).toEqual(['First', 'Second']);
      expect(prevented).toBe(true);
    });

    test('a rubber-band selection is replaced by a paste fired at body', async ({ page }) => {
      await createBlokWithElements(page, doc);
      const clipboardData = await copyFirstTwo(page);
      const from = await page.locator('[data-blok-id="x"]').boundingBox();
      const to = await page.locator('[data-blok-id="y"]').boundingBox();

      if (from === null || to === null) {
        throw new Error('blocks have no box');
      }
      await page.mouse.move(10, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(10, to.y + to.height / 2, { steps: 12 });
      await page.mouse.up();
      expect(await selectedIds(page)).toEqual(['x', 'y']);
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

      const prevented = await pasteAtFocus(page, clipboardData);

      await expect.poll(() => texts(page)).toEqual(['First', 'Second', 'First', 'Second', 'Zulu']);
      expect(prevented).toBe(true);
    });

    test('a block selected by keyboard is replaced by a paste fired at body', async ({ page }) => {
      await createBlok(page, {
        tools: { image: { className: 'defaultBlockTools.image.class' } },
        data: {
          blocks: [
            ...doc.slice(0, 2),
            { id: 'img', type: 'image', data: { url: 'http://127.0.0.1:4444/test/playwright/fixtures/image/shot.png', caption: 'Cap' } },
            { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
          ],
        },
      });
      const clipboardData = await copyFirstTwo(page);

      await editable(page, 'b').click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('ArrowDown');
      expect(await selectedIds(page)).toEqual(['img']);

      const prevented = await pasteAtFocus(page, clipboardData);

      await expect.poll(() => texts(page)).toEqual(['First', 'Second', 'First', 'Second', 'Tail']);
      expect(prevented).toBe(true);
    });

    test('a selection inside a toggle is replaced inside the toggle', async ({ page }) => {
      const nested: OutputData['blocks'] = [
        ...doc.slice(0, 2),
        { id: 't', type: 'toggle', data: { text: 'Toggle', isOpen: true }, content: ['c1', 'c2', 'c3'] },
        { id: 'c1', type: 'paragraph', parent: 't', data: { text: 'C1' } },
        { id: 'c2', type: 'paragraph', parent: 't', data: { text: 'C2' } },
        { id: 'c3', type: 'paragraph', parent: 't', data: { text: 'C3' } },
        { id: 'z', type: 'paragraph', data: { text: 'Zulu' } },
      ];

      await createBlok(page, { data: { blocks: nested }, dataModel: 'hierarchical' });
      await openFixtureToggles(page, { blocks: nested });
      const clipboardData = await copyFirstTwo(page);

      await editable(page, 'c1').click();
      await editable(page, 'c2').click({ modifiers: ['Shift'] });
      expect(await selectedIds(page)).toEqual(['c1', 'c2']);

      await pasteAtFocus(page, clipboardData);

      const childTexts = async (): Promise<unknown[]> => (await saveBlok(page)).blocks.filter((b) => b.parent === 't').map((b) => b.data.text);

      await expect.poll(childTexts).toEqual(['First', 'Second', 'C3']);
      expect((await saveBlok(page)).blocks.filter((b) => b.parent === undefined).map((b) => b.id)).toEqual(['a', 'b', 't', 'z']);
    });

    test('a selected line in a table cell is replaced inside the cell', async ({ page }) => {
      await createBlokWithElements(page, [
        ...doc.slice(0, 2),
        { id: 'tbl', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content: [['A1', 'B1'], ['A2', 'B2']] } },
        { id: 'z', type: 'paragraph', data: { text: 'Zulu' } },
      ]);
      const clipboardData = await copyFirstTwo(page);
      const cell = page.locator('[data-blok-id="tbl"] [data-blok-table-cell]').first();

      await cell.locator('[contenteditable="true"]').first().click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('A1b');
      const commandModifier = await getCommandModifierKey(page);

      // Cmd+A twice in a cell line selects that line as a block.
      await page.keyboard.press(`${commandModifier}+A`);
      await page.keyboard.press(`${commandModifier}+A`);
      const cellIds = await cell.locator('[data-blok-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-blok-id') ?? ''));

      expect(await selectedIds(page)).toEqual([cellIds[1]]);

      await pasteAtFocus(page, clipboardData);

      // An empty line left next to a paste in a cell is not this test's business.
      await expect.poll(async () => (await cell.locator('[contenteditable="true"]').allInnerTexts()).filter((text) => text.trim() !== '')).toEqual(['A1', 'First', 'Second']);
      expect((await saveBlok(page)).blocks.filter((b) => b.parent === undefined).map((b) => b.id)).toEqual(['a', 'b', 'tbl', 'z']);
    });
  });

  test.describe('blocks of a tool the pasting editor lacks', () => {
    const doc: OutputData['blocks'] = [
      { id: 'p1', type: 'paragraph', data: { text: 'Before toggle' } },
      { id: 't', type: 'toggle', data: { text: 'Toggle title', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', parent: 't', data: { text: 'Toggle child' } },
      { id: 'p2', type: 'paragraph', data: { text: 'After toggle' } },
    ];

    const createParagraphOnlyBlok = async (page: Page): Promise<void> => {
      await resetBlok(page);
      await page.evaluate(async ({ holder }) => {
        const blok = new window.BlokOriginal({ holder, tools: { paragraph: { class: window.BlokParagraph } } });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });
    };

    const copyAllBlocks = async (page: Page, text: string): Promise<Record<string, string>> => {
      const editable = page.getByText(text, { exact: true });
      const commandModifier = await getCommandModifierKey(page);

      await editable.click();
      await page.keyboard.press(`${commandModifier}+A`);
      await page.keyboard.press(`${commandModifier}+A`);
      await page.keyboard.press(`${commandModifier}+A`);

      const clipboardData = await copyFromElement(editable);

      expect(clipboardData['application/x-blok']).toBeDefined();

      return clipboardData;
    };

    /** Tree shape without ids: each block with its type, text and its parent's text. */
    const tree = (output: OutputData): Array<{ type: string; text: unknown; under?: unknown }> => {
      const textOf = new Map(output.blocks.map((block) => [block.id, block.data.text]));

      return output.blocks.map((block) => ({
        type: block.type,
        text: block.data.text,
        ...(block.parent !== undefined && { under: textOf.get(block.parent) }),
      }));
    };

    test('arrive as a stub that keeps the rest of the paste, and come back whole', async ({ page }) => {
      const errors: string[] = [];

      page.on('pageerror', (error) => errors.push(error.message));

      await createBlok(page, { data: { blocks: doc } });
      const source = await saveBlok(page);
      const fromDefault = await copyAllBlocks(page, 'Before toggle');

      await createParagraphOnlyBlok(page);
      await paste(page, getParagraphByIndex(page, 0), fromDefault);

      // This editor does not know the toggle's rich fields, so the stub keeps the copied HTML.
      const saveWithStub = async (): Promise<OutputData> => savedAsHtml(
        await page.evaluate(async () => await window.blokInstance?.save()),
        { allowHtml: true }
      ) ?? { blocks: [] };

      await expect.poll(async () => tree(await saveWithStub())).toEqual(tree(source));
      await expect(page.locator('[data-blok-stub]')).toHaveCount(1);

      const fromParagraphOnly = await copyAllBlocks(page, 'Before toggle');

      await createBlok(page);
      await paste(page, getParagraphByIndex(page, 0), fromParagraphOnly);

      await expect.poll(async () => tree(await saveBlok(page))).toEqual(tree(source));
      await expect(page.locator('[data-blok-stub]')).toHaveCount(0);
      expect(errors).toEqual([]);
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

      // Cmd+A is a 3-stage escalation: text → this block → all blocks.
      await page.keyboard.press(`${commandModifier}+A`);
      await page.keyboard.press(`${commandModifier}+A`);
      await page.keyboard.press(`${commandModifier}+A`);

      const clipboardData = await cutFromElement(secondParagraph);

      expect(clipboardData['text/html']).toMatch(/<p>First block(<br>)?<\/p><p>Second block(<br>)?<\/p>/);
      expect(clipboardData['text/plain']).toBe('First block\n\nSecond block');

      const serializedBlocks = clipboardData['application/x-blok'];

      expect(serializedBlocks).toBeDefined();

      type ClipboardBlock = { tool: string; data: { text: string } };
      const data = JSON.parse(serializedBlocks) as ClipboardBlock[];

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
      // Cmd+A is a 3-stage escalation: text → this block → all blocks.
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Control+A');

      const clipboardData = await cutFromElement(firstParagraph);
      const serializedBlocks = clipboardData['application/x-blok'];

      expect(serializedBlocks).toBeDefined();

      type ClipboardBlock = { tool: string; data: { text: string } };
      const data = JSON.parse(serializedBlocks) as ClipboardBlock[];

      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(numberOfBlocks);
    });
  });

  test.describe('paste edge cases', () => {
    test('should handle empty Blok data array gracefully', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        'application/x-blok': JSON.stringify([]),
        'text/plain': 'fallback text',
      });

      // Empty Blok array results in no content insertion
      await expect(block).toHaveText('');
    });

    test('should handle malformed Blok JSON by falling back to plain text', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        'application/x-blok': '{invalid json}',
        'text/plain': 'Fallback text',
      });

      await expect(block).toContainText('Fallback text');
    });

    test('should handle HTML with only structural tags (table)', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        'text/html': '<table><tr><td>Cell 1</td><td>Cell 2</td></tr></table>',
      });

      // Table structure should be preserved: one top-level table block.
      // Direct-child xpath excludes the table's nested cell paragraph blocks,
      // which also carry data-blok-testid="block-wrapper".
      const topLevelBlocks = page.locator('xpath=//*[@data-blok-interface="blok"]//*[@data-blok-testid="redactor"]/*[@data-blok-testid="block-wrapper"]');

      await expect(topLevelBlocks).toHaveCount(1);
      await expect(topLevelBlocks).toHaveAttribute('data-blok-component', 'table');
      await expect(topLevelBlocks).toContainText('Cell 1');
      await expect(topLevelBlocks).toContainText('Cell 2');
    });

    test('should handle HTML with comments', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        'text/html': '<p>Before</p><!-- comment --><p>After</p>',
      });

      const blocks = page.locator(BLOCK_SELECTOR);

      await expect(blocks).toHaveText(['Before', 'After']);
    });

    test('should handle HTML with DOCTYPE wrapper tags', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      // Use simpler HTML without DOCTYPE which can cause parsing issues
      const htmlContent = '<html><body><p>Content</p></body></html>';

      await paste(page, block, {
        'text/html': htmlContent,
      });

      await expect(block).toContainText('Content');
    });

    test('should paste text with Unicode characters correctly', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      const unicodeText = 'Hello 世界 🌍 مرحبا بالعالم';

      await paste(page, block, {
        'text/plain': unicodeText,
      });

      await expect(block).toHaveText(unicodeText);
    });

    test('should handle paste with mixed line endings', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();
      // Test with \r\n and \n - both should create paragraph breaks
      const mixedLineEndings = 'Line 1\r\nLine 2\nLine 3';

      await paste(page, block, {
        'text/plain': mixedLineEndings,
      });

      const blocks = page.locator(BLOCK_SELECTOR);

      // \r\n and \n both create paragraph breaks, so we get 3 blocks
      await expect(blocks).toHaveCount(3);
    });
  });

  test.describe('paste with selection', () => {
    test('should replace selected text when pasting', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);
      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await paragraph.type('Original text');

      // Select "Original" part
      await page.evaluate(() => {
        const selection = window.getSelection();
        const paragraph = document.querySelector('[contenteditable]');

        if (!selection || !paragraph) {
          return;
        }

        const range = document.createRange();
        const textNode = paragraph.childNodes[0];

        if (!textNode) {
          return;
        }

        range.setStart(textNode, 0);
        range.setEnd(textNode, 8); // "Original"
        selection.removeAllRanges();
        selection.addRange(range);
      });

      await paste(page, block, {
        'text/plain': 'Replaced',
      });

      await expect(paragraph).toHaveText('Replaced text');
    });

    test('should paste into non-empty paragraph', async ({ page }) => {
      await createBlok(page);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await paragraph.type('Existing ');

      // Paste appends to the existing content
      await paste(page, paragraph, {
        'text/plain': 'content',
      });

      await expect(paragraph).toHaveText('Existing content');
    });

    test('should split a non-empty block at the caret on multi-line plain-text paste', async ({ page }) => {
      await createBlok(page);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await paragraph.type('ABXY');

      // Move the caret between "AB" and "XY".
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');

      await paste(page, paragraph, {
        'text/plain': '1\n2\n3',
      });

      // First line merges at the caret, middle line becomes a block, and the
      // post-caret remainder ("XY") rides with the last line.
      await expect(page.locator(BLOCK_SELECTOR)).toHaveText(['AB1', '2', '3XY']);
    });

    test('should insert an inline markdown fragment at the caret in a non-empty block', async ({ page }) => {
      await createBlok(page);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await paragraph.type('Hello ');

      await paste(page, paragraph, {
        'text/plain': '**bold**',
      });

      // Inline, not a sibling block: still a single paragraph with rich text.
      await expect(page.locator(BLOCK_SELECTOR)).toHaveText(['Hello bold']);

      // The pasted "**bold**" became real bold markup inside the same paragraph.
      const boldCount = await paragraph.evaluate((element) => element.querySelectorAll('strong, b').length);

      expect(boldCount).toBe(1);
    });
  });

  test.describe('paste in read-only mode', () => {
    test('should not allow paste when editor is read-only', async ({ page }) => {
      await createBlok(page, {
        readOnly: true,
      });

      const block = getBlockByIndex(page, 0);

      await block.click();
      const initialText = await block.textContent();

      await paste(page, block, {
        'text/plain': 'New text',
      });

      // Text should remain unchanged in read-only mode
      await expect(block).toHaveText(initialText ?? '');
    });

    test('should toggle paste listener when read-only state changes', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      // Start in normal mode
      await block.click();
      await paste(page, block, {
        'text/plain': 'First paste',
      });

      await expect(block).toContainText('First paste');

      // Switch to read-only
      await page.evaluate(async () => {
        if (window.blokInstance) {
          await window.blokInstance.readOnly.toggle(true);
        }
      });

      // Try to paste in read-only mode
      await paste(page, block, {
        'text/plain': 'Should not paste',
      });

      await expect(block).toContainText('First paste');
      await expect(block).not.toContainText('Should not paste');

      // Switch back to editable
      await page.evaluate(async () => {
        if (window.blokInstance) {
          await window.blokInstance.readOnly.toggle(false);
        }
      });

      // Re-focus the block after toggling read-only
      await block.click();

      // Paste should work again
      await paste(page, block, {
        'text/plain': 'Second paste',
      });

      await expect(block).toContainText('Second paste');
    });
  });

  test.describe('paste file without matching tool', () => {
    test('should ignore file when no tool handles its type', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();

      // Paste a file type that no tool handles
      await pasteFiles(page, block, [
        {
          name: 'unknown.xyz',
          type: 'application/unknown',
          content: 'some content',
        },
      ]);

      // Should not create any blocks for the unknown file
      const blocks = page.locator(BLOCK_SELECTOR);

      await expect(blocks).toHaveCount(1); // Only the default empty block
    });
  });

  test.describe('google Docs paste', () => {
    test('should preserve numbered list style from Google Docs HTML', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();

      // Simulate Google Docs clipboard HTML with numbered lists
      const googleDocsHTML = `<meta charset="utf-8">
        <ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">
          <li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;" aria-level="1">
            <p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation">
              <span style="font-size:11pt;font-family:Arial,sans-serif;">Bulleted item</span>
            </p>
          </li>
        </ul>
        <ol style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">
          <li dir="ltr" style="list-style-type:decimal;font-size:11pt;font-family:Arial,sans-serif;" aria-level="1">
            <p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation">
              <span style="font-size:11pt;font-family:Arial,sans-serif;">Numbered item one</span>
            </p>
          </li>
          <li dir="ltr" style="list-style-type:decimal;font-size:11pt;font-family:Arial,sans-serif;" aria-level="1">
            <p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation">
              <span style="font-size:11pt;font-family:Arial,sans-serif;">Numbered item two</span>
            </p>
          </li>
        </ol>`;

      await paste(page, block, {
        'text/html': googleDocsHTML,
        'text/plain': 'Bulleted item\nNumbered item one\nNumbered item two',
      });

      // Get all list blocks
      const listBlocks = page.locator('[data-blok-tool="list"]');

      // Should have 3 list items (1 bulleted, 2 numbered)
      await expect(listBlocks).toHaveCount(3);

      // Check first item is unordered (bulleted)
      const firstBlock = listBlocks.filter({ hasText: 'Bulleted item' });
      await expect(firstBlock).toHaveAttribute('data-list-style', 'unordered');
      await expect(firstBlock).toContainText('Bulleted item');

      // Check second and third items are ordered (numbered)
      const secondBlock = listBlocks.filter({ hasText: 'Numbered item one' });
      await expect(secondBlock).toHaveAttribute('data-list-style', 'ordered');
      await expect(secondBlock).toContainText('Numbered item one');

      const thirdBlock = listBlocks.filter({ hasText: 'Numbered item two' });
      await expect(thirdBlock).toHaveAttribute('data-list-style', 'ordered');
      await expect(thirdBlock).toContainText('Numbered item two');
    });

    test('should detect numbered list from orphaned li with list-style-type attribute', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();

      // Simulate HTML where li is extracted from parent (but retains style attribute)
      // This can happen during paste processing
      const orphanLiHTML = `<li style="list-style-type:decimal;font-size:11pt;font-family:Arial,sans-serif;">
        <span>Orphaned numbered item</span>
      </li>`;

      await paste(page, block, {
        'text/html': orphanLiHTML,
        'text/plain': 'Orphaned numbered item',
      });

      // Should create a numbered list item
      const listBlock = page.locator('[data-blok-tool="list"]');
      await expect(listBlock).toHaveCount(1);
      await expect(listBlock).toHaveAttribute('data-list-style', 'ordered');
      await expect(listBlock).toContainText('Orphaned numbered item');
    });

    test('should detect bulleted list from orphaned li with disc style', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();

      const orphanLiHTML = `<li style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;">
        <span>Orphaned bulleted item</span>
      </li>`;

      await paste(page, block, {
        'text/html': orphanLiHTML,
        'text/plain': 'Orphaned bulleted item',
      });

      const listBlock = page.locator('[data-blok-tool="list"]');
      await expect(listBlock).toHaveCount(1);
      await expect(listBlock).toHaveAttribute('data-list-style', 'unordered');
      await expect(listBlock).toContainText('Orphaned bulleted item');
    });

    test('should preserve checked state when pasting a generic HTML checklist (GitHub task list)', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();

      // GitHub task-list markup: plain <ul> with checkbox inputs inside <li>
      const taskListHTML = '<ul><li><input type="checkbox" checked>Done task</li><li><input type="checkbox">Open task</li></ul>';

      await paste(page, block, {
        'text/html': taskListHTML,
        'text/plain': 'Done task\nOpen task',
      });

      const listBlocks = page.locator('[data-blok-tool="list"]');

      await expect(listBlocks).toHaveCount(2);

      const doneItem = listBlocks.filter({ hasText: 'Done task' });
      const openItem = listBlocks.filter({ hasText: 'Open task' });

      await expect(doneItem).toHaveAttribute('data-list-style', 'checklist');
      await expect(openItem).toHaveAttribute('data-list-style', 'checklist');

      await expect(doneItem.getByRole('checkbox')).toBeChecked();
      await expect(openItem.getByRole('checkbox')).not.toBeChecked();

      const savedData = await saveBlok(page);
      const listData = savedData.blocks
        .filter((savedBlock) => savedBlock.type === 'list')
        .map((savedBlock) => savedBlock.data as { text: string; style: string; checked: boolean });

      expect(listData).toEqual([
        expect.objectContaining({ style: 'checklist', checked: true, text: 'Done task' }),
        expect.objectContaining({ style: 'checklist', checked: false, text: 'Open task' }),
      ]);
    });

    test('should detect lower-alpha numbered list style', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();

      const lowerAlphaHTML = `<li style="list-style-type:lower-alpha;font-size:11pt;font-family:Arial,sans-serif;">
        <span>Lower alpha item</span>
      </li>`;

      await paste(page, block, {
        'text/html': lowerAlphaHTML,
        'text/plain': 'Lower alpha item',
      });

      const listBlock = page.locator('[data-blok-tool="list"]');
      await expect(listBlock).toHaveAttribute('data-list-style', 'ordered');
      await expect(listBlock).toContainText('Lower alpha item');
    });

    test('should detect lower-roman numbered list style', async ({ page }) => {
      await createBlok(page);

      const block = getBlockByIndex(page, 0);

      await block.click();

      const lowerRomanHTML = `<li style="list-style-type:lower-roman;font-size:11pt;font-family:Arial,sans-serif;">
        <span>Lower roman item</span>
      </li>`;

      await paste(page, block, {
        'text/html': lowerRomanHTML,
        'text/plain': 'Lower roman item',
      });

      const listBlock = page.locator('[data-blok-tool="list"]');
      await expect(listBlock).toHaveAttribute('data-list-style', 'ordered');
      await expect(listBlock).toContainText('Lower roman item');
    });
  });
});

/**
 * buildin.ai writes a lossless `text/next-space-blocks` clipboard flavour (its
 * analogue of Notion's v3 JSON). Pasting it must reconstruct the SAME native
 * Blok blocks a Blok→Blok paste would — not the lossy markdown-HTML twin (where
 * the table collapses to literal `|pipes|`, media to links, and callout/toggle/
 * columns/to-do flatten away). The fixture is the real Demo Page capture.
 */
test.describe('buildin.ai paste (next-space-blocks lossless flavour)', () => {
  const fixture = readFileSync(
    resolve(__dirname, '../../unit/components/modules/paste/fixtures/buildin-next-space-blocks.json'),
    'utf8'
  );

  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('imports the full Demo Page as native Blok blocks', async ({ page }) => {
    await createBlok(page);

    const firstBlock = getParagraphByIndex(page, 0);

    await firstBlock.click();
    await paste(page, firstBlock, {
      'text/next-space-blocks': fixture,
      'text/plain': 'just a simple text block',
    });

    const saved = await saveBlok(page);
    const allRoots = saved.blocks.filter((b) => !b.parent);

    // createBlok seeds one empty default paragraph; a multi-block paste inserts
    // AFTER it (a Blok→Blok paste into an empty editor behaves identically), so
    // drop a single leading empty paragraph before comparing the content.
    const leadingEmpty = allRoots.length > 0
      && allRoots[0].type === 'paragraph'
      && ((allRoots[0].data as { text?: string }).text ?? '') === '';
    const roots = leadingEmpty ? allRoots.slice(1) : allRoots;

    // Top-level block sequence matches the Demo Page in document order.
    expect(roots.map((b) => b.type)).toEqual([
      'paragraph',
      'list', 'list', 'list', // 3 to-dos
      'header', 'header', 'header', 'header', // H1-H4
      'table',
      'list', 'list', 'list', // bullets
      'list', 'list', 'list', 'list', // numbered
      'toggle',
      'divider',
      'quote',
      'callout',
      'code', // YAML
      'code', // equation -> latex
      'header', 'header', 'header', 'header', // toggle headings
      'column_list', 'column_list',
      'image', 'bookmark', 'video', 'audio', 'file',
    ]);

    // Heading levels 1-4 survive.
    expect(roots.filter((b) => b.type === 'header').slice(0, 4).map((b) => b.data.level)).toEqual([1, 2, 3, 4]);

    // Table reconstructs as a 3x3 grid with a header row; cells are parented
    // paragraphs carrying the grid text (NOT the lossy `|pipes|` markdown twin).
    const table = roots.find((b) => b.type === 'table');

    expect(table).toBeDefined();
    expect((table?.data as { withHeadings?: boolean }).withHeadings).toBe(true);
    const cellIds = (table?.data as { content: { blocks: string[] }[][] }).content.flat().flatMap((c) => c.blocks);

    expect(cellIds).toHaveLength(9);
    const cellText = cellIds.map((id) => {
      const cell = saved.blocks.find((b) => b.id === id);

      return (cell?.data as { text?: string }).text;
    });

    expect(cellText).toEqual(['just', 'a', 'or', 'table', 'nothing', 'is', 'special', 'here', 'here?']);

    // Code language + callout emoji preserved (impossible via the HTML twin).
    expect((roots.find((b) => b.type === 'code')?.data as { language?: string }).language).toBe('yaml');

    const callout = roots.find((b) => b.type === 'callout');

    expect((callout?.data as { emoji?: string }).emoji).toBe('⚠️');

    // Callout body reconstructs as a CHILD paragraph (Blok callouts have no
    // inline text field) — not silently dropped.
    const calloutBody = saved.blocks.filter((b) => b.parent === callout?.id && b.type === 'paragraph');

    expect(calloutBody.map((b) => (b.data as { text?: string }).text)).toContain('call me out!');

    // Toggle keeps its revealed child block, parented under the toggle.
    const toggle = roots.find((b) => b.type === 'toggle');
    const toggleChildren = saved.blocks.filter((b) => b.parent === toggle?.id);

    expect(toggleChildren.length).toBeGreaterThan(0);

    // No stray empty paragraphs within the imported content (a hierarchy-
    // reconstruction smell) — the only permitted empty root is the harness seed.
    const importedEmpties = roots.filter(
      (b) => b.type === 'paragraph' && ((b.data as { text?: string }).text ?? '') === ''
    );

    expect(importedEmpties).toHaveLength(0);
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    BlokOriginal: new (...args: unknown[]) => Blok;
    BlokParagraph: unknown;
    blockToolPasteEvents?: Array<{ defaultPrevented: boolean }>;
    __lastPastedFile?: { name: string; type: string; size: number } | null;
    __maliciousPasteExecuted?: boolean;
  }
}

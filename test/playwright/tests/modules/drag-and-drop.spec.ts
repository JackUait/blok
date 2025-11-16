import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import type { EditorConfig, OutputData } from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const HOLDER_SELECTOR = `#${HOLDER_ID}`;
const BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-block`;
const SIMPLE_IMAGE_TOOL_UMD_PATH = path.resolve(
  __dirname,
  '../../../../node_modules/@editorjs/simple-image/dist/simple-image.umd.js'
);

type SerializableToolConfig = {
  className?: string;
  classCode?: string;
  config?: Record<string, unknown>;
};

type CreateEditorOptions = Pick<EditorConfig, 'data' | 'readOnly'> & {
  tools?: Record<string, SerializableToolConfig>;
};

type DropPayload = {
  types?: Record<string, string>;
  files?: Array<{ name: string; type: string; content: string }>;
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
      const editorConfig: Record<string, unknown> = {
        holder: holderId,
        ...restOptions,
      };

      if (data) {
        editorConfig.data = data;
      }

      if (toolsConfig.length > 0) {
        const resolvedTools = toolsConfig.reduce<Record<string, { class: unknown } & Record<string, unknown>>>(
          (accumulator, { name, className, classCode, toolConfig }) => {
            let toolClass: unknown = null;

            if (className) {
              toolClass = (window as unknown as Record<string, unknown>)[className] ?? null;
            }

            if (!toolClass && classCode) {
              // eslint-disable-next-line no-new-func -- executed in browser context to reconstruct tool
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

        editorConfig.tools = resolvedTools;
      }

      const editor = new window.EditorJS(editorConfig as EditorConfig);

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

const saveEditor = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.editorInstance) {
      throw new Error('Editor instance not found');
    }

    return await window.editorInstance.save();
  });
};

const selectAllText = async (locator: Locator): Promise<void> => {
  await locator.evaluate((element) => {
    const selection = element.ownerDocument.getSelection();

    if (!selection) {
      throw new Error('Selection API is not available');
    }

    const range = element.ownerDocument.createRange();

    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    element.ownerDocument.dispatchEvent(new Event('selectionchange'));
  });
};

const getBlockByIndex = (page: Page, index: number): Locator => {
  return page.locator(`${BLOCK_SELECTOR}:nth-of-type(${index + 1})`);
};

const getParagraphByIndex = (page: Page, index: number): Locator => {
  return getBlockByIndex(page, index).locator('.ce-paragraph');
};

const selectText = async (locator: Locator, targetText: string): Promise<void> => {
  await locator.evaluate((element, text) => {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let foundNode: Text | null = null;
    let offset = -1;

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const content = node.textContent ?? '';
      const index = content.indexOf(text);

      if (index !== -1) {
        foundNode = node;
        offset = index;
        break;
      }
    }

    if (!foundNode || offset === -1) {
      throw new Error(`Text "${text}" not found inside element`);
    }

    const selection = element.ownerDocument.getSelection();
    const range = element.ownerDocument.createRange();

    range.setStart(foundNode, offset);
    range.setEnd(foundNode, offset + text.length);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.ownerDocument.dispatchEvent(new Event('selectionchange'));
  }, targetText);
};

const startEditorDrag = async (page: Page): Promise<void> => {
  await page.evaluate(({ selector }) => {
    const holder = document.querySelector(selector);

    if (!holder) {
      throw new Error('Editor holder not found');
    }

    holder.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
    }));
  }, { selector: HOLDER_SELECTOR });
};

const dispatchDrop = async (page: Page, targetSelector: string, payload: DropPayload): Promise<void> => {
  await page.evaluate(({ selector, payload: data }) => {
    const target = document.querySelector(selector);

    if (!target) {
      throw new Error('Drop target not found');
    }

    const dataTransfer = new DataTransfer();

    if (data.types) {
      Object.entries(data.types).forEach(([type, value]) => {
        dataTransfer.setData(type, value);
      });
    }

    if (data.files) {
      data.files.forEach(({ name, type, content }) => {
        const file = new File([ content ], name, { type });

        dataTransfer.items.add(file);
      });
    }

    const dropEvent = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    });

    target.dispatchEvent(dropEvent);
  }, {
    selector: targetSelector,
    payload,
  });
};

const getBlockTexts = async (page: Page): Promise<string[]> => {
  return await page.locator(BLOCK_SELECTOR).allTextContents()
    .then((texts) => {
      return texts.map((text) => text.trim()).filter(Boolean);
    });
};

const toggleReadOnly = async (page: Page, state: boolean): Promise<void> => {
  await page.evaluate(async ({ readOnlyState }) => {
    if (!window.editorInstance) {
      throw new Error('Editor instance not found');
    }

    await window.editorInstance.readOnly.toggle(readOnlyState);
  }, { readOnlyState: state });
};

test.describe('modules/drag-and-drop', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('moves blocks when dragging their content between positions', async ({ page }) => {
    await createEditor(page, {
      data: {
        blocks: [
          { type: 'paragraph',
            data: { text: 'First block' } },
          { type: 'paragraph',
            data: { text: 'Second block' } },
          { type: 'paragraph',
            data: { text: 'Third block' } },
        ],
      },
    });

    const secondParagraph = getParagraphByIndex(page, 1);

    await selectAllText(secondParagraph);
    await startEditorDrag(page);

    await dispatchDrop(page, `${BLOCK_SELECTOR}:nth-of-type(3) .ce-paragraph`, {
      types: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/plain': 'Second block',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': '<p>Second block</p>',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'application/x-editor-js': JSON.stringify([
          {
            tool: 'paragraph',
            data: { text: 'Second block' },
          },
        ]),
      },
    });

    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(3);
    expect(await getBlockTexts(page)).toStrictEqual([
      'First block',
      'Third block',
      'Second block',
    ]);
  });

  test('drags partial text between blocks', async ({ page }) => {
    await createEditor(page, {
      data: {
        blocks: [
          { type: 'paragraph',
            data: { text: 'Alpha block' } },
          { type: 'paragraph',
            data: { text: 'Beta block' } },
        ],
      },
    });

    const firstParagraph = getParagraphByIndex(page, 0);

    await selectText(firstParagraph, 'Alpha');
    await startEditorDrag(page);

    await dispatchDrop(page, `${BLOCK_SELECTOR}:nth-of-type(2) .ce-paragraph`, {
      types: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/plain': 'Alpha',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': 'Alpha',
      },
    });

    const texts = await getBlockTexts(page);

    expect(texts[0]).toBe('block');
    expect(texts[1]).toBe('Beta blockAlpha');
  });

  test('drops files into tools that support file paste config', async ({ page }) => {
    await page.addScriptTag({ path: SIMPLE_IMAGE_TOOL_UMD_PATH });
    await page.addScriptTag({
      content: `
        class SimpleImageWithInlineUpload extends window.SimpleImage {
          static get isReadOnlySupported() {
            return true;
          }

          static get pasteConfig() {
            return {
              files: {
                mimeTypes: ['image/*'],
              },
            };
          }

          async onDropHandler(dropData) {
            if (dropData.type !== 'file') {
              return super.onDropHandler(dropData);
            }

            const file = dropData.file;

            this.data = {
              url: this.createObjectURL(file),
            };

            this._toggleLoader(false);
          }

          uploadFile(file) {
            return Promise.resolve({
              success: 1,
              file: {
                url: this.createObjectURL(file),
              },
            });
          }

          createObjectURL(file) {
            if (window.URL && typeof window.URL.createObjectURL === 'function') {
              return window.URL.createObjectURL(file);
            }

            return 'data:' + file.type + ';base64,' + btoa(file.name);
          }
        }

        window.SimpleImage = SimpleImageWithInlineUpload;
      `,
    });

    await createEditor(page, {
      tools: {
        image: {
          className: 'SimpleImage',
        },
      },
    });

    await dispatchDrop(page, HOLDER_SELECTOR, {
      files: [
        {
          name: 'test.png',
          type: 'image/png',
          content: 'fake image content',
        },
      ],
    });

    const image = page.locator(`${EDITOR_INTERFACE_SELECTOR} img`);

    await expect(image).toHaveCount(1);

    const { blocks } = await saveEditor(page);

    expect(blocks[blocks.length - 1]?.type).toBe('image');
  });

  test('shows and clears drop-target highlighting while dragging over blocks', async ({ page }) => {
    await createEditor(page, {
      data: {
        blocks: [
          { type: 'paragraph',
            data: { text: 'Highlight A' } },
          { type: 'paragraph',
            data: { text: 'Highlight B' } },
        ],
      },
    });

    const targetBlock = getBlockByIndex(page, 1);

    await targetBlock.locator('.ce-block__content').dispatchEvent('dragover', {
      bubbles: true,
      cancelable: true,
    });

    await expect(targetBlock).toHaveClass(/ce-block--drop-target/);

    await targetBlock.locator('.ce-block__content').dispatchEvent('dragleave', {
      bubbles: true,
      cancelable: true,
    });

    await expect(targetBlock).not.toHaveClass(/ce-block--drop-target/);
  });

  test('ignores drops while read-only mode is enabled', async ({ page }) => {
    await createEditor(page, {
      readOnly: true,
      data: {
        blocks: [
          { type: 'paragraph',
            data: { text: 'Locked block' } },
        ],
      },
    });

    await dispatchDrop(page, HOLDER_SELECTOR, {
      types: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/plain': 'Should not appear',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': '<p>Should not appear</p>',
      },
    });

    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(1);

    await toggleReadOnly(page, false);

    await dispatchDrop(page, HOLDER_SELECTOR, {
      types: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/plain': 'New block',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': '<p>New block</p>',
      },
    });

    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(2);
    await expect(getBlockTexts(page)).resolves.toContain('New block');
  });
});


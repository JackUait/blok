import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import type { OutputData } from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HEADER_TOOL_UMD_PATH = path.resolve(
  __dirname,
  '../../../../node_modules/@editorjs/header/dist/header.umd.js'
);

const HOLDER_ID = 'editorjs';
const BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-testid="block-wrapper"]`;
const BLOCK_CONTENT_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-testid="block-content"]`;
const SETTINGS_BUTTON_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-testid="settings-toggler"]`;
const SETTINGS_ITEM_SELECTOR = '[data-testid="block-tunes-popover"] [data-testid="popover-item"]';
const BLOCK_TEXT = 'The block with some text';

type SerializableToolConfig = {
  className?: string;
  classCode?: string;
  config?: Record<string, unknown>;
};

type CreateEditorOptions = {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
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
    container.setAttribute('data-testid', holderId);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

const createEditor = async (page: Page, options: CreateEditorOptions = {}): Promise<void> => {
  const { data = null, tools = {} } = options;

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
    async ({ holderId, data: initialData, serializedTools: toolsConfig }) => {
      const editorConfig: Record<string, unknown> = {
        holder: holderId,
      };

      if (initialData) {
        editorConfig.data = initialData;
      }

      if (toolsConfig.length > 0) {
        const resolvedTools = toolsConfig.reduce<Record<string, { class: unknown } & Record<string, unknown>>>(
          (accumulator, { name, className, classCode, config }) => {
            let toolClass: unknown = null;

            if (className) {
              toolClass = (window as unknown as Record<string, unknown>)[className] ?? null;
            }

            if (!toolClass && classCode) {
              // eslint-disable-next-line no-new-func -- evaluated in browser context to reconstruct tool class
              toolClass = new Function(`return (${classCode});`)();
            }

            if (!toolClass) {
              throw new Error(`Tool "${name}" is not available globally`);
            }

            return {
              ...accumulator,
              [name]: {
                class: toolClass,
                ...config,
              },
            };
          },
          {}
        );

        editorConfig.tools = resolvedTools;
      }

      const editor = new window.EditorJS(editorConfig);

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
      data,
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

test.describe('saver module', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('saves block data when extraneous DOM nodes are present', async ({ page }) => {
    await createEditor(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: BLOCK_TEXT,
            },
          },
        ],
      },
    });

    const blockContent = page.locator(BLOCK_CONTENT_SELECTOR).filter({ hasText: BLOCK_TEXT });

    await blockContent.evaluate((element) => {
      const extensionNode = element.ownerDocument.createElement('extension-node');

      element.append(extensionNode);
    });

    const savedData = await saveEditor(page);

    expect(savedData.blocks).toHaveLength(1);
    expect(savedData.blocks[0]?.type).toBe('paragraph');
    expect(savedData.blocks[0]?.data).toMatchObject({
      text: BLOCK_TEXT,
    });
  });

  test('saves header block data after container element changes', async ({ page }) => {
    await page.addScriptTag({ path: HEADER_TOOL_UMD_PATH });

    await createEditor(page, {
      data: {
        blocks: [
          {
            type: 'header',
            data: {
              text: BLOCK_TEXT,
              level: 1,
            },
          },
        ],
      },
      tools: {
        header: {
          className: 'Header',
        },
      },
    });

    await page.locator(BLOCK_SELECTOR).filter({ hasText: BLOCK_TEXT })
      .click();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    // eslint-disable-next-line playwright/no-nth-methods -- The Header tool settings items do not have distinctive text or attributes, so we rely on the order (Level 1, 2, 3...)
    const headerLevelOption = page.locator(SETTINGS_ITEM_SELECTOR).nth(2);

    await headerLevelOption.waitFor({ state: 'visible' });
    await headerLevelOption.click();

    await page.waitForFunction(
      ({ editorSelector }) => {
        const headerElement = document.querySelector(`${editorSelector} .ce-header`);

        return headerElement?.tagName === 'H3';
      },
      { editorSelector: EDITOR_INTERFACE_SELECTOR }
    );

    const savedData = await saveEditor(page);

    expect(savedData.blocks[0]?.type).toBe('header');
    expect(savedData.blocks[0]?.data).toMatchObject({
      text: BLOCK_TEXT,
      level: 3,
    });
  });
});


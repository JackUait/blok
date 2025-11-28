import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type Blok from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HEADER_TOOL_UMD_PATH = path.resolve(
  __dirname,
  '../../../../node_modules/@editorjs/header/dist/header.umd.js'
);

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const BLOCK_CONTENT_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-content"]`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const SETTINGS_ITEM_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-item"]';
const BLOCK_TEXT = 'The block with some text';

type SerializableToolConfig = {
  className?: string;
  classCode?: string;
  config?: Record<string, unknown>;
};

type CreateBlokOptions = {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
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
  const { data = null, tools = {} } = options;

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
    async ({ holder, data: initialData, serializedTools: toolsConfig }) => {
      const blokConfig: Record<string, unknown> = {
        holder: holder,
      };

      if (initialData) {
        blokConfig.data = initialData;
      }

      if (toolsConfig.length > 0) {
        const resolvedTools = toolsConfig.reduce<Record<string, { class: unknown } & Record<string, unknown>>>(
          (accumulator, { name, className, classCode, config }) => {
            let toolClass: unknown = null;

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
                ...config,
              },
            };
          },
          {}
        );

        blokConfig.tools = resolvedTools;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      data,
      serializedTools,
    }
  );
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });
};

test.describe('saver module', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('saves block data when extraneous DOM nodes are present', async ({ page }) => {
    await createBlok(page, {
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

    const savedData = await saveBlok(page);

    expect(savedData.blocks).toHaveLength(1);
    expect(savedData.blocks[0]?.type).toBe('paragraph');
    expect(savedData.blocks[0]?.data).toMatchObject({
      text: BLOCK_TEXT,
    });
  });

  test('saves header block data after container element changes', async ({ page }) => {
    await page.addScriptTag({ path: HEADER_TOOL_UMD_PATH });

    await createBlok(page, {
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
      ({ blokSelector }) => {
        const headerElement = document.querySelector(`${blokSelector} .ce-header`);

        return headerElement?.tagName === 'H3';
      },
      { blokSelector: BLOK_INTERFACE_SELECTOR }
    );

    const savedData = await saveBlok(page);

    expect(savedData.blocks[0]?.type).toBe('header');
    expect(savedData.blocks[0]?.data).toMatchObject({
      text: BLOCK_TEXT,
      level: 3,
    });
  });
});


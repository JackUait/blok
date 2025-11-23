import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type EditorJS from '@/types';
import type { OutputData } from '@/types';
import { ensureEditorBundleBuilt } from './helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR } from '../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const SETTINGS_BUTTON_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-toolbar__settings-btn`;

type CreateEditorOptions = {
  data?: OutputData;
  config?: Record<string, unknown>;
};

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}

const createEditor = async (page: Page, options: CreateEditorOptions = {}): Promise<void> => {
  const { data = null, config = {} } = options;

  await page.evaluate(async ({ holderId, data: initialData, config: editorConfig }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holderId)?.remove();

    const container = document.createElement('div');

    container.id = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);

    const configToUse: Record<string, unknown> = {
      holder: holderId,
      ...editorConfig,
    };

    if (initialData) {
      configToUse.data = initialData;
    }

    const editor = new window.EditorJS(configToUse);

    window.editorInstance = editor;
    await editor.isReady;
  }, {
    holderId: HOLDER_ID,
    data,
    config,
  });
};

test.describe('drag and drop', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('should move block from first position to the last', async ({ page }) => {
    const blocks = [
      {
        type: 'paragraph',
        data: { text: 'First block' },
      },
      {
        type: 'paragraph',
        data: { text: 'Second block' },
      },
      {
        type: 'paragraph',
        data: { text: 'Third block' },
      },
    ];

    await createEditor(page, {
      data: { blocks },
    });

    // 1. Hover over the first block to show the settings button (drag handle)
    const firstBlock = page.locator('.ce-block').filter({ hasText: 'First block' });

    await firstBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();
    const settingsButtonBox = await settingsButton.boundingBox();

    expect(settingsButtonBox).not.toBeNull();

    const targetBlock = page.locator('.ce-block').filter({ hasText: 'Third block' });
    const targetBox = await targetBlock.boundingBox();

    expect(targetBox).not.toBeNull();

    // 3. Perform drag and drop manually
    await page.mouse.move(
      settingsButtonBox!.x + settingsButtonBox!.width / 2,
      settingsButtonBox!.y + settingsButtonBox!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height * 0.75, // Bottom part of target
      { steps: 20 }
    );
    await page.mouse.up();

    // 4. Verify the new order in DOM
    await expect(page.locator('.ce-block')).toHaveText([
      'Second block',
      'Third block',
      'First block',
    ]);

    // 5. Verify the new order in Editor data
    const savedData = await page.evaluate(() => window.editorInstance?.save());

    expect(savedData?.blocks[0].data.text).toBe('Second block');
    expect(savedData?.blocks[1].data.text).toBe('Third block');
    expect(savedData?.blocks[2].data.text).toBe('First block');
  });

  test('should move block from last position to the first', async ({ page }) => {
    const blocks = [
      {
        type: 'paragraph',
        data: { text: 'First block' },
      },
      {
        type: 'paragraph',
        data: { text: 'Second block' },
      },
      {
        type: 'paragraph',
        data: { text: 'Third block' },
      },
    ];

    await createEditor(page, {
      data: { blocks },
    });

    // 1. Hover over the last block to show the settings button
    const lastBlock = page.locator('.ce-block').filter({ hasText: 'Third block' });

    await lastBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();
    const settingsButtonBox = await settingsButton.boundingBox();

    expect(settingsButtonBox).not.toBeNull();

    const targetBlock = page.locator('.ce-block').filter({ hasText: 'First block' });
    const targetBox = await targetBlock.boundingBox();

    expect(targetBox).not.toBeNull();

    // 3. Perform drag and drop manually
    await page.mouse.move(
      settingsButtonBox!.x + settingsButtonBox!.width / 2,
      settingsButtonBox!.y + settingsButtonBox!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + 5, // Top part of target
      { steps: 20 }
    );
    await page.mouse.up();

    // 4. Verify the new order
    await expect(page.locator('.ce-block')).toHaveText([
      'Third block',
      'First block',
      'Second block',
    ]);

    // 5. Verify data
    const savedData = await page.evaluate(() => window.editorInstance?.save());

    expect(savedData?.blocks[0].data.text).toBe('Third block');
    expect(savedData?.blocks[1].data.text).toBe('First block');
    expect(savedData?.blocks[2].data.text).toBe('Second block');
  });
});

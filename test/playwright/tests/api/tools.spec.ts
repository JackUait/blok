import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const BLOCK_WRAPPER_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-cy="block-wrapper"]`;
const DEFAULT_BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} div.ce-block`;
const ICON = '<svg width="17" height="15" viewBox="0 0 336 276" xmlns="http://www.w3.org/2000/svg"><path d="M291 150V79c0-19-15-34-34-34H79c-19 0-34 15-34 34v42l67-44 81 72 56-29 42 30zm0 52l-43-30-56 30-81-67-66 39v23c0 19 15 34 34 34h178c17 0 31-13 34-29zM79 0h178c44 0 79 35 79 79v118c0 44-35 79-79 79H79c-44 0-79-35-79-79V79C0 35 35 0 79 0z"></path></svg>';

type ToolDefinition = {
  name: string;
  classSource: string;
  config?: Record<string, unknown>;
};

type EditorSetupOptions = {
  data?: Record<string, unknown>;
  tools?: ToolDefinition[];
  config?: Record<string, unknown>;
};

interface ElementSnapshot {
  tagName: string;
  attributes: Array<{ name: string; value: string }>;
  children: ElementSnapshot[];
  text: string;
}

const getBlockWrapperSelectorByIndex = (index: number): string => {
  return `:nth-match(${BLOCK_WRAPPER_SELECTOR}, ${index + 1})`;
};

const getBlockByIndex = (page: Page, index: number): Locator => {
  return page.locator(`${DEFAULT_BLOCK_SELECTOR}:nth-of-type(${index + 1})`);
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

const createEditor = async (page: Page, options: EditorSetupOptions = {}): Promise<void> => {
  const { data, tools = [], config = {} } = options;

  await resetEditor(page);
  await page.waitForFunction(() => typeof window.EditorJS === 'function');

  await page.evaluate(
    async ({ holderId, rawData, serializedTools, rawConfig }) => {
      const reviveToolClass = (classSource: string): unknown => {
        // eslint-disable-next-line no-new-func -- constructing helper class inside page context
        return new Function(`return (${classSource});`)();
      };

      const revivedTools = serializedTools.reduce<Record<string, Record<string, unknown>>>(
        (accumulator, toolConfig) => {
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
        },
        {}
      );

      const editorConfig: Record<string, unknown> = {
        holder: holderId,
        ...rawConfig,
      };

      if (rawData) {
        editorConfig.data = rawData;
      }

      if (serializedTools.length > 0) {
        editorConfig.tools = revivedTools;
      }

      const editor = new window.EditorJS(editorConfig);

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
      rawData: data ?? null,
      serializedTools: tools,
      rawConfig: config,
    }
  );
};

const focusBlockByIndex = async (page: Page, index: number = 0): Promise<void> => {
  await page.evaluate(({ blockIndex }) => {
    if (!window.editorInstance) {
      throw new Error('Editor instance not found');
    }

    const didSetCaret = window.editorInstance.caret.setToBlock(blockIndex);

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

  const settingsButton = page.locator(`${EDITOR_INTERFACE_SELECTOR} .ce-toolbar__settings-btn`);

  await settingsButton.waitFor({ state: 'visible' });
  await settingsButton.click();

  await expect(
    page
      .locator('.ce-popover[data-cy="block-tunes"][data-popover-opened="true"]')
  ).toHaveCount(1);
};

const paste = async (page: Page, target: Locator, data: Record<string, string>): Promise<void> => {
  await target.evaluate((element: HTMLElement, pasteData: Record<string, string>) => {
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

const createTuneToolSource = (renderSettingsBody: string): string => {
  return `
class TestTool {
  constructor({ data }) {
    this.data = data ?? {};
  }

  static get toolbox() {
    return {
      title: 'Test tool',
      icon: '${ICON}',
    };
  }

  render() {
    const element = document.createElement('div');

    element.contentEditable = 'true';
    element.setAttribute('data-name', 'testBlock');
    element.textContent = this.data?.text ?? '';

    return element;
  }

  save(element) {
    return {
      text: element.textContent ?? '',
    };
  }

  renderSettings() {
    ${renderSettingsBody}
  }
}
`;
};

const createPasteToolSource = ({
  pasteConfig,
  renderBody,
}: {
  pasteConfig: string;
  renderBody: string;
}): string => {
  return `
class TestTool {
  constructor({ data }) {
    this.data = data ?? {};
  }

  static get pasteConfig() {
    return ${pasteConfig};
  }

  render() {
    ${renderBody}
  }

  save() {
    return {};
  }

  onPaste(event) {
    window.__onPasteCalls = (window.__onPasteCalls ?? 0) + 1;

    const data = event.detail?.data ?? null;

    window.__lastPasteSnapshot = this.createSnapshot(data);
  }

  createSnapshot(element) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    return {
      tagName: element.tagName.toLowerCase(),
      attributes: Array.from(element.attributes).map((attr) => ({
        name: attr.name,
        value: attr.value,
      })),
      children: Array.from(element.children).map((child) => this.createSnapshot(child)),
      text: element.textContent ?? '',
    };
  }
}
`;
};

test.describe('api.tools', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
    await page.evaluate(() => {
      window.__onPasteCalls = 0;
      window.__lastPasteSnapshot = null;
    });
  });

  test.describe('renderSettings', () => {
    test('should render single tune configured via renderSettings()', async ({ page }) => {
      const singleTuneToolSource = createTuneToolSource(`
        return {
          title: 'Test tool tune',
          icon: '${ICON}',
          name: 'testToolTune',
          onActivate: () => {},
        };
      `);

      await createEditor(page, {
        tools: [
          {
            name: 'testTool',
            classSource: singleTuneToolSource,
          },
        ],
        data: {
          blocks: [
            {
              type: 'testTool',
              data: {
                text: 'some text',
              },
            },
          ],
        },
      });

      await openBlockSettings(page, 0);

      await expect(page.locator('[data-item-name="testToolTune"]')).toBeVisible();
    });

    test('should render multiple tunes when renderSettings() returns array', async ({ page }) => {
      const multipleTunesToolSource = createTuneToolSource(`
        return [
          {
            title: 'Test tool tune 1',
            icon: '${ICON}',
            name: 'testToolTune1',
            onActivate: () => {},
          },
          {
            title: 'Test tool tune 2',
            icon: '${ICON}',
            name: 'testToolTune2',
            onActivate: () => {},
          },
        ];
      `);

      await createEditor(page, {
        tools: [
          {
            name: 'testTool',
            classSource: multipleTunesToolSource,
          },
        ],
        data: {
          blocks: [
            {
              type: 'testTool',
              data: {
                text: 'some text',
              },
            },
          ],
        },
      });

      await openBlockSettings(page, 0);

      await expect(page.locator('[data-item-name="testToolTune1"]')).toBeVisible();
      await expect(page.locator('[data-item-name="testToolTune2"]')).toBeVisible();
    });

    test('should support custom html returned from renderSettings()', async ({ page }) => {
      const sampleText = 'sample text';
      const customHtmlToolSource = createTuneToolSource(`
        const element = document.createElement('div');

        element.textContent = '${sampleText}';

        return element;
      `);

      await createEditor(page, {
        tools: [
          {
            name: 'testTool',
            classSource: customHtmlToolSource,
          },
        ],
        data: {
          blocks: [
            {
              type: 'testTool',
              data: {
                text: 'some text',
              },
            },
          ],
        },
      });

      await openBlockSettings(page, 0);

      await expect(
        page.locator(
          '.ce-popover[data-cy="block-tunes"][data-popover-opened="true"]'
        )
      ).toContainText(sampleText);
    });
  });

  test.describe('pasteConfig', () => {
    test('should use corresponding tool when tag names are specified', async ({ page }) => {
      const toolSource = createPasteToolSource({
        pasteConfig: `{
          tags: ['img'],
        }`,
        renderBody: `
          return document.createElement('img');
        `,
      });

      await createEditor(page, {
        tools: [
          {
            name: 'testTool',
            classSource: toolSource,
          },
        ],
      });

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': '<img>',
      });

      const onPasteCalls = await page.evaluate(() => {
        return window.__onPasteCalls ?? 0;
      });

      expect(onPasteCalls).toBeGreaterThan(0);
    });

    test('should sanitize attributes when only tag name is specified', async ({ page }) => {
      const toolSource = createPasteToolSource({
        pasteConfig: `{
          tags: ['img'],
        }`,
        renderBody: `
          return document.createElement('img');
        `,
      });

      await createEditor(page, {
        tools: [
          {
            name: 'testTool',
            classSource: toolSource,
          },
        ],
      });

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': '<img src="foo" onerror="alert(123)"/>',
      });

      const snapshot = await page.evaluate<ElementSnapshot | null>(() => {
        return (window.__lastPasteSnapshot ?? null) as ElementSnapshot | null;
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.tagName).toBe('img');
      expect(snapshot?.attributes).toHaveLength(0);
    });

    test('should sanitize uppercase tag names and preserve children', async ({ page }) => {
      const toolSource = createPasteToolSource({
        pasteConfig: `{
          tags: ['OL', 'LI'],
        }`,
        renderBody: `
          return document.createElement('ol');
        `,
      });

      await createEditor(page, {
        tools: [
          {
            name: 'testTool',
            classSource: toolSource,
          },
        ],
      });

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': '<ol start="50"><li>Ordered List</li><li>Unordered List</li></ol>',
      });

      const snapshot = await page.evaluate<ElementSnapshot | null>(() => {
        return (window.__lastPasteSnapshot ?? null) as ElementSnapshot | null;
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.tagName).toBe('ol');
      expect(snapshot?.attributes).toHaveLength(0);
      expect(snapshot?.children).toHaveLength(2);
      snapshot?.children.forEach((child) => {
        expect(child.tagName).toBe('li');
        expect(child.attributes).toHaveLength(0);
      });
    });

    test('should preserve attributes defined in sanitizer config', async ({ page }) => {
      const toolSource = createPasteToolSource({
        pasteConfig: `{
          tags: [
            {
              img: {
                src: true,
              },
            },
          ],
        }`,
        renderBody: `
          return document.createElement('img');
        `,
      });

      await createEditor(page, {
        tools: [
          {
            name: 'testTool',
            classSource: toolSource,
          },
        ],
      });

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': '<img src="foo" onerror="alert(123)"/>',
      });

      const snapshot = await page.evaluate<ElementSnapshot | null>(() => {
        return (window.__lastPasteSnapshot ?? null) as ElementSnapshot | null;
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.tagName).toBe('img');
      expect(snapshot?.attributes).toHaveLength(1);
      expect(snapshot?.attributes[0]).toStrictEqual({
        name: 'src',
        value: 'foo',
      });
    });

    test('should support mixed tag names and sanitizer config', async ({ page }) => {
      const toolSource = createPasteToolSource({
        pasteConfig: `{
          tags: [
            'video',
            {
              source: {
                src: true,
              },
            },
          ],
        }`,
        renderBody: `
          return document.createElement('video');
        `,
      });

      await createEditor(page, {
        tools: [
          {
            name: 'testTool',
            classSource: toolSource,
          },
        ],
      });

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': '<video width="100"><source src="movie.mp4" type="video/mp4"></video>',
      });

      const snapshot = await page.evaluate<ElementSnapshot | null>(() => {
        return (window.__lastPasteSnapshot ?? null) as ElementSnapshot | null;
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.tagName).toBe('video');
      expect(snapshot?.attributes).toHaveLength(0);
      expect(snapshot?.children).toHaveLength(1);
      const sourceSnapshot = snapshot?.children[0];

      expect(sourceSnapshot?.tagName).toBe('source');
      expect(sourceSnapshot?.attributes).toHaveLength(1);
      expect(sourceSnapshot?.attributes[0]).toStrictEqual({
        name: 'src',
        value: 'movie.mp4',
      });
    });

    test('should support configs with several keys as single entry', async ({ page }) => {
      const toolSource = createPasteToolSource({
        pasteConfig: `{
          tags: [
            {
              video: {
                width: true,
              },
              source: {
                src: true,
              },
            },
          ],
        }`,
        renderBody: `
          return document.createElement('video');
        `,
      });

      await createEditor(page, {
        tools: [
          {
            name: 'testTool',
            classSource: toolSource,
          },
        ],
      });

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': '<video width="100"><source src="movie.mp4" type="video/mp4"></video>',
      });

      const snapshot = await page.evaluate<ElementSnapshot | null>(() => {
        return (window.__lastPasteSnapshot ?? null) as ElementSnapshot | null;
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.tagName).toBe('video');
      expect(snapshot?.attributes).toHaveLength(1);
      expect(snapshot?.attributes[0]).toStrictEqual({
        name: 'width',
        value: '100',
      });

      const sourceSnapshot = snapshot?.children[0];

      expect(sourceSnapshot?.tagName).toBe('source');
      expect(sourceSnapshot?.attributes).toHaveLength(1);
      expect(sourceSnapshot?.attributes[0]).toStrictEqual({
        name: 'src',
        value: 'movie.mp4',
      });
    });

    test('should correctly sanitize table structure', async ({ page }) => {
      const toolSource = createPasteToolSource({
        pasteConfig: `{
          tags: [
            'table',
            'tbody',
            {
              td: {
                width: true,
              },
              tr: {
                height: true,
              },
            },
          ],
        }`,
        renderBody: `
          return document.createElement('tbody');
        `,
      });

      await createEditor(page, {
        tools: [
          {
            name: 'testTool',
            classSource: toolSource,
          },
        ],
      });

      const block = getBlockByIndex(page, 0);

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': '<table><tr height="50"><td width="300">Ho-Ho-Ho</td></tr></table>',
      });

      const snapshot = await page.evaluate<ElementSnapshot | null>(() => {
        return (window.__lastPasteSnapshot ?? null) as ElementSnapshot | null;
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.tagName).toBe('table');
      expect(snapshot?.children).toBeDefined();

      const tbodySnapshot = snapshot?.children[0];

      expect(tbodySnapshot?.tagName).toBe('tbody');
      const trSnapshot = tbodySnapshot?.children[0];

      expect(trSnapshot?.tagName).toBe('tr');
      expect(trSnapshot?.attributes).toHaveLength(1);
      expect(trSnapshot?.attributes[0]).toStrictEqual({
        name: 'height',
        value: '50',
      });

      const tdSnapshot = trSnapshot?.children[0];

      expect(tdSnapshot?.tagName).toBe('td');
      expect(tdSnapshot?.attributes).toHaveLength(1);
      expect(tdSnapshot?.attributes[0]).toStrictEqual({
        name: 'width',
        value: '300',
      });
      expect(tdSnapshot?.text.trim()).toBe('Ho-Ho-Ho');
    });
  });
});

const ON_PASTE_CALLS_KEY = '__onPasteCalls';
const LAST_PASTE_SNAPSHOT_KEY = '__lastPasteSnapshot';

declare global {
  interface Window {
    editorInstance?: EditorJS;
    [ON_PASTE_CALLS_KEY]?: number;
    [LAST_PASTE_SNAPSHOT_KEY]?: unknown;
  }
}



import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import type { EditorConfig } from '@/types';
import type { Listeners as ListenersAPI } from '@/types/api/listeners';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';

declare global {
  interface Window {
    editorInstance?: EditorJS;
    listenerCallCount?: number;
    lifecycleCallCount?: number;
    listenersTestTarget?: HTMLElement;
    listenersTestHandler?: (event?: Event) => void;
    listenersLifecycleTarget?: HTMLElement;
    listenersLifecycleHandler?: (event?: Event) => void;
    firstListenerId?: string | null;
    secondListenerId?: string | null;
  }
}

type EditorWithListeners = EditorJS & { listeners: ListenersAPI };

type CreateEditorOptions = Partial<EditorConfig>;

const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holderId }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holderId)?.remove();

    const container = document.createElement('div');

    container.id = holderId;
    container.dataset.testid = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

const createEditor = async (page: Page, options: CreateEditorOptions = {}): Promise<void> => {
  await resetEditor(page);
  await page.waitForFunction(() => typeof window.EditorJS === 'function');

  await page.evaluate(
    async (params: { holderId: string; editorOptions: Record<string, unknown> }) => {
      const config = Object.assign(
        { holder: params.holderId },
        params.editorOptions
      ) as EditorConfig;

      const editor = new window.EditorJS(config);

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
      editorOptions: options as Record<string, unknown>,
    }
  );
};

const clickElement = async (page: Page, selector: string): Promise<void> => {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector);

    target?.click();
  }, selector);
};

test.describe('api.listeners', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('registers and removes DOM listeners via the public API', async ({ page }) => {
    await createEditor(page);

    await page.evaluate(() => {
      const editor = window.editorInstance as EditorWithListeners | undefined;

      if (!editor) {
        throw new Error('Editor instance not found');
      }

      const target = document.createElement('button');

      target.id = 'listeners-target';
      target.textContent = 'listener target';
      target.style.width = '2px';
      target.style.height = '2px';
      document.body.appendChild(target);

      window.listenerCallCount = 0;
      window.listenersTestTarget = target;
      window.listenersTestHandler = (): void => {
        window.listenerCallCount = (window.listenerCallCount ?? 0) + 1;
      };

      const listenerId = editor.listeners.on(target, 'click', window.listenersTestHandler);

      window.firstListenerId = listenerId ?? null;
    });

    const firstListenerId = await page.evaluate(() => window.firstListenerId);

    expect(firstListenerId).toBeTruthy();

    await clickElement(page, '#listeners-target');
    await page.waitForFunction(() => window.listenerCallCount === 1);

    await page.evaluate(() => {
      const editor = window.editorInstance as EditorWithListeners | undefined;

      if (!editor || !window.listenersTestTarget || !window.listenersTestHandler) {
        throw new Error('Listener prerequisites were not set');
      }

      editor.listeners.off(window.listenersTestTarget, 'click', window.listenersTestHandler);
    });

    await clickElement(page, '#listeners-target');

    let callCount = await page.evaluate(() => window.listenerCallCount);

    expect(callCount).toBe(1);

    await page.evaluate(() => {
      const editor = window.editorInstance as EditorWithListeners | undefined;

      if (!editor || !window.listenersTestTarget || !window.listenersTestHandler) {
        throw new Error('Listener prerequisites were not set');
      }

      window.listenerCallCount = 0;
      const listenerId = editor.listeners.on(
        window.listenersTestTarget,
        'click',
        window.listenersTestHandler
      );

      window.secondListenerId = listenerId ?? null;
    });

    await clickElement(page, '#listeners-target');
    await page.waitForFunction(() => window.listenerCallCount === 1);

    await page.evaluate(() => {
      const editor = window.editorInstance as EditorWithListeners | undefined;

      if (window.secondListenerId && editor) {
        editor.listeners.offById(window.secondListenerId);
      }
    });

    await clickElement(page, '#listeners-target');

    callCount = await page.evaluate(() => window.listenerCallCount);

    expect(callCount).toBe(1);
  });

  test('cleans up registered listeners when the editor is destroyed', async ({ page }) => {
    await createEditor(page);

    await page.evaluate(() => {
      const editor = window.editorInstance as EditorWithListeners | undefined;

      if (!editor) {
        throw new Error('Editor instance not found');
      }

      const target = document.createElement('button');

      target.id = 'listeners-lifecycle-target';
      target.textContent = 'listener lifecycle target';
      document.body.appendChild(target);

      window.lifecycleCallCount = 0;
      window.listenersLifecycleTarget = target;
      window.listenersLifecycleHandler = (): void => {
        window.lifecycleCallCount = (window.lifecycleCallCount ?? 0) + 1;
      };

      editor.listeners.on(target, 'click', window.listenersLifecycleHandler);
    });

    await clickElement(page, '#listeners-lifecycle-target');
    await page.waitForFunction(() => window.lifecycleCallCount === 1);

    await page.evaluate(() => {
      window.editorInstance?.destroy?.();
      window.editorInstance = undefined;
    });

    await clickElement(page, '#listeners-lifecycle-target');

    const finalLifecycleCount = await page.evaluate(() => window.lifecycleCallCount);

    expect(finalLifecycleCount).toBe(1);
  });
});

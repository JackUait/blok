import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type Blok from '@/types';
import type { BlokConfig } from '@/types';
import type { Listeners as ListenersAPI } from '@/types/api/listeners';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
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

type BlokWithListeners = Blok & { listeners: ListenersAPI };

type CreateBlokOptions = Partial<BlokConfig>;

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
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async (params: { holder: string; blokOptions: Record<string, unknown> }) => {
      const config = Object.assign(
        { holder: params.holder },
        params.blokOptions
      ) as BlokConfig;

      const blok = new window.Blok(config);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      blokOptions: options as Record<string, unknown>,
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
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('registers and removes DOM listeners via the public API', async ({ page }) => {
    await createBlok(page);

    await page.evaluate(() => {
      const blok = window.blokInstance as BlokWithListeners | undefined;

      if (!blok) {
        throw new Error('Blok instance not found');
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

      const listenerId = blok.listeners.on(target, 'click', window.listenersTestHandler);

      window.firstListenerId = listenerId ?? null;
    });

    const firstListenerId = await page.evaluate(() => window.firstListenerId);

    expect(firstListenerId).toBeTruthy();

    await clickElement(page, '#listeners-target');
    await page.waitForFunction(() => window.listenerCallCount === 1);

    await page.evaluate(() => {
      const blok = window.blokInstance as BlokWithListeners | undefined;

      if (!blok || !window.listenersTestTarget || !window.listenersTestHandler) {
        throw new Error('Listener prerequisites were not set');
      }

      blok.listeners.off(window.listenersTestTarget, 'click', window.listenersTestHandler);
    });

    await clickElement(page, '#listeners-target');

    let callCount = await page.evaluate(() => window.listenerCallCount);

    expect(callCount).toBe(1);

    await page.evaluate(() => {
      const blok = window.blokInstance as BlokWithListeners | undefined;

      if (!blok || !window.listenersTestTarget || !window.listenersTestHandler) {
        throw new Error('Listener prerequisites were not set');
      }

      window.listenerCallCount = 0;
      const listenerId = blok.listeners.on(
        window.listenersTestTarget,
        'click',
        window.listenersTestHandler
      );

      window.secondListenerId = listenerId ?? null;
    });

    await clickElement(page, '#listeners-target');
    await page.waitForFunction(() => window.listenerCallCount === 1);

    await page.evaluate(() => {
      const blok = window.blokInstance as BlokWithListeners | undefined;

      if (window.secondListenerId && blok) {
        blok.listeners.offById(window.secondListenerId);
      }
    });

    await clickElement(page, '#listeners-target');

    callCount = await page.evaluate(() => window.listenerCallCount);

    expect(callCount).toBe(1);
  });

  test('cleans up registered listeners when the blok is destroyed', async ({ page }) => {
    await createBlok(page);

    await page.evaluate(() => {
      const blok = window.blokInstance as BlokWithListeners | undefined;

      if (!blok) {
        throw new Error('Blok instance not found');
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

      blok.listeners.on(target, 'click', window.listenersLifecycleHandler);
    });

    await clickElement(page, '#listeners-lifecycle-target');
    await page.waitForFunction(() => window.lifecycleCallCount === 1);

    await page.evaluate(() => {
      window.blokInstance?.destroy?.();
      window.blokInstance = undefined;
    });

    await clickElement(page, '#listeners-lifecycle-target');

    const finalLifecycleCount = await page.evaluate(() => window.lifecycleCallCount);

    expect(finalLifecycleCount).toBe(1);
  });
});

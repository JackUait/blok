import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BlockChanged } from '../../../../src/components/events/BlockChanged';
import { BlockHovered } from '../../../../src/components/events/BlockHovered';
import { RedactorDomChanged } from '../../../../src/components/events/RedactorDomChanged';
import { FakeCursorAboutToBeToggled } from '../../../../src/components/events/FakeCursorAboutToBeToggled';
import { FakeCursorHaveBeenSet } from '../../../../src/components/events/FakeCursorHaveBeenSet';
import { BlokMobileLayoutToggled } from '../../../../src/components/events/BlokMobileLayoutToggled';
import { BlockSettingsOpened } from '../../../../src/components/events/BlockSettingsOpened';
import { BlockSettingsClosed } from '../../../../src/components/events/BlockSettingsClosed';
import type { BlokEventMap } from '../../../../src/components/events';
import { BlockChangedMutationType } from '../../../../types/events/block/BlockChanged';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';

type EventTestCase = {
  name: keyof BlokEventMap;
  createPayload: () => unknown;
};

const EVENT_TEST_CASES: EventTestCase[] = [
  {
    name: BlockChanged,
    createPayload: () => ({
      event: {
        type: BlockChangedMutationType,
        detail: {
          target: {
            id: 'block-changed-test-block',
            name: 'paragraph',
          },
          index: 0,
        },
      },
    }) as unknown as BlokEventMap[typeof BlockChanged],
  },
  {
    name: BlockHovered,
    createPayload: () => ({
      block: {
        id: 'hovered-block',
      },
    }) as unknown as BlokEventMap[typeof BlockHovered],
  },
  {
    name: RedactorDomChanged,
    createPayload: () => ({
      mutations: [],
    }) as BlokEventMap[typeof RedactorDomChanged],
  },
  {
    name: FakeCursorAboutToBeToggled,
    createPayload: () => ({
      state: true,
    }) as BlokEventMap[typeof FakeCursorAboutToBeToggled],
  },
  {
    name: FakeCursorHaveBeenSet,
    createPayload: () => ({
      state: false,
    }) as BlokEventMap[typeof FakeCursorHaveBeenSet],
  },
  {
    name: BlokMobileLayoutToggled,
    createPayload: () => ({
      isEnabled: true,
    }) as BlokEventMap[typeof BlokMobileLayoutToggled],
  },
  {
    name: BlockSettingsOpened,
    createPayload: () => ({}),
  },
  {
    name: BlockSettingsClosed,
    createPayload: () => ({}),
  },
];

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

const createBlok = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({
      holder: holder,
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const subscribeEmitAndUnsubscribe = async (
  page: Page,
  eventName: keyof BlokEventMap,
  payload: unknown
): Promise<unknown[]> => {
  return await page.evaluate(({ name, data }) => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    const received: unknown[] = [];
    const handler = (eventPayload: unknown): void => {
      received.push(eventPayload);
    };

    window.blokInstance.on(name, handler);
    window.blokInstance.emit(name, data);
    window.blokInstance.off(name, handler);
    window.blokInstance.emit(name, data);

    return received;
  }, {
    name: eventName,
    data: payload,
  });
};

const TEST_PAGE_VISIT = async (page: Page): Promise<void> => {
  await page.goto(TEST_PAGE_URL);
};

const eventsDispatcherExists = async (page: Page): Promise<boolean> => {
  return await page.evaluate(() => {
    return Boolean(window.blokInstance && 'eventsDispatcher' in window.blokInstance);
  });
};

test.describe('api.events', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await TEST_PAGE_VISIT(page);
  });

  test('should expose events dispatcher via core API', async ({ page }) => {
    await createBlok(page);

    const dispatcherExists = await eventsDispatcherExists(page);

    expect(dispatcherExists).toBe(true);
  });

  test.describe('subscription lifecycle', () => {
    for (const { name, createPayload } of EVENT_TEST_CASES) {
      test(`should subscribe, emit and unsubscribe for event "${name}"`, async ({ page }) => {
        await createBlok(page);
        const payload = createPayload();

        const receivedPayloads = await subscribeEmitAndUnsubscribe(page, name, payload);

        expect(receivedPayloads).toHaveLength(1);
        expect(receivedPayloads[0]).toStrictEqual(payload);
      });
    }
  });
});

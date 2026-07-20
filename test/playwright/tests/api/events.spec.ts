import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
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
    }),
  },
  {
    name: BlockHovered,
    createPayload: () => ({
      block: {
        id: 'hovered-block',
      },
    }),
  },
  {
    name: RedactorDomChanged,
    createPayload: () => ({
      mutations: [],
    }),
  },
  {
    name: FakeCursorAboutToBeToggled,
    createPayload: () => ({
      state: true,
    }),
  },
  {
    name: FakeCursorHaveBeenSet,
    createPayload: () => ({
      state: false,
    }),
  },
  {
    name: BlokMobileLayoutToggled,
    createPayload: () => ({
      isEnabled: true,
    }),
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

  test('emits blocks:rendered and block:rendered when blocks are rendered', async ({ page }) => {
    await createBlok(page);

    const result = await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const batches: unknown[] = [];
      const perBlock: unknown[] = [];

      window.blokInstance.on('blocks:rendered', (payload) => {
        batches.push(payload);
      });
      window.blokInstance.on('block:rendered', (payload) => {
        perBlock.push(payload);
      });

      await window.blokInstance.render({
        blocks: [
          { type: 'paragraph', data: { text: 'First' } },
          { type: 'paragraph', data: { text: 'Second' } },
        ],
      });

      return {
        batches,
        perBlockCount: perBlock.length,
      };
    });

    expect(result.batches).toContainEqual({ count: 2 });
    expect(result.perBlockCount).toBeGreaterThanOrEqual(2);
  });
});

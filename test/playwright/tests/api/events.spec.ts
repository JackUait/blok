import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import { BlockChanged } from '../../../../src/components/events/BlockChanged';
import { BlockHovered } from '../../../../src/components/events/BlockHovered';
import { RedactorDomChanged } from '../../../../src/components/events/RedactorDomChanged';
import { FakeCursorAboutToBeToggled } from '../../../../src/components/events/FakeCursorAboutToBeToggled';
import { FakeCursorHaveBeenSet } from '../../../../src/components/events/FakeCursorHaveBeenSet';
import { EditorMobileLayoutToggled } from '../../../../src/components/events/EditorMobileLayoutToggled';
import { BlockSettingsOpened } from '../../../../src/components/events/BlockSettingsOpened';
import { BlockSettingsClosed } from '../../../../src/components/events/BlockSettingsClosed';
import type { EditorEventMap } from '../../../../src/components/events';
import { BlockChangedMutationType } from '../../../../types/events/block/BlockChanged';

declare global {
  interface Window {
    editorInstance?: EditorJS;
  }
}

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';

type EventTestCase = {
  name: keyof EditorEventMap;
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
    }) as unknown as EditorEventMap[typeof BlockChanged],
  },
  {
    name: BlockHovered,
    createPayload: () => ({
      block: {
        id: 'hovered-block',
      },
    }) as unknown as EditorEventMap[typeof BlockHovered],
  },
  {
    name: RedactorDomChanged,
    createPayload: () => ({
      mutations: [],
    }) as EditorEventMap[typeof RedactorDomChanged],
  },
  {
    name: FakeCursorAboutToBeToggled,
    createPayload: () => ({
      state: true,
    }) as EditorEventMap[typeof FakeCursorAboutToBeToggled],
  },
  {
    name: FakeCursorHaveBeenSet,
    createPayload: () => ({
      state: false,
    }) as EditorEventMap[typeof FakeCursorHaveBeenSet],
  },
  {
    name: EditorMobileLayoutToggled,
    createPayload: () => ({
      isEnabled: true,
    }) as EditorEventMap[typeof EditorMobileLayoutToggled],
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

const createEditor = async (page: Page): Promise<void> => {
  await resetEditor(page);
  await page.waitForFunction(() => typeof window.EditorJS === 'function');

  await page.evaluate(async ({ holderId }) => {
    const editor = new window.EditorJS({
      holder: holderId,
    });

    window.editorInstance = editor;

    await editor.isReady;
  }, { holderId: HOLDER_ID });
};

const subscribeEmitAndUnsubscribe = async (
  page: Page,
  eventName: keyof EditorEventMap,
  payload: unknown
): Promise<unknown[]> => {
  return await page.evaluate(({ name, data }) => {
    if (!window.editorInstance) {
      throw new Error('Editor instance not found');
    }

    const received: unknown[] = [];
    const handler = (eventPayload: unknown): void => {
      received.push(eventPayload);
    };

    window.editorInstance.on(name, handler);
    window.editorInstance.emit(name, data);
    window.editorInstance.off(name, handler);
    window.editorInstance.emit(name, data);

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
    return Boolean(window.editorInstance && 'eventsDispatcher' in window.editorInstance);
  });
};

test.describe('api.events', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await TEST_PAGE_VISIT(page);
  });

  test('should expose events dispatcher via core API', async ({ page }) => {
    await createEditor(page);

    const dispatcherExists = await eventsDispatcherExists(page);

    expect(dispatcherExists).toBe(true);
  });

  test.describe('subscription lifecycle', () => {
    for (const { name, createPayload } of EVENT_TEST_CASES) {
      test(`should subscribe, emit and unsubscribe for event "${name}"`, async ({ page }) => {
        await createEditor(page);
        const payload = createPayload();

        const receivedPayloads = await subscribeEmitAndUnsubscribe(page, name, payload);

        expect(receivedPayloads).toHaveLength(1);
        expect(receivedPayloads[0]).toStrictEqual(payload);
      });
    }
  });
});

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import {
  BLOK_INTERFACE_SELECTOR,
  INLINE_TOOLBAR_INTERFACE_SELECTOR
} from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Inline toolbar must not appear when the user selects text inside a code
 * block. Code content is plain text — inline HTML formatting would break the
 * highlighting pipeline and has no semantic meaning there.
 */

const HOLDER_ID = 'blok';
const INLINE_TOOLBAR_CONTAINER_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-testid="popover-container"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(ensureBlokBundleBuilt);

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

/**
 * Select text inside a plaintext-only contenteditable (code block) using the
 * browser's native selection API. selectText helpers in other specs rely on
 * TreeWalker traversal that works fine here too, but we keep this inline to
 * avoid coupling to the general inline-toolbar helper file.
 */
const selectRangeInElement = async (locator: Locator, start: number, end: number): Promise<void> => {
  await locator.evaluate((element, { s, e }) => {
    const doc = element.ownerDocument;
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let current = walker.nextNode();

    while (current) {
      textNodes.push(current as Text);
      current = walker.nextNode();
    }

    const findPos = (offset: number): { node: Text; nodeOffset: number } | null => {
      let acc = 0;

      for (const node of textNodes) {
        const len = node.textContent?.length ?? 0;

        if (offset >= acc && offset <= acc + len) {
          return { node, nodeOffset: offset - acc };
        }
        acc += len;
      }

      return null;
    };

    const startPos = findPos(s);
    const endPos = findPos(e);

    if (!startPos || !endPos) {
      return;
    }

    const range = doc.createRange();

    range.setStart(startPos.node, startPos.nodeOffset);
    range.setEnd(endPos.node, endPos.nodeOffset);

    const selection = doc.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  }, { s: start, e: end });
};

test.describe('Code block — no inline toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('inline toolbar does not appear when selecting text inside code block', async ({ page }) => {
    await createBlok(page, [
      {
        type: 'code',
        data: {
          code: 'const answer = 42;\nconsole.log(answer);',
          language: 'javascript',
        },
      },
    ]);

    const codeEl = page.locator('[data-blok-testid="code-content"]');

    await codeEl.click();
    await selectRangeInElement(codeEl, 6, 12); // "answer"

    const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

    await expect(toolbar).toHaveCount(0);
  });

  test('inline toolbar still appears for paragraphs (sibling control)', async ({ page }) => {
    await createBlok(page, [
      {
        type: 'paragraph',
        data: { text: 'Regular paragraph text' },
      },
      {
        type: 'code',
        data: { code: 'let x = 1;', language: 'javascript' },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).locator('[contenteditable]');

    await paragraph.click();
    await selectRangeInElement(paragraph, 0, 7); // "Regular"

    const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

    await expect(toolbar).toBeVisible();
  });
});

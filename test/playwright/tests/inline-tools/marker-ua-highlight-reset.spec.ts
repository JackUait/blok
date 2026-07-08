import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const INLINE_TOOLBAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid=inline-toolbar]`;
const MARKER_BUTTON_SELECTOR = `${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="marker"]`;

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
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlokWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks });
};

const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, targetText) => {
    const root = element as HTMLElement;
    const doc = root.ownerDocument;
    const fullText = root.textContent ?? '';
    const selection = doc.getSelection();
    if (!selection) throw new Error('no selection');
    const startIndex = fullText.indexOf(targetText);
    const endIndex = startIndex + targetText.length;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let acc = 0, startNode: Node | null = null, startOffset = 0, endNode: Node | null = null, endOffset = 0;
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const t = n.textContent ?? '';
      const ns = acc, ne = acc + t.length;
      if (!startNode && startIndex >= ns && startIndex < ne) { startNode = n; startOffset = startIndex - ns; }
      if (!endNode && endIndex <= ne) { endNode = n; endOffset = endIndex - ns; break; }
      acc = ne;
    }
    if (!startNode || !endNode) throw new Error('no text nodes');
    const range = doc.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    selection.removeAllRanges();
    selection.addRange(range);
    root.focus();
    doc.dispatchEvent(new Event('selectionchange'));
  }, text);
};

/**
 * A <mark> that carries only a text color (no explicit background-color) is the
 * shape produced when colored text is transferred/pasted into an article and
 * later persisted: `migrateMarkColors` maps the color to a preset var but never
 * adds `background-color: transparent`. Browsers paint such a <mark> with their
 * UA default highlight (yellow / system Mark color), which the user perceives as
 * an un-removable highlight ("выделение").
 */
test.describe('colored mark must not render a spurious UA highlight', () => {
  test.beforeAll(() => { ensureBlokBundleBuilt(); });
  test.beforeEach(async ({ page }) => { await page.goto(TEST_PAGE_URL); });

  test('a text-color-only <mark> has a transparent background at rest', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '<mark style="color: #d44c47;">transferred colored text</mark> plain' } },
    ]);

    const bg = await page.locator(`${PARAGRAPH_SELECTOR} mark`).evaluate(
      (m) => getComputedStyle(m).backgroundColor
    );

    // The browser UA default is rgb(255, 255, 0) (yellow). It must be suppressed.
    expect(bg).not.toBe('rgb(255, 255, 0)');
    expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(bg);
  });

  test('a bare <mark> (no inline style) has a transparent background', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '<mark>bare mark</mark> plain' } },
    ]);

    const marks = page.locator(`${PARAGRAPH_SELECTOR} mark`);
    // A bare mark with no style may be sanitized away; only assert when present.
    if (await marks.count() > 0) {
      const bg = await marks.first().evaluate((m) => getComputedStyle(m).backgroundColor);
      expect(bg).not.toBe('rgb(255, 255, 0)');
    }
  });

  test('a real inline highlight background is still rendered (reset does not clobber it)', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '<mark style="background-color: var(--blok-color-yellow-bg);">highlighted</mark> plain' } },
    ]);

    const bg = await page.locator(`${PARAGRAPH_SELECTOR} mark`).evaluate(
      (m) => getComputedStyle(m).backgroundColor
    );

    // The preset yellow highlight resolves to a real (non-transparent) colour.
    expect(['rgba(0, 0, 0, 0)', 'transparent']).not.toContain(bg);
    expect(bg).not.toBe('rgb(255, 255, 0)'); // and not the UA yellow either
  });

  test('removing colour via the Default swatch leaves no mark and no highlight', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '<mark style="color: #d44c47;">transferred colored text</mark> plain' } },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    await selectText(paragraph, 'transferred colored text');

    const markerButton = page.locator(MARKER_BUTTON_SELECTOR);
    await expect(markerButton).toBeVisible();
    await markerButton.click();
    await expect(page.locator('[data-blok-testid="marker-picker"]')).toBeVisible();

    await page.locator('[data-blok-testid="marker-swatch-color-default"]').click();
    await page.keyboard.press('Escape');

    await expect(paragraph.locator('mark')).toHaveCount(0);
    await expect(paragraph).toHaveText('transferred colored text plain');
  });

  test('save → reload round-trip never reintroduces the yellow (migration path)', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '<mark style="color: rgb(17, 85, 204);">round-trip colored</mark> plain' } },
    ]);

    // Serialize (what would be persisted) then re-create the editor from it —
    // exactly what happens when a user reloads an article. This exercises
    // migrateMarkColors on the persisted mark.
    const saved = await page.evaluate(async () => {
      return await window.blokInstance!.save!();
    });
    await createBlokWithBlocks(page, saved.blocks);

    const bg = await page.locator(`${PARAGRAPH_SELECTOR} mark`).evaluate(
      (m) => getComputedStyle(m).backgroundColor
    );
    expect(bg).not.toBe('rgb(255, 255, 0)');
    expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(bg);
  });

  test('real clipboard paste of colored text renders no yellow', async ({ page }) => {
    await createBlokWithBlocks(page, [{ type: 'paragraph', data: { text: '' } }]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();
    await paragraph.click();

    // Dispatch a genuine paste event carrying Google-Docs-style colored HTML.
    await paragraph.evaluate((el) => {
      const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-x">'
        + '<span style="color:rgb(17,85,204);">pasted colored text</span></b>';
      const dt = new DataTransfer();
      dt.setData('text/html', html);
      dt.setData('text/plain', 'pasted colored text');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });

    // Synthetic ClipboardEvent handling varies by engine (Firefox may ignore a
    // programmatic paste). Assert only when the paste pipeline actually produced
    // a mark; the persisted/migration path is covered cross-engine by the
    // round-trip test above.
    const mark = page.locator(`${PARAGRAPH_SELECTOR} mark`).first();
    if (await mark.count() > 0) {
      const bg = await mark.evaluate((m) => getComputedStyle(m).backgroundColor);
      expect(bg).not.toBe('rgb(255, 255, 0)');
      expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(bg);
    }
  });

  test('a colored <mark> inside a table cell is also reset (scope covers tables)', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'table',
        data: {
          withHeadings: false,
          content: [['<mark style="color: #d44c47;">cell colored</mark>', 'plain']],
        },
      },
    ]);

    const mark = page.locator(`${BLOK_INTERFACE_SELECTOR} mark`).first();
    await expect(mark).toBeVisible();
    const bg = await mark.evaluate((m) => getComputedStyle(m).backgroundColor);
    expect(bg).not.toBe('rgb(255, 255, 0)');
  });
});

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Regression suite for the callout paste ejection bug (commit 062d9fd1 +
 * defense-in-depth follow-up).
 *
 * Original symptom: a user opens an article with a callout that already holds a
 * header child, pastes text into the callout body, and saves. On the next
 * load the pasted paragraphs appear OUTSIDE the callout — ejected as root
 * siblings — because the parent's `contentIds` drifted out of sync with the
 * pasted children's `parentId`, and `collapseToLegacy` treated the stale
 * `contentIds` as authoritative.
 *
 * These tests lock in the fix from three independent angles so the bug cannot
 * reintroduce itself through any of the three known drift vectors
 * (load, save, or legacy-format collapse).
 */

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

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

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, ...(initialData ? { data: initialData } : {}) });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

const simulatePaste = async (page: Page, opts: { html?: string; text?: string }): Promise<void> => {
  await page.evaluate((data) => {
    const dt = new DataTransfer();

    if (data.html !== undefined) {
      dt.setData('text/html', data.html);
    }
    dt.setData('text/plain', data.text ?? '');

    const active = document.activeElement ?? document.body;

    active.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    }));
  }, opts);

  // eslint-disable-next-line playwright/no-wait-for-timeout -- allow async paste pipeline to settle
  await page.waitForTimeout(300);
};

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
});

test.describe('Callout paste regression: children never ejected on save', () => {
  test('multi-line plain text pasted into callout body stays inside the callout', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        { id: 'cal1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['hdr1', 'body1'] },
        { id: 'hdr1', type: 'header', data: { text: 'Исключения', level: 4 }, parent: 'cal1' },
        { id: 'body1', type: 'paragraph', data: { text: '' }, parent: 'cal1' },
      ],
    };

    await createBlok(page, initial);

    const calloutBody = page.locator('[data-blok-id="body1"] [contenteditable]');

    await calloutBody.click();

    await simulatePaste(page, { text: '1. First line\n2. Second line\n3. Third line' });

    const saved = await page.evaluate(async () => window.blokInstance?.save());

    expect(saved).toBeDefined();

    // No root-level paragraphs — everything must be nested under the callout
    const rootParagraphs = saved?.blocks.filter(b => b.type === 'paragraph' && b.parent === undefined);

    expect(rootParagraphs).toHaveLength(0);

    // Callout must reference both the original header and every pasted paragraph
    const callout = saved?.blocks.find(b => b.id === 'cal1');

    expect(callout?.content).toBeDefined();
    expect(callout?.content).toContain('hdr1');

    const childParagraphIds = saved?.blocks
      .filter(b => b.type === 'paragraph' && b.parent === 'cal1')
      .map(b => b.id);

    expect(childParagraphIds?.length ?? 0).toBeGreaterThanOrEqual(1);
    for (const childId of childParagraphIds ?? []) {
      expect(callout?.content).toContain(childId);
    }
  });

  test('HTML paste of multiple paragraphs stays nested in the callout', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        { id: 'cal1', type: 'callout', data: { emoji: '⚠️', color: 'default' }, content: ['hdr1', 'body1'] },
        { id: 'hdr1', type: 'header', data: { text: 'Warning', level: 4 }, parent: 'cal1' },
        { id: 'body1', type: 'paragraph', data: { text: '' }, parent: 'cal1' },
      ],
    };

    await createBlok(page, initial);

    const calloutBody = page.locator('[data-blok-id="body1"] [contenteditable]');

    await calloutBody.click();

    const html = '<p>Alpha</p><p>Beta</p><p>Gamma</p>';

    await simulatePaste(page, { html, text: 'Alpha\nBeta\nGamma' });

    const saved = await page.evaluate(async () => window.blokInstance?.save());

    expect(saved).toBeDefined();

    const rootParagraphs = saved?.blocks.filter(b => b.type === 'paragraph' && b.parent === undefined);

    expect(rootParagraphs).toHaveLength(0);

    const callout = saved?.blocks.find(b => b.id === 'cal1');

    expect(callout?.content).toContain('hdr1');
  });

  test('round trip: save → re-load → save preserves all children inside callout', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        { id: 'cal1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['hdr1', 'body1'] },
        { id: 'hdr1', type: 'header', data: { text: 'Исключения', level: 4 }, parent: 'cal1' },
        { id: 'body1', type: 'paragraph', data: { text: '' }, parent: 'cal1' },
      ],
    };

    await createBlok(page, initial);

    const calloutBody = page.locator('[data-blok-id="body1"] [contenteditable]');

    await calloutBody.click();
    await simulatePaste(page, { text: 'Pasted line one\nPasted line two' });

    const firstSave = await page.evaluate(async () => window.blokInstance?.save());

    expect(firstSave).toBeDefined();

    // Reload the editor with the saved output — this exercises the insertMany
    // load-time reconciliation.
    await createBlok(page, firstSave as OutputData);

    const secondSave = await page.evaluate(async () => window.blokInstance?.save());

    expect(secondSave).toBeDefined();

    // Invariant after round trip: every non-callout block must be nested under
    // the callout (no root-level orphans)
    const orphanedBlocks = secondSave?.blocks.filter(
      b => b.type !== 'callout' && b.parent === undefined
    );

    expect(orphanedBlocks).toHaveLength(0);

    const callout = secondSave?.blocks.find(b => b.type === 'callout');

    expect(callout).toBeDefined();

    // callout.content must reference every non-callout block
    const nonCalloutIds = secondSave?.blocks.filter(b => b.type !== 'callout').map(b => b.id) ?? [];

    expect(nonCalloutIds.length).toBeGreaterThan(0);
    for (const id of nonCalloutIds) {
      expect(callout?.content).toContain(id);
    }
  });
});

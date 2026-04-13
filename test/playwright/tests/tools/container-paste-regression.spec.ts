import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Generic container-block paste-ejection regression suite.
 *
 * The original bug ejected pasted paragraphs from a callout on save. The fix
 * landed at three layers (saver, insertMany, collapseToLegacy) and is keyed on
 * `block.parentId` — so it should protect every container block type, not just
 * callout. This suite proves that empirically for each container we ship that
 * stores children via `parent`/`content`:
 *
 * - toggle
 * - header (isToggleable: true)
 *
 * Callout is covered by callout-paste-regression.spec.ts. Together they lock
 * the contract that "paste into a nested child never ejects on save" for every
 * container block shape.
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

test.describe('Container paste regression: no ejection on save (toggle, toggleable header)', () => {
  test('multi-line plain text pasted into a toggle body stays nested', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        { id: 'tog1', type: 'toggle', data: { text: 'Group', isOpen: true }, content: ['body1'] },
        { id: 'body1', type: 'paragraph', data: { text: '' }, parent: 'tog1' },
      ],
    };

    await createBlok(page, initial);

    const body = page.locator('[data-blok-id="body1"] [contenteditable]');

    await body.click();
    await simulatePaste(page, { text: 'First line\nSecond line\nThird line' });

    const saved = await page.evaluate(async () => window.blokInstance?.save());

    expect(saved).toBeDefined();

    const rootParagraphs = saved?.blocks.filter(b => b.type === 'paragraph' && b.parent === undefined);

    expect(rootParagraphs).toHaveLength(0);

    const toggle = saved?.blocks.find(b => b.id === 'tog1');

    expect(toggle?.content).toBeDefined();

    const childIds = saved?.blocks
      .filter(b => b.type === 'paragraph' && b.parent === 'tog1')
      .map(b => b.id) ?? [];

    expect(childIds.length).toBeGreaterThanOrEqual(1);
    for (const id of childIds) {
      expect(toggle?.content).toContain(id);
    }
  });

  test('HTML paste of multiple paragraphs into a toggle body stays nested', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        { id: 'tog1', type: 'toggle', data: { text: 'Group', isOpen: true }, content: ['body1'] },
        { id: 'body1', type: 'paragraph', data: { text: '' }, parent: 'tog1' },
      ],
    };

    await createBlok(page, initial);

    const body = page.locator('[data-blok-id="body1"] [contenteditable]');

    await body.click();
    await simulatePaste(page, { html: '<p>Alpha</p><p>Beta</p><p>Gamma</p>', text: 'Alpha\nBeta\nGamma' });

    const saved = await page.evaluate(async () => window.blokInstance?.save());
    const rootParagraphs = saved?.blocks.filter(b => b.type === 'paragraph' && b.parent === undefined);

    expect(rootParagraphs).toHaveLength(0);

    const toggle = saved?.blocks.find(b => b.id === 'tog1');
    const toggleChildren = saved?.blocks.filter(b => b.type === 'paragraph' && b.parent === 'tog1') ?? [];

    expect(toggleChildren.length).toBeGreaterThanOrEqual(1);
    for (const child of toggleChildren) {
      expect(toggle?.content).toContain(child.id);
    }
  });

  test('round trip save → reload → save keeps toggle children nested', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        { id: 'tog1', type: 'toggle', data: { text: 'Round trip', isOpen: true }, content: ['body1'] },
        { id: 'body1', type: 'paragraph', data: { text: '' }, parent: 'tog1' },
      ],
    };

    await createBlok(page, initial);

    const body = page.locator('[data-blok-id="body1"] [contenteditable]');

    await body.click();
    await simulatePaste(page, { text: 'one\ntwo' });

    const firstSave = await page.evaluate(async () => window.blokInstance?.save());

    expect(firstSave).toBeDefined();

    await createBlok(page, firstSave as OutputData);

    const secondSave = await page.evaluate(async () => window.blokInstance?.save());
    const orphaned = secondSave?.blocks.filter(b => b.type !== 'toggle' && b.parent === undefined);

    expect(orphaned).toHaveLength(0);

    const toggle = secondSave?.blocks.find(b => b.type === 'toggle');

    expect(toggle).toBeDefined();

    const nonToggleIds = secondSave?.blocks.filter(b => b.type !== 'toggle').map(b => b.id) ?? [];

    expect(nonToggleIds.length).toBeGreaterThan(0);
    for (const id of nonToggleIds) {
      expect(toggle?.content).toContain(id);
    }
  });

  test('multi-line plain text pasted into a toggleable header body stays nested', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        {
          id: 'hdr1',
          type: 'header',
          data: { text: 'Section', level: 2, isToggleable: true, isOpen: true },
          content: ['body1'],
        },
        { id: 'body1', type: 'paragraph', data: { text: '' }, parent: 'hdr1' },
      ],
    };

    await createBlok(page, initial);

    const body = page.locator('[data-blok-id="body1"] [contenteditable]');

    await body.click();
    await simulatePaste(page, { text: 'line A\nline B\nline C' });

    const saved = await page.evaluate(async () => window.blokInstance?.save());
    const rootParagraphs = saved?.blocks.filter(b => b.type === 'paragraph' && b.parent === undefined);

    expect(rootParagraphs).toHaveLength(0);

    const header = saved?.blocks.find(b => b.id === 'hdr1');
    const childIds = saved?.blocks
      .filter(b => b.type === 'paragraph' && b.parent === 'hdr1')
      .map(b => b.id) ?? [];

    expect(childIds.length).toBeGreaterThanOrEqual(1);
    for (const id of childIds) {
      expect(header?.content).toContain(id);
    }
  });
});

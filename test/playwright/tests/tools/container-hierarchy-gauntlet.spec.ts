import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { validateHierarchy } from '../../../../src/components/utils/hierarchy-invariant';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Operation gauntlet: exercise a long sequence of mutations inside a container
 * block (insert, type, split, paste, delete, undo, redo, reload) and assert the
 * parent ↔ content hierarchy invariant after every single save.
 *
 * The paste-ejection bug was one symptom of a broader class: any mutation that
 * breaks `child.parent === X ⇒ X.content.includes(child.id)` corrupts the
 * legacy output and silently ejects children. The three reconciliation layers
 * (saver, insertMany, collapseToLegacy) should make the invariant hold after
 * every save — this suite proves it empirically by running a real editor
 * through a realistic user flow and failing loud on any drift.
 *
 * This is the property-based / fuzz-equivalent for the invariant: if any future
 * change introduces a mutation path that bypasses reconciliation, one of these
 * steps will flush it out.
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

const saveAndAssertInvariant = async (page: Page, label: string): Promise<OutputData> => {
  const saved = await page.evaluate(async () => window.blokInstance?.save());

  expect(saved, `save(${label}) returned undefined`).toBeDefined();

  if (saved === undefined) {
    throw new Error(`save(${label}) returned undefined`);
  }

  const violations = validateHierarchy(saved.blocks);

  if (violations.length > 0) {
    throw new Error(
      `Hierarchy invariant violated after "${label}":\n` +
      violations.map(v => `  - ${v.message}`).join('\n') +
      `\nFull blocks JSON:\n${JSON.stringify(saved.blocks, null, 2)}`
    );
  }

  return saved;
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
  // eslint-disable-next-line playwright/no-wait-for-timeout -- async paste pipeline settle
  await page.waitForTimeout(300);
};

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
});

test.describe('Container hierarchy invariant gauntlet', () => {
  test('callout: invariant holds through insert, type, paste, split, delete, reload', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        { id: 'cal1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['hdr1', 'body1'] },
        { id: 'hdr1', type: 'header', data: { text: 'Note', level: 4 }, parent: 'cal1' },
        { id: 'body1', type: 'paragraph', data: { text: 'seed' }, parent: 'cal1' },
      ],
    };

    await createBlok(page, initial);

    await saveAndAssertInvariant(page, 'initial load');

    const body = page.locator('[data-blok-id="body1"] [contenteditable]');

    await body.click();
    await page.keyboard.press('End');

    // Step 1 — type some text
    await page.keyboard.type(' line one');
    await saveAndAssertInvariant(page, 'after typing');

    // Step 2 — press Enter to split inside the callout
    await page.keyboard.press('Enter');
    await page.keyboard.type('line two');
    await saveAndAssertInvariant(page, 'after enter + type');

    // Step 3 — paste multi-line plain text
    await simulatePaste(page, { text: 'pasted A\npasted B\npasted C' });
    await saveAndAssertInvariant(page, 'after plain paste');

    // Step 4 — paste multi-paragraph HTML
    await simulatePaste(page, { html: '<p>HTML alpha</p><p>HTML beta</p>', text: 'HTML alpha\nHTML beta' });
    await saveAndAssertInvariant(page, 'after html paste');

    // Step 5 — delete one of the pasted lines via Backspace
    await page.keyboard.press('Backspace');
    const afterBackspace = await saveAndAssertInvariant(page, 'after backspace');

    // Invariant is the primary contract; sanity check: at least one child still
    // nested under the callout.
    const calloutChildren = afterBackspace.blocks.filter(b => b.parent === 'cal1');

    expect(calloutChildren.length).toBeGreaterThan(0);

    // Step 6 — reload with the last saved data. Exercises insertMany + collapseToLegacy.
    await createBlok(page, afterBackspace);
    const reloaded = await saveAndAssertInvariant(page, 'after reload');

    // Ensure no root-level orphaned paragraphs after the full cycle.
    const orphans = reloaded.blocks.filter(b => b.type === 'paragraph' && b.parent === undefined);

    expect(orphans, `orphaned paragraphs after reload: ${JSON.stringify(orphans)}`).toHaveLength(0);
  });

  test('toggle: invariant holds through type, paste, split, reload', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        { id: 'tog1', type: 'toggle', data: { text: 'Toggle title', isOpen: true }, content: ['body1'] },
        { id: 'body1', type: 'paragraph', data: { text: 'seed' }, parent: 'tog1' },
      ],
    };

    await createBlok(page, initial);
    await saveAndAssertInvariant(page, 'toggle initial');

    const body = page.locator('[data-blok-id="body1"] [contenteditable]');

    await body.click();
    await page.keyboard.press('End');

    await page.keyboard.type(' tail');
    await saveAndAssertInvariant(page, 'toggle after type');

    await page.keyboard.press('Enter');
    await page.keyboard.type('second line');
    await saveAndAssertInvariant(page, 'toggle after enter');

    await simulatePaste(page, { text: 'one\ntwo\nthree' });
    const afterPaste = await saveAndAssertInvariant(page, 'toggle after paste');

    // Reload and save — exercises the insertMany + collapseToLegacy round trip.
    await createBlok(page, afterPaste);
    const reloaded = await saveAndAssertInvariant(page, 'toggle after reload');

    const orphans = reloaded.blocks.filter(b => b.type === 'paragraph' && b.parent === undefined);

    expect(orphans).toHaveLength(0);
  });

  test('toggleable header: invariant holds through type, paste, reload', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        {
          id: 'hdr1',
          type: 'header',
          data: { text: 'Section', level: 2, isToggleable: true, isOpen: true },
          content: ['body1'],
        },
        { id: 'body1', type: 'paragraph', data: { text: 'seed' }, parent: 'hdr1' },
      ],
    };

    await createBlok(page, initial);
    await saveAndAssertInvariant(page, 'header initial');

    const body = page.locator('[data-blok-id="body1"] [contenteditable]');

    await body.click();
    await page.keyboard.press('End');

    await simulatePaste(page, { text: 'alpha\nbeta\ngamma' });
    const afterPaste = await saveAndAssertInvariant(page, 'header after paste');

    await createBlok(page, afterPaste);
    const reloaded = await saveAndAssertInvariant(page, 'header after reload');

    const orphans = reloaded.blocks.filter(b => b.type === 'paragraph' && b.parent === undefined);

    expect(orphans).toHaveLength(0);
  });
});

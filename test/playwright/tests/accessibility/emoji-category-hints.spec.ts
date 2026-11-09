import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * pauseAt must target a time AFTER the install, or protocol latency turns it
 * into a backward jump and Playwright throws "Cannot fast-forward to the past".
 * @param page - the page whose clock is being frozen
 */
const installPausedClock = async (page: Page): Promise<void> => {
  const start = new Date('2030-01-01T00:00:00Z');

  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 60_000));
};

/**
 * The hint is a 300ms setTimeout, which the fake clock drives exactly. A parked
 * real pointer does not survive that: any real-time layout move under it (the
 * picker repositions on ResizeObserver, which no fake clock controls) fires a
 * mouseleave, and that CANCELS the pending reveal for good. Driving the tool's
 * own listeners keeps the pointer away from the button entirely.
 * @param button - the category button to enter or leave
 */
const enterCategory = async (button: Locator): Promise<void> => {
  await button.dispatchEvent('mouseenter');
};

/**
 * @param button - the category button to leave
 */
const leaveCategory = async (button: Locator): Promise<void> => {
  await button.dispatchEvent('mouseleave');
};

/**
 * The popover picker names its chips in text, so they carry no hover hint.
 * The inline ":" picker keeps icon-only categories with hints; its unit tests cover them.
 */
const openPicker = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(TEST_PAGE_URL);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async () => {
    const holder = document.createElement('div');

    holder.id = 'category-hints';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [{ type: 'callout', data: { emoji: '💡' } }] },
    });
    await window.blokInstance.isReady;
  });
  await page.getByTestId('callout-emoji-btn').click();
  await expect(page.getByRole('dialog', { name: 'Edit icon' })).toBeVisible();
};

/**
 * A cold runner stalls rendering for seconds on the first emoji grid paint.
 * Pay it once per worker, outside each test's 15s budget. The rAF resolves
 * only after that paint lands.
 */
test.beforeAll(async ({ browser }) => {
  test.setTimeout(60_000);
  const page = await browser.newPage();

  await openPicker(page);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await page.close();
});

test.beforeEach(async ({ page }) => {
  await openPicker(page);
});

const CHIPS = [
  ['callout', 'Callout'], ['people', 'Smileys'], ['nature', 'Nature'], ['foods', 'Food'], ['activity', 'Activity'],
  ['places', 'Travel'], ['objects', 'Objects'], ['symbols', 'Symbols'], ['flags', 'Flags'],
] as const;

test('names every category chip in text, keeping the full name for assistive tech', async ({ page }) => {
  const picker = page.getByRole('dialog', { name: 'Edit icon' });

  for (const [category, label] of CHIPS) {
    const chip = picker.locator(`[data-emoji-nav="${category}"]`);

    await expect(chip).toBeVisible();
    await expect(chip.locator('[data-emoji-nav-label]')).toHaveText(label);
    await expect(chip).toHaveAttribute('aria-label', /.+/);
  }
});

test('shows no hint on a category chip, even after the hover delay', async ({ page }) => {
  await installPausedClock(page);
  const chip = page.getByRole('dialog', { name: 'Edit icon' }).locator('[data-emoji-nav="people"]');

  await enterCategory(chip);
  await page.clock.runFor(1000);

  await expect(page.getByRole('tooltip')).not.toBeVisible();
  await leaveCategory(chip);
});

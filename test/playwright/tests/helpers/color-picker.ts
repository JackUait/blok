import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Select one axis tab of the shared color picker.
 *
 * The picker renders a tabpanel per mode and hides the inactive one, so a
 * swatch outside the active tab stays attached but is not clickable. Idempotent
 * — safe to call before every swatch click.
 * @param page - the page holding an open color picker
 * @param testIdPrefix - the picker's testid prefix ('cell-color', 'block-color', …)
 * @param modeKey - the mode key of the tab to select ('textColor', 'background-color', …)
 */
export const activateColorTab = async (page: Page, testIdPrefix: string, modeKey: string): Promise<void> => {
  const tab = page.locator(`[data-blok-testid="${testIdPrefix}-tab-${modeKey}"]`);

  await expect(tab).toBeVisible();

  if (await tab.getAttribute('aria-selected') !== 'true') {
    await tab.click();
  }

  await expect(tab).toHaveAttribute('aria-selected', 'true');
};

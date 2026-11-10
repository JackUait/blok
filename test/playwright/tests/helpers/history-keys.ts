import type { Page } from '@playwright/test';

/**
 * Blok picks its undo keys from the user agent, not the host OS.
 * Playwright's WebKit reports a Macintosh user agent on every host, Linux CI included.
 */
export const historyKeys = async (page: Page): Promise<{ undo: string; redo: string }> => {
  const mac = await page.evaluate(() => navigator.userAgent.toLowerCase().includes('mac'));

  return mac
    ? { undo: 'Meta+z', redo: 'Meta+Shift+z' }
    : { undo: 'Control+z', redo: 'Control+Shift+z' };
};

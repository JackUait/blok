import type { BrowserContext } from '@playwright/test';

/** The context each spec file got, in this worker. Both check files share it. */
export const contextByFile = new Map<string, BrowserContext>();

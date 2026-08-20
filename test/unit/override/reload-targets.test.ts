import { describe, expect, it } from 'vitest';

import { tabsToReload, shouldReloadForPayload } from '../../../override-extension/lib/reload-targets.mjs';

describe('override extension reload targets', () => {
  it('picks every http(s) tab on an armed origin, across windows', () => {
    const tabs = [
      { id: 1, url: 'http://localhost:4444/app', windowId: 1 },
      { id: 2, url: 'http://localhost:4444/other', windowId: 2 },
      { id: 3, url: 'https://kb.example/page', windowId: 1 },
    ];
    expect(tabsToReload(tabs, ['http://localhost:4444'])).toEqual([1, 2]);
    expect(tabsToReload(tabs, ['http://localhost:4444', 'https://kb.example'])).toEqual([1, 2, 3]);
  });

  it('ignores other origins, non-http schemes, discarded tabs and idless tabs', () => {
    const tabs = [
      { id: 1, url: 'https://other.example/' },
      { id: 2, url: 'chrome://extensions' },
      { id: 3, url: 'chrome-extension://abc/popup/popup.html' },
      { id: 4, url: 'https://kb.example/page', discarded: true },
      { url: 'https://kb.example/no-id' },
      { id: 6, url: '' },
      { id: 7 },
    ];
    expect(tabsToReload(tabs, ['https://kb.example'])).toEqual([]);
  });

  it('normalizes trailing slashes in armed origins', () => {
    expect(tabsToReload([{ id: 9, url: 'https://kb.example/deep/page?q=1' }], ['https://kb.example/'])).toEqual([9]);
  });

  it('reloads nothing when no origin is armed', () => {
    expect(tabsToReload([{ id: 1, url: 'https://kb.example/' }], [])).toEqual([]);
  });
});

describe('override extension payload change', () => {
  it('reloads armed tabs when the staged payload filename changes', () => {
    expect(shouldReloadForPayload('blok-override.old.js', 'blok-override.new.js')).toBe(true);
  });

  // The worker is evicted every ~30s; without this, the first wake of every
  // browser session would look like a rebuild and reload every armed tab.
  it('records the baseline without reloading on a fresh worker session', () => {
    expect(shouldReloadForPayload(null, 'blok-override.new.js')).toBe(false);
    expect(shouldReloadForPayload(undefined, 'blok-override.new.js')).toBe(false);
  });

  it('does not reload for an unchanged or missing payload', () => {
    expect(shouldReloadForPayload('blok-override.same.js', 'blok-override.same.js')).toBe(false);
    expect(shouldReloadForPayload('blok-override.old.js', null)).toBe(false);
  });
});

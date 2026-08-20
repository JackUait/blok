const normalizeOrigin = (origin) => origin.replace(/\/+$/, '');

const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * Tabs the extension reloads itself so a swap lands without the user acting.
 * Discarded tabs are skipped — reloading one would resurrect a tab the user
 * (or the browser) put to sleep.
 */
export function tabsToReload(tabs, origins) {
  const wanted = new Set(origins.map(normalizeOrigin));
  return tabs
    .filter((tab) => typeof tab.id === 'number' && tab.discarded !== true && /^https?:/.test(tab.url ?? ''))
    .filter((tab) => wanted.has(originOf(tab.url)))
    .map((tab) => tab.id);
}

// The worker is evicted between alarms, so the baseline lives in session
// storage. An absent baseline is a fresh browser session, not a rebuild —
// treating it as one would reload every armed tab on the first wake.
export function shouldReloadForPayload(previousFile, nextFile) {
  return typeof previousFile === 'string' && typeof nextFile === 'string' && previousFile !== nextFile;
}

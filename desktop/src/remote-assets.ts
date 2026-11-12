/** Resolve private media for rendering while tools retain their canonical data URLs. */
export function mountRemoteAssets(server: string, resolve: (url: string) => Promise<string>): () => void {
  const originalFetch = window.fetch;
  let alive = true;
  const canonical = new WeakMap<Element, Map<string, {original: string; resolved: string}>>();
  const pending = new WeakMap<Element, Set<string>>();
  const privateUrl = (raw: string): boolean => {
    try { const url = new URL(raw, location.href); return url.origin === server && url.pathname.startsWith('/files/') && !url.searchParams.has('grant'); } catch { return false; }
  };
  // Binary previews and downloads fetch canonical URLs, unlike media elements.
  const fetchWithPrivateAssets: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!privateUrl(url)) return originalFetch.call(window, input, init);
    const signed = await resolve(url);
    return originalFetch.call(window, input instanceof Request ? new Request(signed, input) : signed, init);
  };
  window.fetch = fetchWithPrivateAssets;
  async function refresh(element: Element, attribute: string): Promise<void> {
    const raw = element.getAttribute(attribute);
    if (!raw || !privateUrl(raw)) return;
    const inFlight = pending.get(element) ?? new Set<string>();
    if (inFlight.has(attribute)) return;
    pending.set(element, inFlight); inFlight.add(attribute);
    try {
      const resolved = await resolve(raw);
      if (!alive || element.getAttribute(attribute) !== raw) return;
      const entries = canonical.get(element) ?? new Map();
      entries.set(attribute, {original: raw, resolved}); canonical.set(element, entries);
      element.setAttribute(attribute, resolved);
    } catch { /* Preserve canonical src; retry on the next render or media error. */ }
    finally { inFlight.delete(attribute); }
  }
  function scan(element: Element): void {
    for (const node of [element, ...element.querySelectorAll('img,video,audio,source,a[href]')]) {
      if (node.matches('img,video,audio,source')) void refresh(node, 'src');
      if (node.matches('video')) void refresh(node, 'poster');
      if (node.matches('a[href]')) void refresh(node, 'href');
    }
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') scan(record.target as Element);
      else for (const node of record.addedNodes) if (node instanceof Element) scan(node);
    }
  });
  observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter:['src','poster','href']});
  const lastRetry = new WeakMap<Element, number>();
  const retry = (event: Event): void => {
    if (!(event.target instanceof Element)) return;
    const element = event.target;
    if (Date.now() - (lastRetry.get(element) ?? 0) < 30_000) return;
    lastRetry.set(element, Date.now());
    const entries = canonical.get(element);
    if (!entries) return;
    for (const [attr, entry] of entries) if (element.getAttribute(attr) === entry.resolved) {
      element.setAttribute(attr, entry.original);
      void refresh(element, attr);
    }
  };
  const opening = new WeakSet<HTMLAnchorElement>();
  const openLink = (event: MouseEvent): void => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor || opening.has(anchor)) return;
    const known = canonical.get(anchor)?.get('href');
    const original = privateUrl(anchor.href) ? anchor.href : known && known.resolved === anchor.href ? known.original : null;
    if (!original) return;
    event.preventDefault();
    const before = anchor.href;
    void resolve(original).then((signed) => {
      if (!alive || anchor.href !== before) return;
      const entries = canonical.get(anchor) ?? new Map();
      entries.set('href', {original, resolved: signed}); canonical.set(anchor, entries);
      anchor.href = signed;
      opening.add(anchor);
      try { anchor.click(); } finally { opening.delete(anchor); }
    }).catch(() => undefined);
  };
  document.addEventListener('click', openLink, true);
  document.addEventListener('error', retry, true);
  scan(document.body);
  return () => { alive = false; observer.disconnect(); document.removeEventListener('error', retry, true); document.removeEventListener('click', openLink, true); if (window.fetch === fetchWithPrivateAssets) window.fetch = originalFetch; };
}

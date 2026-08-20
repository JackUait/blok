// Only /dist/-shaped URLs are routable to the extension's staged dist mirror,
// so anything else (esm.sh rewrites, repo files) is treated as not-blok.
const CDN_BLOK_URL = /^(https?:\/\/.+?\/(@(?:bloklabs\/core|jackuait\/blok))@([^/]+)\/dist\/)/;

export function parseCdnBlokUrl(url) {
  const match = CDN_BLOK_URL.exec(url);
  if (!match) {
    return null;
  }
  return { pkg: match[2], version: match[3], prefix: match[1] };
}

export function summarizeDetection(facts) {
  if (!facts) {
    return { state: 'no-tab' };
  }
  const cdn = [];
  const seen = new Set();
  for (const url of facts.urls) {
    const ref = parseCdnBlokUrl(url);
    if (ref && !seen.has(ref.prefix)) {
      seen.add(ref.prefix);
      cdn.push(ref);
    }
  }
  if (!facts.hasEditor && cdn.length === 0) {
    return { state: 'no-blok', origin: facts.origin };
  }
  return {
    state: 'detected',
    origin: facts.origin,
    bundled: { present: facts.hasEditor, version: facts.version },
    cdn,
  };
}

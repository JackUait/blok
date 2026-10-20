/**
 * Keyless web tools for the playground's Ask AI: Wikipedia search, Wikimedia
 * Commons image search and a page fetch. scripts/dev-ai.mjs serves them on
 * `POST /web`; src/playground/ai-model.ts offers them to the model.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Wikimedia blocks requests without a descriptive User-Agent.
const USER_AGENT = 'BlokPlayground/1.0 (https://github.com/JackUait/blok; dev Ask AI)';
const MAX_TEXT = 20_000;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15_000;

const stripTags = (html) => html
  .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const isPrivateV4 = (address) => {
  const [a, b] = address.split('.').map(Number);

  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
};

const isPrivateAddress = (address) => {
  if (isIP(address) === 4) {
    return isPrivateV4(address);
  }

  const lower = address.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);

  if (mapped !== null) {
    return isPrivateV4(mapped[1]);
  }

  return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
};

/** Throws unless `raw` is an http(s) URL whose host resolves only to public addresses. */
const checkPublic = async (raw, lookup) => {
  const url = new URL(raw);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs can be fetched, not ${url.protocol}`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error(`${host} is on this machine and cannot be fetched.`);
  }

  const addresses = isIP(host) === 0 ? (await lookup(host, { all: true })).map((entry) => entry.address) : [host];

  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error(`${host} is on a private network and cannot be fetched.`);
  }

  return url;
};

const getJson = async (fetch, url, signal) => {
  const response = await fetch(url.toString(), { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal });

  if (!response.ok) {
    throw new Error(`${url.host} answered HTTP ${response.status}.`);
  }

  return response.json();
};

const queryOf = (input) => {
  const query = typeof input?.query === 'string' ? input.query.trim() : '';

  if (query === '') {
    throw new Error('Send { "query": "…" }.');
  }

  return query;
};

const langOf = (input) => (typeof input?.lang === 'string' && /^[a-z-]{2,12}$/.test(input.lang) ? input.lang : 'en');

const webSearch = async (fetch, input, signal) => {
  const lang = langOf(input);
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);

  url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: queryOf(input), srlimit: '8', format: 'json', utf8: '1' }).toString();

  const results = (await getJson(fetch, url, signal))?.query?.search ?? [];

  if (results.length === 0) {
    return 'No results.';
  }

  return results.map((result) => [
    result.title,
    `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(result.title.replace(/ /g, '_'))}`,
    stripTags(result.snippet ?? ''),
  ].join('\n')).join('\n\n');
};

const imageSearch = async (fetch, input, signal) => {
  const url = new URL('https://commons.wikimedia.org/w/api.php');

  url.search = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${queryOf(input)}`,
    gsrnamespace: '6',
    gsrlimit: '8',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '1280',
    format: 'json',
  }).toString();

  // Keyed by page id; `index` is the search rank.
  const pages = Object.values((await getJson(fetch, url, signal))?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const lines = pages.flatMap((page) => {
    const info = page.imageinfo?.[0];

    if (info === undefined) {
      return [];
    }

    const meta = info.extmetadata ?? {};

    return [[
      page.title.replace(/^File:/, ''),
      `Image URL: ${info.thumburl ?? info.url}`,
      `Page: ${info.descriptionurl}`,
      `Size: ${info.width}×${info.height}`,
      `Author: ${stripTags(meta.Artist?.value ?? 'unknown')}`,
      `License: ${meta.LicenseShortName?.value ?? 'unknown'}`,
    ].join('\n')];
  });

  return lines.length === 0 ? 'No images found.' : lines.join('\n\n');
};

const webFetch = async (fetch, lookup, input, signal) => {
  const start = typeof input?.url === 'string' ? input.url : '';
  const state = { url: await checkPublic(start, lookup), hops: 0 };

  for (;;) {
    // Redirects are followed by hand so each hop gets the same address check.
    const response = await fetch(state.url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
    const location = response.headers.get('location');

    if (response.status >= 300 && response.status < 400 && location !== null) {
      state.hops += 1;
      if (state.hops > MAX_REDIRECTS) {
        throw new Error('Too many redirects.');
      }
      state.url = await checkPublic(new URL(location, state.url).toString(), lookup);
      continue;
    }

    const type = response.headers.get('content-type') ?? 'unknown';

    if (!response.ok) {
      throw new Error(`${state.url} answered HTTP ${response.status}.`);
    }
    if (!/^text\/|html|xml|json/.test(type)) {
      await response.body?.cancel();

      return `${state.url} loads: HTTP ${response.status}, ${type}.`;
    }

    const body = await response.text();
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const text = /html/.test(type) ? stripTags(body.replace(/<title[^>]*>[\s\S]*?<\/title>/i, '')) : body;

    return [
      `${state.url} (HTTP ${response.status}, ${type})`,
      ...(title === undefined ? [] : [`Title: ${stripTags(title)}`]),
      '',
      text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text,
    ].join('\n');
  }
};

/**
 * @param {{ fetch?: typeof fetch, lookup?: (host: string, options: { all: true }) => Promise<Array<{ address: string }>> }} [deps]
 *   Tests pass both, so nothing reaches the network.
 * @returns {(tool: string, input: unknown, signal: AbortSignal) => Promise<string>}
 */
export function webTools({ fetch = globalThis.fetch, lookup = dnsLookup } = {}) {
  return async (tool, input, signal) => {
    switch (tool) {
      case 'web_search':
        return webSearch(fetch, input, signal);
      case 'image_search':
        return imageSearch(fetch, input, signal);
      case 'web_fetch':
        return webFetch(fetch, lookup, input, signal);
      default:
        throw new Error(`Unknown web tool: ${tool}`);
    }
  };
}

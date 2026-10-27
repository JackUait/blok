/**
 * Keyless web tools for the playground's Ask AI: Wikimedia Commons image search
 * and a page fetch. scripts/dev-ai.mjs serves them on `POST /web`;
 * src/playground/ai-model.ts offers them to the model. Web search is the
 * provider's own, added in messageParams (dev-ai.mjs).
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';

// Wikimedia blocks requests without a descriptive User-Agent.
const USER_AGENT = 'BlokPlayground/1.0 (https://github.com/JackUait/blok; dev Ask AI)';
const MAX_TEXT = 20_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15_000;

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

// One pass: decoding `&amp;` first would turn `&amp;lt;` into `<`.
const stripTags = (html) => html
  .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, name) => ENTITIES[name])
  .replace(/\s+/g, ' ')
  .trim();

// Every address that is not plain public unicast. BlockList also matches an
// IPv4-mapped IPv6 address (::ffff:7f00:1) against the IPv4 rules.
const BLOCKED = new BlockList();

[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([network, prefix]) => BLOCKED.addSubnet(network, prefix, 'ipv4'));
// ::/96 and 64:ff9b::/96 and 2002::/16 embed an IPv4 address; blocking them whole is simpler than unpacking it.
[
  ['::', 96], ['64:ff9b::', 96], ['100::', 64], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
].forEach(([network, prefix]) => BLOCKED.addSubnet(network, prefix, 'ipv6'));

const isPrivateAddress = (address) => BLOCKED.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');

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

/**
 * A fetch whose socket connects only to addresses the guard passed, so a name
 * cannot resolve public for the check and private for the connection.
 * Handles what web_fetch sends: GET, manual redirects, a signal.
 */
const pinnedFetch = (lookup) => (url, init) => new Promise((resolve, reject) => {
  const target = new URL(url);
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const guardedLookup = (host, options, callback) => {
    lookup(host, { all: true }).then((entries) => {
      const bad = entries.find((entry) => isPrivateAddress(entry.address));

      if (entries.length === 0 || bad !== undefined) {
        callback(new Error(`${host} resolves to a private network and cannot be fetched.`));

        return;
      }
      if (options.all === true) {
        callback(null, entries.map((entry) => ({ address: entry.address, family: isIP(entry.address) })));
      } else {
        callback(null, entries[0].address, isIP(entries[0].address));
      }
    }, callback);
  };
  const outgoing = request(target, { method: 'GET', headers: init?.headers, lookup: guardedLookup, signal: init?.signal }, (incoming) => {
    const headers = new Headers();

    Object.entries(incoming.headers).forEach(([name, value]) => {
      [value].flat().forEach((entry) => entry !== undefined && headers.append(name, entry));
    });

    const status = incoming.statusCode ?? 502;
    const empty = status === 204 || status === 304 || (status >= 300 && status < 400);

    if (empty) {
      incoming.resume();
    }
    resolve(new Response(empty ? null : Readable.toWeb(incoming), { status, headers }));
  });

  outgoing.on('error', reject);
  outgoing.end();
});

/** At most MAX_BYTES of the body, decoded; the rest is never downloaded. */
const readCapped = async (response) => {
  const reader = response.body?.getReader();
  const chunks = [];
  const state = { size: 0 };

  if (reader === undefined) {
    return '';
  }

  while (state.size < MAX_BYTES) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }
    chunks.push(value);
    state.size += value.byteLength;
  }
  await reader.cancel().catch(() => {});

  const bytes = new Uint8Array(state.size);

  chunks.reduce((offset, chunk) => {
    bytes.set(chunk, offset);

    return offset + chunk.byteLength;
  }, 0);

  return new TextDecoder().decode(bytes.subarray(0, MAX_BYTES));
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

    const body = await readCapped(response);
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
 *   Tests pass both, so nothing reaches the network. Without `fetch`, web_fetch
 *   connects only to addresses `lookup` gave and the guard passed.
 * @returns {(tool: string, input: unknown, signal: AbortSignal) => Promise<string>}
 */
export function webTools({ fetch, lookup = dnsLookup } = {}) {
  return async (tool, input, signal) => {
    switch (tool) {
      case 'image_search':
        return imageSearch(fetch ?? globalThis.fetch, input, signal);
      case 'web_fetch':
        return webFetch(fetch ?? pinnedFetch(lookup), lookup, input, signal);
      default:
        throw new Error(`Unknown web tool: ${tool}`);
    }
  };
}

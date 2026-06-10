/**
 * Dev-server unfurl endpoint for the Bookmark tool.
 *
 * Mounts a `/unfurl` middleware on the Vite dev and preview servers that
 * fetches a target page server-side (no browser CORS), scrapes its
 * OpenGraph/Twitter metadata and answers in the @editorjs/link contract
 * expected by `src/tools/link/metadata-fetcher.ts`:
 *
 *   { success: 1, link, meta: { title, description, image: { url }, favicon, domain } }
 *
 * Dev-only middleware — no SSRF hardening beyond the http(s) scheme check.
 */

import { parseMetadata } from './parse-metadata.mjs';

const FETCH_TIMEOUT_MS = 6_000;

/** Meta tags live in <head>; cap the body read so huge pages stay cheap. */
const MAX_BODY_CHARS = 1.5 * 1024 * 1024;

const PRIMARY_UA = 'Mozilla/5.0 (compatible; BlokDevUnfurl/1.0)';

/**
 * Some sites (YouTube) bot-classify unknown UAs and serve a shell page with no
 * OpenGraph tags, but whitelist link-preview crawlers. Used only as a retry —
 * others (Wikipedia) 403 a spoofed crawler UA from non-crawler IPs.
 */
const CRAWLER_UA = 'facebookexternalhit/1.1; BlokDevUnfurl/1.0';

/**
 * @typedef {{ url?: string }} UnfurlRequest
 * @typedef {{ statusCode: number, setHeader(name: string, value: string): void, end(body: string): void }} UnfurlResponse
 */

/**
 * Sends a JSON payload with a 200 status.
 *
 * @param {UnfurlResponse} res Server response.
 * @param {object} payload JSON-serializable payload (undefined fields are dropped).
 * @returns {void}
 */
function respondJson(res, payload) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

/**
 * Extracts and validates the `url` query param from the middleware request URL.
 *
 * @param {string} reqUrl Request URL relative to the middleware mount point.
 * @returns {string | undefined} Validated http(s) target URL.
 */
function extractTargetUrl(reqUrl) {
  let raw;

  try {
    raw = new URL(reqUrl, 'http://localhost').searchParams.get('url');
  } catch {
    return undefined;
  }

  if (raw === null || raw === '') {
    return undefined;
  }

  try {
    const target = new URL(raw);

    return target.protocol === 'http:' || target.protocol === 'https:' ? target.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Creates the `/unfurl` middleware. The fetch implementation is injectable
 * so tests never hit the network.
 *
 * @param {(url: string, init?: RequestInit) => Promise<Response>} [fetchImpl] Fetch implementation.
 * @returns {(req: UnfurlRequest, res: UnfurlResponse) => Promise<void>} Connect-style middleware.
 */
export function createUnfurlHandler(fetchImpl = fetch) {
  /**
   * Fetches the target with one user-agent and parses its metadata.
   *
   * @param {string} target Validated http(s) URL.
   * @param {string} userAgent UA header to send.
   * @returns {Promise<{ meta: import('./parse-metadata.mjs').ParsedMetadata, finalUrl: string } | undefined>}
   *   Parse result, or undefined on any fetch/status/content-type failure.
   */
  const fetchAndParse = async (target, userAgent) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetchImpl(target, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,*/*',
        },
      });

      const contentType = response.headers.get('content-type') ?? '';

      if (!response.ok || !contentType.includes('html')) {
        return undefined;
      }

      const html = (await response.text()).slice(0, MAX_BODY_CHARS);
      const finalUrl = response.url !== '' ? response.url : target;

      return { meta: parseMetadata(html, finalUrl), finalUrl };
    } catch {
      // Timeout, DNS failure, connection reset — caller falls back, never 500.
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  };

  /**
   * @param {import('./parse-metadata.mjs').ParsedMetadata} meta Parsed fields.
   * @returns {number} How many card-driving fields the parse found.
   */
  const richness = (meta) =>
    [meta.title, meta.description, meta.image].filter((field) => field !== undefined).length;

  return async (req, res) => {
    const target = extractTargetUrl(req.url ?? '');

    if (target === undefined) {
      respondJson(res, { success: 0 });

      return;
    }

    let result = await fetchAndParse(target, PRIMARY_UA);

    if (result === undefined || result.meta.title === undefined || result.meta.image === undefined) {
      const retry = await fetchAndParse(target, CRAWLER_UA);

      if (retry !== undefined && (result === undefined || richness(retry.meta) > richness(result.meta))) {
        result = retry;
      }
    }

    if (result === undefined) {
      respondJson(res, { success: 0 });

      return;
    }

    const { meta, finalUrl } = result;

    respondJson(res, {
      success: 1,
      link: finalUrl,
      meta: {
        title: meta.title,
        description: meta.description,
        image: meta.image === undefined ? undefined : { url: meta.image },
        favicon: meta.favicon,
        domain: meta.domain,
      },
    });
  };
}

/**
 * Vite plugin exposing the `/unfurl` endpoint on dev and preview servers.
 *
 * @returns {{ name: string, configureServer(server: { middlewares: { use(path: string, handler: Function): void } }): void, configurePreviewServer(server: { middlewares: { use(path: string, handler: Function): void } }): void }} Vite plugin.
 */
export default function unfurlPlugin() {
  const handler = createUnfurlHandler();

  return {
    name: 'blok-unfurl',
    configureServer(server) {
      server.middlewares.use('/unfurl', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/unfurl', handler);
    },
  };
}

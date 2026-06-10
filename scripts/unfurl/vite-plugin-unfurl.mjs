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
  return async (req, res) => {
    const target = extractTargetUrl(req.url ?? '');

    if (target === undefined) {
      respondJson(res, { success: 0 });

      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetchImpl(target, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; BlokDevUnfurl/1.0)',
          accept: 'text/html,*/*',
        },
      });

      const contentType = response.headers.get('content-type') ?? '';

      if (!response.ok || !contentType.includes('html')) {
        respondJson(res, { success: 0 });

        return;
      }

      const html = (await response.text()).slice(0, MAX_BODY_CHARS);
      const finalUrl = response.url !== '' ? response.url : target;
      const meta = parseMetadata(html, finalUrl);

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
    } catch {
      // Timeout, DNS failure, connection reset — always answer success: 0, never 500.
      respondJson(res, { success: 0 });
    } finally {
      clearTimeout(timeout);
    }
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

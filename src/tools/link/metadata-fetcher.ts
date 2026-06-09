/**
 * Bookmark metadata fetcher.
 *
 * Blok ships no backend. The consumer supplies an `endpoint` that scrapes
 * OpenGraph/Twitter-card metadata and returns it as JSON. This client GETs
 * `endpoint?url=<encoded>` and normalizes the response, mirroring the
 * @editorjs/link contract. Browser CORS makes a same-origin proxy mandatory.
 */
export interface BookmarkConfig {
  /** Consumer-supplied unfurl endpoint. Required. */
  endpoint: string;
  /** Optional headers (e.g. auth) sent with the request. */
  headers?: Record<string, string>;
}

export interface BookmarkMeta {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  domain?: string;
}

interface UnfurlResponse {
  success: 0 | 1;
  link?: string;
  meta?: {
    title?: string;
    description?: string;
    image?: { url?: string };
    favicon?: string;
    domain?: string;
  };
}

export class MetadataFetcher {
  constructor(private readonly config: BookmarkConfig) {}

  public async fetch(url: string): Promise<BookmarkMeta> {
    if (!this.config.endpoint) {
      throw new Error('Bookmark tool requires an `endpoint` config to fetch link metadata.');
    }

    const requestUrl = `${this.config.endpoint}?url=${encodeURIComponent(url)}`;
    const response = await fetch(requestUrl, { headers: this.config.headers });

    if (!response.ok) {
      throw new Error(`Metadata request failed with status ${response.status}.`);
    }

    const body = (await response.json()) as UnfurlResponse;

    if (body.success !== 1) {
      throw new Error('Metadata request was unsuccessful.');
    }

    const meta = body.meta ?? {};

    return {
      url: body.link ?? url,
      title: meta.title,
      description: meta.description,
      image: meta.image?.url,
      favicon: meta.favicon,
      domain: meta.domain,
    };
  }
}

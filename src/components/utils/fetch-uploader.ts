import type { BlokUploader, DeleteContext, UploadContext, UploadedAsset } from '../../../types/configs/uploader';
import { uploadWithProgress } from './upload-xhr';

/**
 * Options for an uploader talking to a service that speaks Blok's upload
 * contract — the standalone host, the in-process ASP.NET routes, or anything
 * else exposing `/upload`, `/upload-by-url` and `/delete`.
 *
 * `@bloklabs/presets`' `fetchStorage` is the published face of this; it keeps
 * its own `FetchStorageOptions` declaration because its published `.d.ts` is
 * hand-mirrored and may not reach outside its own tarball.
 */
export interface FetchUploaderOptions {
  /** Base URL of a service speaking Blok's upload contract, e.g. `https://blok.myapp.com`. */
  baseUrl: string;
  /** Multipart field name the endpoint reads. Defaults to `file`. */
  field?: string;
  /**
   * Extra headers. Pass a function to mint a short-lived access pass per
   * request — the uploader never inspects what it returns.
   */
  headers?: Record<string, string> | (() => Promise<Record<string, string>>);
}

/**
 * Builds an uploader pointed at a service speaking Blok's upload contract.
 * @param options - base URL, multipart field name and headers
 */
export function createFetchUploader(options: FetchUploaderOptions): BlokUploader {
  const base = options.baseUrl.replace(/\/+$/, '');
  const field = options.field ?? 'file';

  const resolveHeaders = async (): Promise<Record<string, string>> =>
    typeof options.headers === 'function' ? options.headers() : options.headers ?? {};

  return {
    async uploadByFile(file: File, ctx: UploadContext): Promise<UploadedAsset> {
      const body = new FormData();

      body.append(field, file);

      const { status, text } = await uploadWithProgress({
        method: 'POST',
        url: `${base}/upload`,
        body,
        headers: await resolveHeaders(),
        onProgress: ctx.onProgress,
      });

      if (status < 200 || status > 299) {
        throw new Error(`Fetch endpoint upload failed with status ${status}`);
      }

      return parseUploadResponse(text, file.name);
    },

    async uploadByUrl(url: string, _ctx: UploadContext): Promise<UploadedAsset> {
      const response = await fetch(`${base}/upload-by-url`, {
        method: 'POST',
        // Content-Type is set last, same order as the presigned preset's PUT: a
        // caller's headers must not be able to silently swap it and break
        // this endpoint's JSON body parsing.
        headers: { ...(await resolveHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error(`Fetch endpoint upload failed with status ${response.status}`);
      }

      return toAsset(parseJson(await response.text()));
    },

    async delete(url: string, _ctx: DeleteContext): Promise<void> {
      const response = await fetch(`${base}/delete`, {
        method: 'POST',
        // Content-Type last, same reasoning as uploadByUrl above.
        headers: { ...(await resolveHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error(`Fetch endpoint delete failed with status ${response.status}`);
      }
    },
  };
}

/**
 * @param text - raw response body
 * @param fallbackName - name to keep when the endpoint reports none
 */
function parseUploadResponse(text: string, fallbackName: string): UploadedAsset {
  const asset = toAsset(parseJson(text));

  return { url: asset.url, fileName: asset.fileName ?? fallbackName };
}

/**
 * @param text - raw response body
 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Upload failed: the endpoint returned a malformed response');
  }
}

/**
 * @param body - parsed response body
 */
function toAsset(body: unknown): UploadedAsset {
  if (typeof body !== 'object' || body === null || typeof (body as { url?: unknown }).url !== 'string') {
    throw new Error('Upload failed: the endpoint returned no url');
  }

  const record = body as Record<string, unknown>;

  return {
    url: record.url as string,
    fileName: typeof record.fileName === 'string' ? record.fileName : undefined,
  };
}

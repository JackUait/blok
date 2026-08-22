import type { BlokUploader, UploadContext, UploadedAsset } from '../../../types/configs/uploader';
import { uploadWithProgress } from './upload-xhr';

export interface FetchStorageOptions {
  /** Base URL of a service speaking Blok's upload contract, e.g. `https://blok.myapp.com`. */
  baseUrl: string;
  /** Multipart field name the endpoint reads. Defaults to `file`. */
  field?: string;
  /**
   * Extra headers. Pass a function to mint a short-lived access pass per
   * request — the preset never inspects what it returns.
   */
  headers?: Record<string, string> | (() => Promise<Record<string, string>>);
}

export function fetchStorage(options: FetchStorageOptions): BlokUploader {
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
        throw new Error(`Upload failed with status ${status}`);
      }

      return parseUploadResponse(text, file.name);
    },

    async uploadByUrl(url: string, _ctx: UploadContext): Promise<UploadedAsset> {
      const response = await fetch(`${base}/upload-by-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await resolveHeaders()) },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }

      const body: unknown = await response.json();

      return toAsset(body);
    },
  };
}

function parseUploadResponse(text: string, fallbackName: string): UploadedAsset {
  const asset = toAsset(parseJson(text));

  return { url: asset.url, fileName: asset.fileName ?? fallbackName };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Upload failed: the endpoint returned a malformed response');
  }
}

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

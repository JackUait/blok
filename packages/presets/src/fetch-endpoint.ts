import type { BlokUploader } from '../../../types/configs/uploader';
import { createFetchUploader } from '../../../src/components/utils/fetch-uploader';

/**
 * Declared here rather than imported from the editor: this package's published
 * `.d.ts` is hand-mirrored and may not reach outside its own tarball, so
 * `presets-uploader-mirror-law` checks this declaration against the mirror.
 */
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
  return createFetchUploader(options);
}

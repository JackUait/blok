/**
 * `BlokUploader` and its supporting types, mirrored from `types/configs/uploader.d.ts`
 * (and `AssetKind` from `types/tools/block-tool.d.ts`) rather than imported.
 *
 * A published `.d.ts` under `types/` ships as-is inside this package's own
 * tarball (`files: ["dist", "types"]`) — a relative specifier like
 * `../../../types/configs/uploader` resolves inside this monorepo, but once
 * installed at `node_modules/@bloklabs/presets/types/index.d.ts` there is no
 * repo root three levels up to reach, so every consumer's `tsc` would fail
 * with TS2307. This package also declares zero dependencies, so it cannot
 * import `@bloklabs/core`'s published types either (and `BlokUploader` is not
 * part of that package's public surface regardless). Keep these definitions
 * in sync with core's by hand until a generator exists (see `types/icons.d.ts`
 * + `scripts/generate-icons-dts.mjs` for that pattern).
 */

/** The kind of asset being uploaded. */
export type AssetKind = 'image' | 'video' | 'audio' | 'file';

/** A resolved upload result. */
export interface UploadedAsset {
  /** Public URL the asset is reachable at once stored. */
  url: string;
  /** Original filename, when the host preserved one. */
  fileName?: string;
}

/**
 * Describes a single upload request.
 *
 * `kind` is the kind of asset being uploaded — NOT the tool that asked for
 * it (an audio block uploading cover art sends `kind: 'image'`).
 */
export interface UploadContext {
  /** Kind of asset being uploaded. */
  kind: AssetKind;
  /** Name of the block tool that requested the upload, when known. */
  tool?: string;
  /** Upload progress in percent (0–100), when the host reports it. */
  onProgress?(percent: number): void;
}

/**
 * Editor-level uploader, keyed by asset kind rather than by tool. Both
 * methods are optional and resolved independently.
 */
export interface BlokUploader {
  /** Store a file chosen by the user and return its public URL. */
  uploadByFile?(file: File, ctx: UploadContext): Promise<UploadedAsset>;
  /** Re-host an asset the user supplied by URL, and return the stored URL. */
  uploadByUrl?(url: string, ctx: UploadContext): Promise<UploadedAsset>;
}

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

/**
 * Uploader for any endpoint speaking Blok's documented upload wire contract
 * — including the `blok-server` sidecar, or a backend a consumer already
 * wrote against that contract.
 */
export function fetchStorage(options: FetchStorageOptions): BlokUploader;

// Remaining storage presets are re-exported here as each one ships (task 3: Supabase, task 4: S3, task 5: Cloudinary, task 6: IndexedDB).

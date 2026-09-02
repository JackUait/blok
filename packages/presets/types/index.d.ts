/**
 * `BlokUploader` and its supporting types below, mirrored from
 * `types/configs/uploader.d.ts` (and `AssetKind` from
 * `types/tools/block-tool.d.ts`) rather than imported — and deliberately not
 * exported, since this package's public surface is only what each preset's
 * brief asks it to produce (`fetchStorage`, `supabaseStorage`, and so on as
 * each ships).
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
type AssetKind = 'image' | 'video' | 'audio' | 'file';

/** A resolved upload result. */
interface UploadedAsset {
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
interface UploadContext {
  /** Kind of asset being uploaded. */
  kind: AssetKind;
  /** Name of the block tool that requested the upload, when known. */
  tool?: string;
  /** Upload progress in percent (0–100), when the host reports it. */
  onProgress?(percent: number): void;
}

/**
 * Describes a single deletion request.
 *
 * The same `kind`/`tool` pair {@link UploadContext} carries, minus progress —
 * a deletion has nothing to report but its outcome.
 */
interface DeleteContext {
  /** Kind of asset being deleted. */
  kind: AssetKind;
  /** Name of the block tool that owned the asset, when known. */
  tool?: string;
}

/**
 * Editor-level uploader, keyed by asset kind rather than by tool. Every
 * method is optional and resolved independently.
 */
interface BlokUploader {
  /** Store a file chosen by the user and return its public URL. */
  uploadByFile?(file: File, ctx: UploadContext): Promise<UploadedAsset>;
  /** Re-host an asset the user supplied by URL, and return the stored URL. */
  uploadByUrl?(url: string, ctx: UploadContext): Promise<UploadedAsset>;
  /** Delete a stored asset by the URL this uploader returned for it. */
  delete?(url: string, ctx: DeleteContext): Promise<void>;
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

/**
 * Structural shape of a Supabase JS client's storage API. Matched
 * structurally rather than imported from `@supabase/supabase-js`, which this
 * package never depends on — the consumer passes their own client instance,
 * so their own auth session applies.
 */
export interface SupabaseLike {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: File,
        options?: { contentType?: string; upsert?: boolean }
      ): Promise<{ data: { path: string } | null; error: { message: string } | null }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
}

export interface SupabaseStorageOptions {
  /** Bucket name, or a function of the asset kind for per-kind buckets. */
  bucket?: string | ((kind: AssetKind) => string);
  /** Object path. Defaults to a random name that keeps the original extension. */
  path?: (file: File, ctx: UploadContext) => string;
}

/**
 * Uploader backed by a Supabase Storage bucket. Declares no `uploadByUrl`:
 * re-hosting a remote URL needs a server-side fetch the browser cannot do, so
 * Blok's documented fallback (store the URL verbatim) applies instead.
 */
export function supabaseStorage(client: SupabaseLike, options?: SupabaseStorageOptions): BlokUploader;

/** What the preset asks its signer for before it can PUT a file. */
export interface SignRequest {
  fileName: string;
  mimeType: string;
  size: number;
  kind: AssetKind;
}

/** What the signer hands back so the browser can PUT straight to the bucket. */
export interface SignedTarget {
  /** Short-lived URL the browser PUTs to. */
  uploadUrl: string;
  /** Where the object will be readable once stored. */
  publicUrl: string;
  /** Headers the signature covers — they must be sent verbatim or it fails. */
  headers?: Record<string, string>;
}

export interface PresignedStorageOptions {
  sign(request: SignRequest): Promise<SignedTarget>;
}

/**
 * Uploader for any provider fronted by a signer — S3, R2, or anything
 * S3-compatible. The consumer's own backend mints the signed URL, so
 * credentials never reach the browser. Declares no `uploadByUrl`, same
 * reasoning as {@link supabaseStorage}.
 */
export function presignedStorage(options: PresignedStorageOptions): BlokUploader;

export interface CloudinaryStorageOptions {
  cloudName: string;
  /** An UNSIGNED upload preset — a signed one would need a server. */
  uploadPreset: string;
  folder?: string;
}

/**
 * Uploader backed by Cloudinary's unsigned upload API. Unlike the other
 * presets, this one declares a real `uploadByUrl`: Cloudinary fetches remote
 * URLs server-side itself, so re-hosting works without any server of the
 * consumer's own.
 */
export function cloudinaryStorage(options: CloudinaryStorageOptions): BlokUploader;

export interface IndexedDBStorageOptions {
  dbName?: string;
}

/**
 * Uploader backed by IndexedDB — for demos and local-first apps with no
 * backend. Returns a `blok:asset/<id>` reference rather than a `blob:` URL:
 * blob URLs are scoped to the page that created them, so saving one produces
 * a broken image after a reload, which is exactly what this preset exists to
 * avoid.
 */
export function indexedDBStorage(options?: IndexedDBStorageOptions): BlokUploader;

/**
 * Turns a `blok:asset/<id>` reference back into a `blob:` URL an `<img>` can
 * display. Any value that is not a `blok:asset/` reference — `http(s)`, or
 * anything else — is returned unchanged; validating that a URL is safe to
 * render remains the host's job. Resolves `null` when the reference is not
 * (or no longer) stored.
 */
export function resolveBlokObjectUrl(url: string, options?: IndexedDBStorageOptions): Promise<string | null>;

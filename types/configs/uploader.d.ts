import { AssetKind } from '../tools/block-tool';

/**
 * A resolved upload result. Mirrors the per-tool uploader return shapes
 * (`ImageUploader`, `AudioUploader`, …) so a host can reuse one implementation.
 */
export interface UploadedAsset {
  /** Public URL the asset is reachable at once stored. */
  url: string;
  /** Original filename, when the host preserved one. */
  fileName?: string;
}

/**
 * Describes a single upload request.
 *
 * `kind` is the kind of asset being uploaded — NOT the tool that asked for it.
 * The two differ whenever a tool owns an asset outside its own media family:
 * an audio block uploading its cover art sends `kind: 'image'` with
 * `tool: 'audio'`. Routing on `kind` is what lets a host send that cover to the
 * same image pipeline the image block uses.
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
 * Editor-level uploader, keyed by asset kind rather than by tool.
 *
 * Set on {@link BlokConfig.uploader}, it serves every media tool. A per-tool
 * `config.uploader` (e.g. `tools.image.config.uploader`) stays authoritative
 * for its own asset kind and takes precedence — this is the fallback for kinds
 * no tool-level uploader claims.
 *
 * Both methods are optional and resolved independently: declaring only
 * `uploadByUrl` here still lets a tool-level `uploadByFile` handle files.
 */
export interface BlokUploader {
  /**
   * Store a file chosen by the user and return its public URL.
   * When absent for a kind, Blok falls back to an in-memory `blob:` URL, which
   * does not survive a reload — configure this for anything persisted.
   */
  uploadByFile?(file: File, ctx: UploadContext): Promise<UploadedAsset>;

  /**
   * Re-host an asset the user supplied by URL, and return the stored URL.
   * When absent for a kind, the URL is stored verbatim.
   */
  uploadByUrl?(url: string, ctx: UploadContext): Promise<UploadedAsset>;
}

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
  /**
   * Set when this upload is one of several renditions of the same asset.
   * `role: 'original'` is the untouched file the user picked.
   */
  variant?: { mimeType: string; role: 'original' | 'variant' };
}

/**
 * What Blok tells the host when it asks whether to upload a pasted URL
 * (see {@link BlokUploader.shouldUploadUrl}).
 */
export interface UrlUploadDecisionContext {
  /** Kind of asset the URL points to. */
  kind: AssetKind;
  /** Name of the block tool that asks, when known. */
  tool?: string;
  /** How the URL came in: an `<img>` in pasted HTML, or a bare pasted URL. */
  source: 'html' | 'url';
  /**
   * The pasted `<img>` carried the mark Blok puts on images it copies. Any web
   * page can write that mark into the clipboard, so treat it as a hint only.
   */
  copiedFromBlok: boolean;
}

/**
 * Describes a single deletion request.
 *
 * The same `kind`/`tool` pair {@link UploadContext} carries, so a host can
 * route a deletion to whichever pipeline stored the asset. There is no
 * progress callback: a deletion has nothing to report but its outcome.
 */
export interface DeleteContext {
  /** Kind of asset being deleted. */
  kind: AssetKind;
  /** Name of the block tool that owned the asset, when known. */
  tool?: string;
}

/**
 * Editor-level uploader, keyed by asset kind rather than by tool.
 *
 * Set on {@link BlokConfig.uploader}, it serves every media tool. A per-tool
 * `config.uploader` (e.g. `tools.image.config.uploader`) stays authoritative
 * for its own asset kind and takes precedence — this is the fallback for kinds
 * no tool-level uploader claims.
 *
 * Every method is optional and resolved independently: declaring only
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

  /**
   * Decide whether a pasted image URL is uploaded with `uploadByUrl` (`true`)
   * or kept as it is (`false`). Blok asks it for an `<img>` in pasted HTML and
   * for a bare pasted URL, and only when this same uploader has `uploadByUrl`.
   *
   * When absent, an image Blok copied is kept and any other pasted `<img>` is
   * uploaded. A throw or an answer that is not a boolean does the same.
   */
  shouldUploadUrl?(url: string, ctx: UrlUploadDecisionContext): boolean | Promise<boolean>;

  /**
   * Delete a stored asset by the URL this uploader returned for it.
   * When absent, nothing is ever deleted — assets an editing session
   * uploaded and then abandoned stay in the store forever. Rejecting is how
   * a host reports that the deletion did not happen.
   */
  delete?(url: string, ctx: DeleteContext): Promise<void>;
}

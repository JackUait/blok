import { AssetKind } from '../tools/block-tool';
import { UploadContext, UploadedAsset } from '../configs/uploader';

/**
 * Asset uploads, routed by the kind of asset rather than by the tool that asks.
 *
 * A tool calls this instead of reaching into its own `config.uploader` directly,
 * so an asset lands on the pipeline that owns its kind. The audio block's cover
 * art is the motivating case: it is an image, and asking for `kind: 'image'`
 * sends it to the image tool's uploader (or the editor-level one) rather than to
 * the host's audio endpoint, which would reject it.
 *
 * Resolution order for a kind: the tool whose static `assetKind` matches, then
 * {@link BlokConfig.uploader}, then a local fallback (`blob:` for files, the URL
 * verbatim for links). The fallbacks do not survive a reload.
 */
export interface Uploader {
  /**
   * Store a file and return its URL.
   * @param file - the file to store
   * @param ctx - the kind of asset, the requesting tool, and optional progress
   */
  uploadByFile(file: File, ctx: UploadContext): Promise<UploadedAsset>;

  /**
   * Re-host an asset supplied by URL and return the stored URL.
   * @param url - the URL the user supplied
   * @param ctx - the kind of asset, the requesting tool, and optional progress
   */
  uploadByUrl(url: string, ctx: UploadContext): Promise<UploadedAsset>;

  /**
   * Whether a host uploader handles this kind. False means the caller would get
   * the local fallback — useful for deciding whether an asset is worth
   * uploading at all (e.g. inlining small cover art as a `data:` URL instead).
   * @param kind - the kind of asset
   * @param method - narrow the check to one entry point
   */
  isConfigured(kind: AssetKind, method?: 'uploadByFile' | 'uploadByUrl'): boolean;
}

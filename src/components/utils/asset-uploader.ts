import type { AssetKind } from '@/types/tools/block-tool';
import type { BlokUploader, UploadContext, UploadedAsset } from '@/types/configs/uploader';

/**
 * Where uploaders can come from, in the order they are consulted.
 *
 * Routing is keyed on the ASSET KIND, not on the tool that asked. That is the
 * whole point: an audio block uploading cover art asks for `'image'` and lands
 * on the image pipeline, instead of posting a PNG to the host's audio endpoint.
 */
export interface AssetUploaderSources {
  /** Editor-level `config.uploader`. Serves any kind no tool claims. */
  editor?: BlokUploader;
  /**
   * Per-kind uploaders, keyed by the owning tool's static `assetKind` — i.e.
   * `tools.image.config.uploader` lands under `image`.
   */
  byKind: Partial<Record<AssetKind, BlokUploader>>;
}

/**
 * The slice of a block tool adapter this module reads. Declared structurally so
 * the collector stays testable without booting the Tools module.
 */
export interface AssetUploaderToolLike {
  /** The media kind the tool stores at `data.url`, or undefined for non-media tools. */
  assetKind?: AssetKind;
  /** The tool's resolved user config. */
  settings: { uploader?: BlokUploader };
}

/**
 * Build the source table from the registered block tools.
 *
 * Kinds are claimed by whichever tool declares `assetKind` first, so replacing
 * the stock image tool works while a later custom tool cannot silently take
 * over an existing kind's uploads.
 * @param blockTools - the registered block tool adapters
 * @param editorUploader - editor-level `config.uploader`
 */
export function collectAssetUploaderSources(
  blockTools: Iterable<AssetUploaderToolLike>,
  editorUploader?: BlokUploader
): AssetUploaderSources {
  const byKind: Partial<Record<AssetKind, BlokUploader>> = {};

  for (const tool of blockTools) {
    const kind = tool.assetKind;
    const uploader = tool.settings?.uploader;

    if (kind === undefined || uploader === undefined || byKind[kind] !== undefined) {
      continue;
    }

    byKind[kind] = uploader;
  }

  return {
    editor: editorUploader,
    byKind,
  };
}

/** The two upload entry points, resolved independently of each other. */
export type UploadMethod = 'uploadByFile' | 'uploadByUrl';

/**
 * Pick the uploader for an asset kind: the tool that owns the kind first, then
 * the editor-level one. Methods resolve independently, so a host may declare
 * `uploadByUrl` on the image tool and `uploadByFile` at editor level.
 *
 * Returned methods stay bound to the object that declared them, so a host
 * uploader written as an object literal with `this` keeps working.
 * @param kind - the kind of asset being uploaded
 * @param sources - candidate uploaders
 */
export function resolveAssetUploader(kind: AssetKind, sources: AssetUploaderSources): BlokUploader {
  const owner = sources.byKind[kind];
  const resolved: BlokUploader = {};

  // Per-method, not per-object: a host may put uploadByUrl on the image tool and
  // uploadByFile at editor level. `.call` keeps each method bound to whichever
  // object declared it, so an uploader written with `this` still works.
  const fileFrom = owner?.uploadByFile !== undefined ? owner : sources.editor;
  const uploadByFile = fileFrom?.uploadByFile;

  if (fileFrom !== undefined && uploadByFile !== undefined) {
    resolved.uploadByFile = (f, ctx) => uploadByFile.call(fileFrom, f, ctx);
  }

  const urlFrom = owner?.uploadByUrl !== undefined ? owner : sources.editor;
  const uploadByUrl = urlFrom?.uploadByUrl;

  if (urlFrom !== undefined && uploadByUrl !== undefined) {
    resolved.uploadByUrl = (u, ctx) => uploadByUrl.call(urlFrom, u, ctx);
  }

  return resolved;
}

/**
 * Whether a host uploader will handle this kind. False means the caller gets
 * the `blob:` / verbatim-URL fallback, which does not survive a reload.
 * @param kind - the kind of asset being uploaded
 * @param sources - candidate uploaders
 * @param method - narrow the check to one entry point
 */
export function hasAssetUploader(
  kind: AssetKind,
  sources: AssetUploaderSources,
  method?: UploadMethod
): boolean {
  const resolved = resolveAssetUploader(kind, sources);

  if (method) {
    return resolved[method] !== undefined;
  }

  return resolved.uploadByFile !== undefined || resolved.uploadByUrl !== undefined;
}

/**
 * Store a file through the uploader that owns its kind.
 *
 * With no uploader configured the file becomes an in-memory `blob:` URL — the
 * same fallback the media tools have always used, kept so the editor stays
 * usable with zero configuration.
 * @param file - the file to store
 * @param ctx - what is being uploaded and on whose behalf
 * @param sources - candidate uploaders
 */
export async function uploadAssetFile(
  file: File,
  ctx: UploadContext,
  sources: AssetUploaderSources
): Promise<UploadedAsset> {
  const upload = resolveAssetUploader(ctx.kind, sources).uploadByFile;

  if (upload) {
    return upload(file, ctx);
  }

  return {
    url: URL.createObjectURL(file),
    fileName: file.name,
  };
}

/**
 * Re-host an asset the user supplied by URL. Without an uploader the URL is
 * stored verbatim, which is why hosts under a strict `img-src` policy must
 * configure one.
 * @param url - the URL the user supplied
 * @param ctx - what is being uploaded and on whose behalf
 * @param sources - candidate uploaders
 */
export async function uploadAssetUrl(
  url: string,
  ctx: UploadContext,
  sources: AssetUploaderSources
): Promise<UploadedAsset> {
  const upload = resolveAssetUploader(ctx.kind, sources).uploadByUrl;

  if (upload) {
    return upload(url, ctx);
  }

  return { url };
}

import type { AssetKind } from '@/types/tools/block-tool';
import type { BlokUploader, UploadContext, UploadedAsset } from '@/types/configs/uploader';
import type { OrphanSweep } from './orphan-sweep';

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
  /**
   * This editor's orphan-sweep candidate set, when it saves through
   * `persistence`. Absent means nothing is recorded: without a save that
   * reports success there is no moment at which an asset is known abandoned.
   */
  sweep?: OrphanSweep;
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
  editorUploader?: BlokUploader,
  sweep?: OrphanSweep
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
    sweep,
    editor: editorUploader,
    byKind,
  };
}

/** The two upload entry points, resolved independently of each other. */
export type UploadMethod = 'uploadByFile' | 'uploadByUrl';

/**
 * Which uploader serves one entry point for a kind: the tool that owns the kind
 * when it declares that method, else the editor-level one.
 *
 * Per-method, not per-object: a host may put `uploadByUrl` on the image tool and
 * `uploadByFile` at editor level, so the two entry points can resolve to
 * different objects for the same kind.
 * @param kind - the kind of asset being uploaded
 * @param sources - candidate uploaders
 * @param method - the entry point being resolved
 */
function sourceFor(
  kind: AssetKind,
  sources: AssetUploaderSources,
  method: UploadMethod
): BlokUploader | undefined {
  const owner = sources.byKind[kind];

  return owner?.[method] !== undefined ? owner : sources.editor;
}

/**
 * Pick the upload entry points for an asset kind: the tool that owns the kind
 * first, then the editor-level one, resolved independently of each other.
 *
 * Returned methods stay bound to the object that declared them, so a host
 * uploader written as an object literal with `this` keeps working.
 *
 * `delete` is deliberately absent. A deletion belongs to the object that
 * actually STORED the asset, which is only known at the upload that stored it —
 * see {@link recordForSweep}.
 * @param kind - the kind of asset being uploaded
 * @param sources - candidate uploaders
 */
export function resolveAssetUploader(
  kind: AssetKind,
  sources: AssetUploaderSources
): Pick<BlokUploader, UploadMethod> {
  const resolved: Pick<BlokUploader, UploadMethod> = {};

  const fileFrom = sourceFor(kind, sources, 'uploadByFile');
  const uploadByFile = fileFrom?.uploadByFile;

  if (fileFrom !== undefined && uploadByFile !== undefined) {
    resolved.uploadByFile = (f, ctx) => uploadByFile.call(fileFrom, f, ctx);
  }

  const urlFrom = sourceFor(kind, sources, 'uploadByUrl');
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
 * Offer an asset this session just uploaded to the orphan sweep.
 *
 * The deletion is taken from the uploader that STORED the asset and from no
 * other: a different backend either 404s or, worse, deletes whatever that URL
 * names in ITS store. So an uploader without `delete` records nothing at all
 * rather than borrowing another one's — wasted storage is recoverable, a file
 * destroyed through the wrong backend is not. The `blob:` fallback stores
 * nothing to clean up either.
 * @param asset - what the uploader answered with
 * @param ctx - what was uploaded and on whose behalf
 * @param from - the uploader that stored this asset
 * @param sweep - this editor's candidate set, when it has one
 */
function recordForSweep(
  asset: UploadedAsset,
  ctx: UploadContext,
  from: BlokUploader,
  sweep?: OrphanSweep
): void {
  const deleteAsset = from.delete;

  if (deleteAsset === undefined || sweep === undefined) {
    return;
  }

  // `asset` is host output, unchecked at runtime: a JS uploader may resolve
  // `{ url: response.headers.get('Location') }` with the header absent. A
  // candidate with no url names nothing, so skip it rather than file it.
  if (typeof asset.url !== 'string' || asset.url === '') {
    return;
  }

  sweep.record(asset.url, (url) => deleteAsset.call(from, url, { kind: ctx.kind, tool: ctx.tool }));
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
  const from = sourceFor(ctx.kind, sources, 'uploadByFile');
  const upload = from?.uploadByFile;

  if (from !== undefined && upload !== undefined) {
    const asset = await upload.call(from, file, ctx);

    recordForSweep(asset, ctx, from, sources.sweep);

    return asset;
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
  const from = sourceFor(ctx.kind, sources, 'uploadByUrl');
  const upload = from?.uploadByUrl;

  if (from !== undefined && upload !== undefined) {
    const asset = await upload.call(from, url, ctx);

    // Handing the URL back unchanged means nothing was stored — a host that only
    // re-hosts files just validated the link. The sweep may only ever delete what
    // this session stored, or it would destroy a pasted URL another document
    // still points at.
    if (asset.url !== url) {
      recordForSweep(asset, ctx, from, sources.sweep);
    }

    return asset;
  }

  return { url };
}

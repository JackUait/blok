import type { Uploader } from '../../../types/api/uploader';
import { COVER_DATA_URL_CAP_BYTES } from './constants';

export interface RawPicture {
  data: Uint8Array;
  format?: string;
}
export interface RawTags {
  common?: { title?: string; artist?: string; picture?: RawPicture[] };
}
export interface TrackMeta {
  title?: string;
  artist?: string;
  cover?: { data: Uint8Array; mimeType: string };
}

export function mapMetadata(raw: RawTags): TrackMeta {
  const common = raw.common ?? {};
  const meta: TrackMeta = {};
  if (common.title) meta.title = common.title;
  if (common.artist) meta.artist = common.artist;
  const pic = common.picture?.[0];
  if (pic) meta.cover = { data: pic.data, mimeType: pic.format ?? 'image/jpeg' };
  return meta;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
}

/**
 * Filename for extracted artwork. Backends routinely derive the content type
 * and the storage key from the filename, so an extensionless `cover` is either
 * rejected or stored in a form browsers will not render.
 * @param mimeType - the artwork's MIME type, e.g. `image/jpeg`
 */
function coverFileName(mimeType: string): string {
  const subtype = mimeType.split('/')[1]?.split(';')[0];

  return subtype ? `cover.${subtype}` : 'cover';
}

/**
 * Turn artwork embedded in a track's tags into a URL the block can render.
 *
 * The artwork is an IMAGE, so it is uploaded as `kind: 'image'` — it must reach
 * the host's image pipeline, not the audio endpoint that accepted the track.
 * Rejections propagate: a swallowed failure here is indistinguishable from a
 * track that simply carries no artwork.
 * @param cover - the raw artwork extracted from the track's tags
 * @param uploader - the editor's asset uploader (`api.uploader`)
 * @param tool - name of the tool requesting the upload
 */
export async function resolveCover(
  cover: { data: Uint8Array; mimeType: string },
  uploader?: Pick<Uploader, 'uploadByFile' | 'isConfigured'>,
  tool?: string,
): Promise<string | undefined> {
  if (uploader?.isConfigured('image', 'uploadByFile')) {
    const file = new File([new Uint8Array(cover.data)], coverFileName(cover.mimeType), {
      type: cover.mimeType,
    });
    const res = await uploader.uploadByFile(file, { kind: 'image', tool });

    return res.url;
  }
  if (cover.data.byteLength <= COVER_DATA_URL_CAP_BYTES) {
    return `data:${cover.mimeType};base64,${toBase64(cover.data)}`;
  }

  return undefined;
}

export async function readTrackMetadata(file: File): Promise<TrackMeta> {
  try {
    const mm = await import('music-metadata');
    const buf = new Uint8Array(await file.arrayBuffer());
    // parseBuffer(uint8Array, fileInfo?: IFileInfo | string) — passing mimeType string is valid
    const parsed = await mm.parseBuffer(buf, file.type);
    return mapMetadata(parsed);
  } catch {
    return {};
  }
}

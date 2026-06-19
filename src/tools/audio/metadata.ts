import type { AudioUploader } from '../../../types/tools/audio';
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
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function resolveCover(
  cover: { data: Uint8Array; mimeType: string },
  uploader?: AudioUploader,
): Promise<string | undefined> {
  if (uploader?.uploadByFile) {
    const file = new File([cover.data], 'cover', { type: cover.mimeType });
    const res = await uploader.uploadByFile(file);
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
    return mapMetadata(parsed as RawTags);
  } catch {
    return {};
  }
}

import type { BlokUploader, UploadContext, UploadedAsset } from '../../../types/configs/uploader';
import type { AssetKind } from '../../../types/tools/block-tool';
import type { BookmarkMeta } from '../../../types/tools/bookmark';
import type { PageIcon } from '../../../types/tools/page';

export type UploaderService = Pick<BlokUploader, 'uploadByUrl'>;

/** A host's type and size limits for one asset kind, as a tool's `types` and `maxSize`. */
export interface UploadLimits {
  types?: string[];
  maxSize?: number;
}

/** The uploader a host gives an agent that may upload files. */
export interface FileUploaderService extends UploaderService {
  /** A file tool host may also report the stored size and type. */
  uploadByFile(file: File, ctx: UploadContext): Promise<UploadedAsset & { size?: number; mimeType?: string }>;
  /** Host values; anything left undefined keeps the tool's default. */
  limits?(kind: AssetKind): UploadLimits | undefined;
  /** Reads a file the host allows. Rejects past `maxBytes`. Absent: the agent sends bytes only. */
  readLocal?(path: string, maxBytes: number): Promise<{ bytes: Uint8Array<ArrayBuffer>; name: string }>;
  /** Decodes base64 the BASE64 check already passed, faster than the shared fallback. */
  decodeBase64?(data: string): Uint8Array<ArrayBuffer>;
}

export type LinkMetadataService = {
  fetch(url: string): Promise<BookmarkMeta>;
};

export type PageBackendService = {
  rename(input: { blockId: string; title: string }): Promise<unknown>;
  setIcon(input: { blockId: string; icon: PageIcon | null }): Promise<unknown>;
};

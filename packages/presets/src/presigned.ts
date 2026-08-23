import type { AssetKind } from '../../../types/tools/block-tool';
import type { BlokUploader, UploadContext, UploadedAsset } from '../../../types/configs/uploader';
import { uploadWithProgress } from './upload-xhr';

export interface SignRequest {
  fileName: string;
  mimeType: string;
  size: number;
  kind: AssetKind;
}

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

export function presignedStorage(options: PresignedStorageOptions): BlokUploader {
  return {
    async uploadByFile(file: File, ctx: UploadContext): Promise<UploadedAsset> {
      const target = await options.sign({
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        kind: ctx.kind,
      });

      const { status } = await uploadWithProgress({
        method: 'PUT',
        url: target.uploadUrl,
        body: file,
        // Content-Type is part of what the signature covers for most providers,
        // so it is set last and cannot be dropped by a caller's header map.
        headers: { ...target.headers, 'Content-Type': file.type || 'application/octet-stream' },
        onProgress: ctx.onProgress,
      });

      if (status < 200 || status > 299) {
        throw new Error(`Presigned upload failed with status ${status}`);
      }

      return { url: target.publicUrl, fileName: file.name };
    },

    // No uploadByUrl on purpose: re-hosting a remote URL needs a server-side
    // fetch. Leaving it undefined lets Blok apply its documented fallback
    // instead of pretending the file was re-hosted.
  };
}

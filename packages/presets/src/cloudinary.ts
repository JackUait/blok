import type { AssetKind } from '../../../types/tools/block-tool';
import type { BlokUploader, UploadContext, UploadedAsset } from '../../../types/configs/uploader';
import { uploadWithProgress } from '../../../src/components/utils/upload-xhr';

export interface CloudinaryStorageOptions {
  cloudName: string;
  /** An UNSIGNED upload preset — a signed one would need a server. */
  uploadPreset: string;
  folder?: string;
}

// Cloudinary picks the pipeline from the resource type in the path, so the
// asset kind must map onto it. Audio rides the video pipeline by their design.
const RESOURCE_TYPE: Record<AssetKind, string> = {
  image: 'image',
  video: 'video',
  audio: 'video',
  file: 'raw',
};

export function cloudinaryStorage(options: CloudinaryStorageOptions): BlokUploader {
  // `Record<AssetKind, string>` covers every kind the compiler knows about, so
  // this fallback only fires for a kind an untyped JS caller invented.
  const endpointFor = (kind: AssetKind): string =>
    `https://api.cloudinary.com/v1_1/${options.cloudName}/${RESOURCE_TYPE[kind] ?? 'raw'}/upload`;

  const send = async (kind: AssetKind, filePart: File | string, onProgress?: (percent: number) => void): Promise<UploadedAsset> => {
    const body = new FormData();

    body.append('file', filePart);
    body.append('upload_preset', options.uploadPreset);

    if (options.folder !== undefined) {
      body.append('folder', options.folder);
    }

    const { status, text } = await uploadWithProgress({ method: 'POST', url: endpointFor(kind), body, onProgress });

    return parseCloudinary(text, status, typeof filePart === 'string' ? undefined : filePart.name);
  };

  return {
    uploadByFile: (file: File, ctx: UploadContext) => send(ctx.kind, file, ctx.onProgress),

    // Real here, unlike the other presets: Cloudinary fetches the remote URL
    // itself, so re-hosting works without any server of the consumer's.
    uploadByUrl: (url: string, ctx: UploadContext) => send(ctx.kind, url, ctx.onProgress),
  };
}

function parseCloudinary(text: string, status: number, fileName?: string): UploadedAsset {
  const body = parseJson(text, status);

  if (typeof body.secure_url !== 'string') {
    const error = body.error as { message?: string } | undefined;

    // Cloudinary can answer 200 with an error body, so success is judged by
    // secure_url's presence, not the status code.
    throw new Error(`Cloudinary upload failed: ${error?.message ?? `status ${status}`}`);
  }

  return { url: body.secure_url, fileName };
}

function parseJson(text: string, status: number): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Cloudinary upload failed with status ${status}`);
  }
}

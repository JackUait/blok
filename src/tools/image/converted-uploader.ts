import type { API } from '../../../types';
import type { ImageConfig } from '../../../types/tools/image';

export type ConvertedUploadFn = (
  file: File,
  ctx?: { onProgress?: (percent: number) => void },
) => Promise<{ url: string; fileName?: string }>;

interface UploaderHolder { uploader?: { uploadByFile?: ConvertedUploadFn } }

function asUploaderHolder(value: unknown): UploaderHolder | undefined {
  return typeof value === 'object' && value !== null ? (value as UploaderHolder) : undefined;
}

/**
 * Resolve which `uploadByFile` to use for a converted WebM file:
 * the video tool's uploader (if registered under the `video` key), else the
 * image tool's own uploader, else undefined (caller uses a blob URL).
 */
export function resolveConvertedUploader(
  api: API,
  imageConfig: ImageConfig,
): ConvertedUploadFn | undefined {
  const videoEntry = asUploaderHolder(api.tools.getToolsConfig().tools?.video);
  // Tool settings carry the config under `.config`; support a flat shape too.
  const videoConfig = asUploaderHolder((videoEntry as { config?: unknown })?.config) ?? videoEntry;
  const videoUpload = videoConfig?.uploader?.uploadByFile;

  return videoUpload ?? imageConfig.uploader?.uploadByFile;
}

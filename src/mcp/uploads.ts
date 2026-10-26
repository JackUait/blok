import type { AssetKind } from '../../types/tools/block-tool';
import type { FileUploaderService } from '../shared/tool-actions/services';

import { createLocalFileReader } from './local-files';
import type { McpUploads } from './options';

/** The `uploader` service a session passes to `<tool>.uploadFile`. */
export const createUploaderService = (uploads: McpUploads): FileUploaderService => {
  const { uploader } = uploads;
  const uploadByUrl = uploader.uploadByUrl;

  return {
    uploadByFile: (file, ctx) => uploader.uploadByFile(file, ctx),
    ...(uploadByUrl !== undefined && { uploadByUrl: (url, ctx) => uploadByUrl.call(uploader, url, ctx) }),
    limits: (kind: AssetKind) => uploads.limits?.[kind],
    ...(uploads.root !== undefined && { readLocal: createLocalFileReader(uploads.root) }),
  };
};

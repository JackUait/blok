import type { AssetKind } from '../../types/tools/block-tool';
import { failure, type AgentFailure } from '../shared/agent/errors';
import type { FileUploaderService } from '../shared/tool-actions/services';
import { UPLOAD_FAILED } from '../shared/tool-actions/upload';

import { createLocalFileReader } from './local-files';
import type { McpUploads } from './options';

/**
 * The agent sees only a message the host wrote for it (`agentMessage`), else a generic one: a
 * thrown message may name hosts, paths or credentials. The full error goes to stderr.
 */
const hostFailure = (error: unknown): AgentFailure => {
  console.error('blok-mcp: the host uploader failed', error);
  const agentMessage: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'agentMessage') : undefined;

  return failure('TOOL_ACTION_FAILED', typeof agentMessage === 'string' && agentMessage.trim() !== '' ? agentMessage : UPLOAD_FAILED);
};

const guarded = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    throw hostFailure(error);
  }
};

/** The `uploader` service a session passes to `<tool>.uploadFile`. */
export const createUploaderService = (uploads: McpUploads): FileUploaderService => {
  const { uploader } = uploads;
  const uploadByUrl = uploader.uploadByUrl;

  return {
    uploadByFile: (file, ctx) => guarded(() => uploader.uploadByFile(file, ctx)),
    ...(uploadByUrl !== undefined && { uploadByUrl: (url, ctx) => guarded(() => uploadByUrl.call(uploader, url, ctx)) }),
    limits: (kind: AssetKind) => uploads.limits?.[kind],
    // Native decoding: the shared one goes a character at a time and would hold the event loop.
    decodeBase64: data => {
      const decoded = Buffer.from(data, 'base64');

      return new Uint8Array(decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength));
    },
    ...(uploads.root !== undefined && { readLocal: createLocalFileReader(uploads.root) }),
  };
};

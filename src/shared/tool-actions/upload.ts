import type { BlockPosition } from '../../../types/api/blocks';
import type { AssetKind } from '../../../types/tools/block-tool';
import type { ToolActionImpl } from '../../../types/tools/tool-description';
import { plainLine } from '../agent/plain-line';
import { failure } from '../agent/errors';
import { matchesMime } from '../mime-match';

import type { FileUploaderService, UploadLimits } from './services';

interface UploadArgs {
  data?: string;
  path?: string;
  fileName?: string;
  mimeType?: string;
  parentId?: string | null;
  position?: BlockPosition;
}

interface Uploaded {
  url: string;
  fileName: string;
  mimeType: string;
  size?: number;
  hostMimeType?: string;
}

// LOCKSTEP with DEFAULT_MIME_TYPES / DEFAULT_MAX_SIZE in src/tools/<kind>/constants.ts (shared may not import tools).
// The file tool takes every type when `types` is unset.
const MIB = 1024 * 1024;

export const DEFAULT_UPLOAD_LIMITS: Readonly<Record<AssetKind, Required<Pick<UploadLimits, 'maxSize'>> & UploadLimits>> = {
  image: { types: ['image/*'], maxSize: 30 * MIB },
  audio: { types: ['audio/*'], maxSize: 30 * MIB },
  video: { types: ['video/*'], maxSize: 100 * MIB },
  file: { maxSize: 30 * MIB },
};

// What a browser puts in File.type for a picked file of this extension. Unknown is '', as there.
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', m4a: 'audio/mp4',
  aac: 'audio/aac', flac: 'audio/flac', weba: 'audio/webm',
  mp4: 'video/mp4', m4v: 'video/x-m4v', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mkv: 'video/x-matroska',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  html: 'text/html', htm: 'text/html', xml: 'application/xml', rtf: 'application/rtf', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const PLACEHOLDER = 'blok-upload-pending';

const isFileUploader = (value: unknown): value is FileUploaderService =>
  typeof value === 'object' && value !== null && 'uploadByFile' in value && typeof value.uploadByFile === 'function';

const noUploader = (): never => {
  throw failure('COMMAND_UNAVAILABLE', 'This host has no file uploader, so the agent cannot upload files here. Use <tool>.setSource with an http(s) URL.', {
    details: { reason: 'host', requires: ['uploader'] },
  });
};

const invalid = (message: string, path: string): never => {
  throw failure('INVALID_ARGS', message, { path });
};

const refused = (message: string): never => {
  throw failure('PRECONDITION_FAILED', message);
};

/** The last path segment as one plain line, so a name cannot carry a path or fake text. */
const cleanName = (raw: string): string => {
  const base = raw.split(/[\\/]/).pop() ?? '';

  return plainLine(base) ?? invalid('fileName is empty once cleaned.', '/fileName');
};

const mimeOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');

  return dot < 0 ? '' : MIME_BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()] ?? '';
};

const checkArgs = (args: UploadArgs): void => {
  if ((args.data === undefined) === (args.path === undefined)) {
    invalid('Pass exactly one of data (base64 bytes) and path (a file the host may read).', '');
  }
  if (args.data !== undefined && args.fileName === undefined) {
    invalid('Pass fileName with data: its extension sets the file type.', '/fileName');
  }
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const SEXTET = new Map(Array.from(ALPHABET, (char, index) => [char, index]));

// The fallback where the host gives no decoder: Jint has no atob. `data` is already checked against BASE64.
const fromBase64 = (data: string): Uint8Array<ArrayBuffer> => {
  const body = data.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor(body.length * 3 / 4));
  const state = { bits: 0, count: 0, at: 0 };

  for (const char of body) {
    state.bits = ((state.bits << 6) | (SEXTET.get(char) ?? 0)) & 0xffff;
    state.count += 6;
    if (state.count >= 8) {
      state.count -= 8;
      bytes[state.at] = (state.bits >> state.count) & 0xff;
      state.at += 1;
    }
  }

  return bytes;
};

const decode = (data: string, maxSize: number, fast?: (data: string) => Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
  // From the length alone, before decoding: four characters carry at most three bytes.
  if (data.length > Math.ceil(maxSize / 3) * 4) {
    refused(`The file is too large: this host takes at most ${maxSize} bytes.`);
  }
  if (data.length % 4 !== 0 || !BASE64.test(data)) {
    invalid('data must be standard base64 (A-Z a-z 0-9 + /, padded with =).', '/data');
  }
  return fast?.(data) ?? fromBase64(data);
};

const isByteCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isTypeList = (value: unknown): value is string[] => Array.isArray(value) && value.every(type => typeof type === 'string');

/** The host's limits over the tool's defaults, as a person's pick reads `config.types ?? DEFAULT`. A garbled value refuses. */
const limitsFor = (kind: AssetKind, given: unknown): UploadLimits & { maxSize: number } => {
  const fallback = DEFAULT_UPLOAD_LIMITS[kind];

  if (given === undefined) {
    return fallback;
  }
  if (typeof given !== 'object' || given === null) {
    return refused('This host\'s upload limits are not readable, so nothing is uploaded.');
  }
  const types: unknown = Reflect.get(given, 'types');
  const maxSize: unknown = Reflect.get(given, 'maxSize');

  if (types !== undefined && !isTypeList(types)) {
    return refused('This host\'s upload types are not a list of MIME types, so nothing is uploaded.');
  }
  if (maxSize !== undefined && !isByteCount(maxSize)) {
    return refused('This host\'s upload size limit is not a whole number of bytes, so nothing is uploaded.');
  }
  const kept = isTypeList(types) ? types : fallback.types;

  return { ...(kept !== undefined && { types: [...kept] }), maxSize: isByteCount(maxSize) ? maxSize : fallback.maxSize };
};

const checkType = (kind: AssetKind, mimeType: string, limits: UploadLimits): void => {
  const types = limits.types;
  // The file tool compares its list exactly (src/tools/file/uploader.ts validateFile).
  const allowed = types === undefined || (kind === 'file' ? types.includes(mimeType) : matchesMime(mimeType, types));

  if (!allowed) {
    refused(`This host does not take ${mimeType === '' ? 'files of unknown type' : mimeType} for ${kind}. It takes: ${types?.join(', ')}.`);
  }
};

/**
 * Sends one file to the host's uploader, checked against the same type and size limits as a
 * person's pick, then inserts the block that pick would leave.
 */
const uploadFile = (kind: AssetKind, delta: (uploaded: Uploaded) => Record<string, unknown>): ToolActionImpl<UploadArgs, Uploaded, { id: string; childIds: string[] }> => ({
  prepare: async ({ services }, args) => {
    checkArgs(args);
    const uploader = services.uploader;

    if (!isFileUploader(uploader)) {
      return noUploader();
    }
    const limits = limitsFor(kind, uploader.limits?.(kind));
    const local = args.path === undefined ? null : await (async () => {
      if (uploader.readLocal === undefined) {
        throw failure('COMMAND_UNAVAILABLE', 'This host reads no local files. Send the bytes as base64 data with a fileName.', {
          path: '/path', details: { reason: 'host' },
        });
      }

      return uploader.readLocal(args.path ?? '', limits.maxSize);
    })();
    const fileName = cleanName(args.fileName ?? local?.name ?? '');
    const mimeType = mimeOf(fileName);

    // A read file is typed by its own name, or a fileName could pass any file as an image.
    if (local !== null && mimeOf(cleanName(local.name)) !== mimeType) {
      invalid(`fileName "${fileName}" is not the same type as the file "${local.name}".`, '/fileName');
    }
    if (args.mimeType !== undefined && args.mimeType.toLowerCase() !== mimeType) {
      invalid(`mimeType "${args.mimeType}" does not match the file name "${fileName}" (${mimeType === '' ? 'unknown type' : mimeType}).`, '/mimeType');
    }
    checkType(kind, mimeType, limits);
    const bytes = local?.bytes ?? decode(args.data ?? '', limits.maxSize, uploader.decodeBase64);

    if (bytes.byteLength > limits.maxSize) {
      refused(`The file is too large: ${bytes.byteLength} bytes, and this host takes at most ${limits.maxSize}.`);
    }
    const asset = await uploader.uploadByFile(new File([bytes], fileName, { type: mimeType }), { kind, tool: kind });

    return {
      url: asset.url,
      fileName: asset.fileName ?? fileName,
      mimeType,
      ...(typeof asset.size === 'number' && { size: asset.size }),
      ...(typeof asset.mimeType === 'string' && { hostMimeType: asset.mimeType }),
    };
  },
  run: (ctx, args, prepared) => {
    checkArgs(args);
    // Planned once before the upload with a stand-in source, so a bad place refuses before any upload.
    if (prepared !== undefined && (typeof prepared.url !== 'string' || prepared.url.trim() === '')) {
      ctx.fail('PRECONDITION_FAILED', 'The host\'s uploader answered without a URL, so the block would show an empty placeholder.');
    }
    const data = prepared === undefined ? { url: PLACEHOLDER } : delta(prepared);

    return {
      id: ctx.insert({ type: ctx.tool, data, parentId: args.parentId, position: args.position }),
      childIds: [],
    };
  },
});

// Each delta is that tool's resultDelta after a picked file's upload.
export const UPLOAD_FILE_HANDLERS = {
  image: uploadFile('image', ({ url, fileName }) => ({ url, fileName })),
  video: uploadFile('video', ({ url, fileName, mimeType }) => ({ url, fileName, ...(mimeType !== '' && { mimeType }) })),
  audio: uploadFile('audio', ({ url, fileName, mimeType }) => ({ url, fileName, ...(mimeType !== '' && { mimeType }) })),
  file: uploadFile('file', ({ url, fileName, size, hostMimeType }) => ({
    url, fileName, ...(size !== undefined && { size }), ...(hostMimeType !== undefined && { mimeType: hostMimeType }),
  })),
} as const;

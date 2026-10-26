import type { AssetKind } from '../../../types/tools/block-tool';
import type { ToolActionImpl } from '../../../types/tools/tool-description';
import type { UploaderService } from './services';
import { UPLOAD_FILE_HANDLERS } from './upload';

const isHttp = (url: string): boolean => /^https?:\/\//i.test(url);

const HTTP_ONLY = 'Pass an http(s) URL.';

interface Source {
  url: string;
  fileName?: string;
}

const hasUploadByUrl = (value: unknown): value is Required<UploaderService> =>
  typeof value === 'object' && value !== null && 'uploadByUrl' in value && typeof value.uploadByUrl === 'function';

// Image and video keep renditions in `variants`; a new source makes them stale (image/index.ts writeEnteredUrl).
const HAS_VARIANTS = new Set(['image', 'video']);

const rehost = (kind: AssetKind, tool: string, field: 'url' | 'coverUrl'): ToolActionImpl<{ url: string }, Source, undefined> => ({
  prepare: async ({ services }, args) => {
    if (!isHttp(args.url)) {
      throw new TypeError(HTTP_ONLY);
    }
    if (!hasUploadByUrl(services.uploader)) {
      return { url: args.url };
    }
    const asset = await services.uploader.uploadByUrl(args.url, { kind, tool });

    return field === 'url' && asset.fileName !== undefined ? { url: asset.url, fileName: asset.fileName } : { url: asset.url };
  },
  run: (ctx, args, prepared) => {
    if (!isHttp(args.url)) {
      ctx.fail('INVALID_ARGS', HTTP_ONLY);
    }
    const block = ctx.block ?? ctx.fail('INVALID_ARGS', `Pass the id of a ${tool} block.`);
    const source = prepared ?? { url: args.url };

    ctx.update(block.id, field === 'url'
      ? { ...source, ...(HAS_VARIANTS.has(tool) ? { variants: undefined } : {}) }
      : { coverUrl: source.url });

    return undefined;
  },
});

/**
 * A rejectWrite for a block whose blank source renders its empty upload or link state. Only a
 * write that sets the field is checked, so edits to a block a person left empty still work.
 * A non-http value is allowed: a host uploader may return a relative URL.
 */
export const requireSource = (field: string, how: string) =>
  (data: Record<string, unknown>, written: readonly string[]): string | undefined => {
    const value = data[field];

    return !written.includes(field) || (typeof value === 'string' && value.trim() !== '')
      ? undefined
      : `"${field}" is blank, which shows an empty placeholder. ${how}`;
  };

const setWithUrl = (tool: string): string => `Insert the ${tool} with url set, or replace it with ${tool}.setSource.`;

export const MEDIA_REJECT_WRITE = {
  image: requireSource('url', setWithUrl('image')),
  video: requireSource('url', setWithUrl('video')),
  audio: requireSource('url', setWithUrl('audio')),
  file: requireSource('url', setWithUrl('file')),
} as const;

export const MEDIA_ACTION_HANDLERS = {
  image: { setSource: rehost('image', 'image', 'url'), uploadFile: UPLOAD_FILE_HANDLERS.image },
  video: { setSource: rehost('video', 'video', 'url'), uploadFile: UPLOAD_FILE_HANDLERS.video },
  audio: { setSource: rehost('audio', 'audio', 'url'), setCover: rehost('image', 'audio', 'coverUrl'), uploadFile: UPLOAD_FILE_HANDLERS.audio },
  file: { setSource: rehost('file', 'file', 'url'), uploadFile: UPLOAD_FILE_HANDLERS.file },
} as const;

import { EMBED_SERVICES, matchEmbedService } from '../embed-registry';

import { requireSource } from './media';

import type { EmbedMatch } from '../embed-registry';
import type { BlockPosition } from '../../../types/api/blocks';
import type { BookmarkMeta } from '../../../types/tools/bookmark';
import type { ToolActionImpl } from '../../../types/tools/tool-description';
import type { LinkMetadataService } from './services';

// The embed tool's fallback frame size (src/tools/link/embed/index.ts DEFAULT_WIDTH / DEFAULT_HEIGHT).
const DEFAULT_WIDTH = 580;
const DEFAULT_HEIGHT = 320;

const NO_PROVIDER = 'No embed provider matches this URL. Use a bookmark (bookmark.create) or a link in text instead.';

const providerFields = (match: EmbedMatch): Record<string, unknown> => ({
  service: match.service,
  embed: match.embedUrl,
  kind: match.kind,
});

const setUrl: ToolActionImpl<{ url: string }> = {
  run: (ctx, args) => {
    const block = ctx.block ?? ctx.fail('INVALID_ARGS', 'Pass the id of an embed block.');
    const match = matchEmbedService(args.url) ?? ctx.fail('PRECONDITION_FAILED', NO_PROVIDER);
    const config = EMBED_SERVICES[match.service];

    ctx.update(block.id, {
      ...providerFields(match),
      source: args.url,
      width: config?.width ?? DEFAULT_WIDTH,
      height: config?.height ?? DEFAULT_HEIGHT,
    });

    return undefined;
  },
};

interface CreateArgs {
  url: string;
  parentId?: string | null;
  position?: BlockPosition;
}

const createEmbed: ToolActionImpl<CreateArgs, undefined, { id: string; childIds: string[] }> = {
  run: (ctx, args) => {
    const match = matchEmbedService(args.url) ?? ctx.fail('PRECONDITION_FAILED', NO_PROVIDER);
    const config = EMBED_SERVICES[match.service];
    const data = {
      ...providerFields(match),
      source: args.url,
      width: config?.width ?? DEFAULT_WIDTH,
      height: config?.height ?? DEFAULT_HEIGHT,
    };

    // The host's registry key, not 'embed'.
    return { id: ctx.insert({ type: ctx.tool, data, parentId: args.parentId, position: args.position }), childIds: [] };
  },
};

const sourceOf = (data: Record<string, unknown>): string => typeof data.source === 'string' ? data.source : '';

/** Agent writes only: a source the registry knows decides service, embed and kind. */
export const normalizeEmbed = (data: Record<string, unknown>): Record<string, unknown> => {
  const match = matchEmbedService(sourceOf(data));

  return match === null ? data : { ...data, ...providerFields(match) };
};

const URL_FIELDS = ['service', 'source', 'embed'];

/**
 * The editor renders registry data whose source does not match as the empty "Paste a link" state
 * (src/tools/link/embed/index.ts resolveEmbedRender). Only a write that sets a URL field is checked,
 * so edits to an embed a person left empty still work.
 */
export const rejectEmbedWrite = (data: Record<string, unknown>, written: readonly string[]): string | undefined => {
  const source = sourceOf(data);

  if (!written.some(field => URL_FIELDS.includes(field)) || matchEmbedService(source) !== null) {
    return undefined;
  }
  const service = typeof data.service === 'string' ? data.service : '';

  // An unknown service with an http source still renders, as a link card or a host-allowed frame.
  return Object.hasOwn(EMBED_SERVICES, service) || !/^https?:\/\//i.test(source)
    ? `Embed source ${JSON.stringify(source)}: ${NO_PROVIDER} Create one with embed.create, or change its URL with embed.setUrl.`
    : undefined;
};

const PREVIEW_FIELDS = ['title', 'description', 'image', 'favicon', 'domain'] as const;

const hasFetch = (value: unknown): value is LinkMetadataService =>
  typeof value === 'object' && value !== null && 'fetch' in value && typeof value.fetch === 'function';

// Host endpoints return arbitrary JSON; keep only the card's string fields so the block stays valid.
const previewOf = (meta: unknown): Partial<BookmarkMeta> => typeof meta === 'object' && meta !== null
  ? Object.fromEntries(PREVIEW_FIELDS.flatMap((key): Array<[string, string]> => {
    const value: unknown = Reflect.get(meta, key);

    return typeof value === 'string' ? [[key, value]] : [];
  }))
  : {};

const create: ToolActionImpl<CreateArgs, BookmarkMeta, { id: string; childIds: string[] }> = {
  prepare: async ({ services }, args) => {
    if (!hasFetch(services.linkMetadata)) {
      return { url: args.url };
    }
    try {
      return { ...previewOf(await services.linkMetadata.fetch(args.url)), url: args.url };
    } catch {
      // Many sites serve no preview; the card then shows the plain link, as in the editor.
      return { url: args.url };
    }
  },
  run: (ctx, args, prepared) => ({
    // The host's registry key, not 'bookmark'.
    id: ctx.insert({ type: ctx.tool, data: { ...(prepared ?? { url: args.url }) }, parentId: args.parentId, position: args.position }),
    childIds: [],
  }),
};

export const rejectBookmarkWrite = requireSource('url', 'Create one with bookmark.create, or insert it with url set.');

export const LINK_ACTION_HANDLERS = { embed: { setUrl, create: createEmbed }, bookmark: { create } } as const;

import { EMBED_SERVICES, matchEmbedService } from '../embed-registry';

import type { BlockPosition } from '../../../types/api/blocks';
import type { BookmarkMeta } from '../../../types/tools/bookmark';
import type { ToolActionImpl } from '../../../types/tools/tool-description';
import type { LinkMetadataService } from './services';

// The embed tool's fallback frame size (src/tools/link/embed/index.ts DEFAULT_WIDTH / DEFAULT_HEIGHT).
const DEFAULT_WIDTH = 580;
const DEFAULT_HEIGHT = 320;

const setUrl: ToolActionImpl<{ url: string }> = {
  run: (ctx, args) => {
    const block = ctx.block ?? ctx.fail('INVALID_ARGS', 'Pass the id of an embed block.');
    const match = matchEmbedService(args.url)
      ?? ctx.fail('PRECONDITION_FAILED', 'No embed provider matches this URL. Use a bookmark (bookmark.create) or a link in text instead.');
    const config = EMBED_SERVICES[match.service];

    ctx.update(block.id, {
      service: match.service,
      source: args.url,
      embed: match.embedUrl,
      kind: match.kind,
      width: config?.width ?? DEFAULT_WIDTH,
      height: config?.height ?? DEFAULT_HEIGHT,
    });

    return undefined;
  },
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

interface CreateArgs {
  url: string;
  parentId?: string | null;
  position?: BlockPosition;
}

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

export const LINK_ACTION_HANDLERS = { embed: { setUrl }, bookmark: { create } } as const;

import { buildDocumentView, findBlocks } from './document-view';

import type { PlanState } from './plan-state';

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

export const planRead = (state: PlanState, args: Record<string, unknown>): unknown => {
  const rootId = args.rootId === undefined || args.rootId === null ? null : state.resolveId(args.rootId, '/rootId');
  const ids: string[] | undefined = (() => {
    if (args.ids === undefined) {
      return undefined;
    }
    if (!isArray(args.ids)) {
      state.fail('INVALID_ARGS', 'Expected an array of block ids.', '/ids');
    }

    return args.ids.map((id, index) => state.resolveId(id, `/ids/${index}`));
  })();
  const { depth, detail, limit, cursor, textLimit } = args;

  if (depth !== undefined && typeof depth !== 'number') {
    state.fail('INVALID_ARGS', 'Expected a numeric depth.', '/depth');
  }
  if (detail !== undefined && detail !== 'outline' && detail !== 'full') {
    state.fail('INVALID_ARGS', 'Expected outline or full detail.', '/detail');
  }
  if (limit !== undefined && typeof limit !== 'number') {
    state.fail('INVALID_ARGS', 'Expected a numeric limit.', '/limit');
  }
  if (cursor !== undefined && typeof cursor !== 'string') {
    state.fail('INVALID_ARGS', 'Expected a cursor string.', '/cursor');
  }
  if (textLimit !== undefined && typeof textLimit !== 'number') {
    state.fail('INVALID_ARGS', 'Expected a numeric text limit.', '/textLimit');
  }

  return buildDocumentView(state.draft, {
    rootId,
    ...(ids !== undefined && { ids }),
    ...(depth !== undefined && { depth }),
    ...(detail !== undefined && { detail }),
    ...(limit !== undefined && { limit }),
    ...(cursor !== undefined && { cursor }),
    ...(textLimit !== undefined && { textLimit }),
  }, state.ctx, '');
};

export const planFind = (state: PlanState, args: Record<string, unknown>): unknown => {
  const rootId = args.rootId === undefined ? undefined : state.resolveId(args.rootId, '/rootId');
  const { text, type, limit } = args;

  if (text !== undefined && typeof text !== 'string') {
    state.fail('INVALID_ARGS', 'Expected search text.', '/text');
  }
  if (type !== undefined && typeof type !== 'string') {
    state.fail('INVALID_ARGS', 'Expected a block type.', '/type');
  }
  if (limit !== undefined && typeof limit !== 'number') {
    state.fail('INVALID_ARGS', 'Expected a numeric limit.', '/limit');
  }

  return findBlocks(state.draft, {
    ...(rootId !== undefined && { rootId }),
    ...(text !== undefined && { text }),
    ...(type !== undefined && { type }),
    ...(limit !== undefined && { limit }),
  }, state.ctx);
};

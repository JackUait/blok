import { isRichText } from '../rich-text/guards';
import { failure } from './errors';

import type { DocumentView, ViewArgs, ViewBlock } from '../../../types/agent';
import type { DocSnapshot, SnapBlock } from './snapshot';
import type { PlannerContext } from './types';

type ViewContext = Pick<PlannerContext, 'tools' | 'richText'>;

const textOf = (block: SnapBlock, ctx: ViewContext, field?: string): string | undefined => {
  const name = field ?? ctx.tools.get(block.type)?.entry.richTextFields[0];
  const value = name === undefined ? undefined : block.data[name];

  return isRichText(value) ? ctx.richText.plainText(value) : undefined;
};

const viewBlock = (
  snap: DocSnapshot,
  block: SnapBlock,
  depth: number,
  args: ViewArgs,
  ctx: ViewContext
): ViewBlock => {
  const tool = ctx.tools.get(block.type);
  const text = tool === undefined ? undefined : textOf(block, ctx);
  const textLimit = args.textLimit ?? 120;
  const attrs = Object.fromEntries((tool?.entry.summaryFields ?? [])
    .filter(key => block.data[key] !== undefined)
    .map((key): [string, unknown] => [key, block.data[key]]));
  const cell = snap.cellOf(block.id);
  const entry: ViewBlock = { id: block.id, type: block.type, depth };

  if (block.parent !== null) {
    entry.parentId = block.parent;
  }
  if (text !== undefined && text !== '') {
    entry.text = text.length > textLimit ? `${text.slice(0, textLimit)}…` : text;
    if (text.length > textLimit) {
      entry.truncated = true;
    }
  }
  if (Object.keys(attrs).length > 0) {
    entry.attrs = attrs;
  }
  if (args.depth !== undefined && depth === args.depth && block.content.length > 0) {
    entry.childCount = block.content.length;
  }
  if (tool === undefined) {
    entry.opaque = true;
  }
  if (cell !== null && cell.tableId === block.parent) {
    entry.cell = { row: cell.row, col: cell.col };
  }
  if (args.ids !== undefined || args.detail === 'full') {
    entry.data = block.data;
    if (block.tunes !== undefined) {
      entry.tunes = block.tunes;
    }
  }

  return entry;
};

export const buildDocumentView = (
  source: DocSnapshot,
  args: ViewArgs,
  ctx: ViewContext,
  revision: string
): DocumentView => {
  // Later commands mutate the live draft in place.
  const snap = source.clone();
  const rootId = args.rootId ?? null;

  if (rootId !== null && !snap.has(rootId)) {
    throw failure('BLOCK_NOT_FOUND', `Block "${rootId}" does not exist.`, { path: '/rootId', details: { id: rootId } });
  }
  args.ids?.forEach((id, index) => {
    if (!snap.has(id)) {
      throw failure('BLOCK_NOT_FOUND', `Block "${id}" does not exist.`, { path: `/ids/${index}`, details: { id } });
    }
  });

  const ids = args.ids === undefined ? undefined : new Set(args.ids);
  const order = snap.readingOrder(rootId).filter(item =>
    (ids === undefined || ids.has(item.id)) && (args.depth === undefined || item.depth <= args.depth));
  const start = args.cursor === undefined ? 0 : order.findIndex(item => `c:${item.id}` === args.cursor);

  if (start < 0) {
    throw failure('INVALID_ARGS', 'The cursor is no longer valid: the document changed. Re-read from the start.', { path: '/cursor' });
  }

  const limit = args.limit ?? 200;
  const next = order[start + limit];
  const blocks = order.slice(start, start + limit).map(({ id, depth }) => {
    const block = snap.get(id);

    if (block === undefined) {
      throw failure('BLOCK_NOT_FOUND', `Block "${id}" does not exist.`, { details: { id } });
    }

    return viewBlock(snap, block, depth, args, ctx);
  });

  return {
    revision,
    rootId,
    ...((snap.title !== undefined || snap.icon !== undefined) && {
      page: { ...(snap.title !== undefined && { title: snap.title }), ...(snap.icon !== undefined && { icon: snap.icon }) },
    }),
    blocks,
    ...(next !== undefined && { next: `c:${next.id}` }),
  };
};

export const findBlocks = (
  snap: DocSnapshot,
  args: { text?: string; type?: string; rootId?: string; limit?: number },
  ctx: ViewContext
): { matches: Array<{ id: string; type: string; snippet: string }> } => {
  if (args.text === undefined && args.type === undefined) {
    throw failure('INVALID_ARGS', 'Give text, type, or both.');
  }
  if (args.rootId !== undefined && !snap.has(args.rootId)) {
    throw failure('BLOCK_NOT_FOUND', `Block "${args.rootId}" does not exist.`, { path: '/rootId', details: { id: args.rootId } });
  }

  const needle = args.text?.toLowerCase();
  const matches: Array<{ id: string; type: string; snippet: string }> = [];

  for (const { id } of snap.readingOrder(args.rootId ?? null)) {
    const block = snap.get(id);

    if (block === undefined) {
      throw failure('BLOCK_NOT_FOUND', `Block "${id}" does not exist.`, { details: { id } });
    }
    if (args.type !== undefined && block.type !== args.type) {
      continue;
    }

    const text = (ctx.tools.get(block.type)?.entry.richTextFields ?? [])
      .map(field => textOf(block, ctx, field) ?? '').join(' ');
    const at = needle === undefined ? 0 : text.toLowerCase().indexOf(needle);

    if (at < 0) {
      continue;
    }
    matches.push({
      id, type: block.type,
      snippet: text.slice(Math.max(0, at - 20), at + (needle?.length ?? 0) + 20),
    });
    if (matches.length >= (args.limit ?? 20)) {
      break;
    }
  }

  return { matches };
};

import { isRichText } from '../rich-text/guards';
import { findTextMatches } from '../text-match';
import { failure } from './errors';

import type { DocumentView, ViewArgs, ViewBlock } from '../../../types/agent';
import type { DocSnapshot, SnapBlock } from './snapshot';
import type { PlannerContext } from './types';

type ViewContext = Pick<PlannerContext, 'tools' | 'richText'>;

const textOf = (block: SnapBlock, ctx: ViewContext, field?: string): string | undefined => {
  const entry = ctx.tools.get(block.type)?.entry;
  const name = field ?? entry?.richTextFields[0];
  const value = name === undefined ? undefined : block.data[name];

  if (isRichText(value)) {
    return ctx.richText.plainText(value);
  }

  // A tool with no rich text (code) still declares its text field for conversion.
  const exported = field === undefined && entry?.richTextFields.length === 0 && entry.conversion.export !== undefined
    ? block.data[entry.conversion.export]
    : undefined;

  return typeof exported === 'string' ? exported : undefined;
};

/** Not page content (a comment thread), or under one: reads leave it out. */
const inAnnotation = (snap: DocSnapshot, id: string, ctx: ViewContext): boolean => {
  const seen = new Set<string>();
  const cursor: { id: string | null } = { id };

  while (cursor.id !== null && !seen.has(cursor.id)) {
    const type = snap.get(cursor.id)?.type;

    if (type !== undefined && ctx.tools.get(type)?.entry.children.annotation === true) {
      return true;
    }
    seen.add(cursor.id);
    cursor.id = snap.parentOf(cursor.id);
  }

  return false;
};

const contentOrder = (snap: DocSnapshot, rootId: string | null, ctx: ViewContext): Array<{ id: string; depth: number }> =>
  snap.readingOrder(rootId).filter(item => !inAnnotation(snap, item.id, ctx));

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
  const children = block.content.filter(id => !inAnnotation(snap, id, ctx));

  if (args.depth !== undefined && depth === args.depth && children.length > 0) {
    entry.childCount = children.length;
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
  const order = contentOrder(snap, rootId, ctx).filter(item =>
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

/** Rows for the given ids with their data, as a read of those ids gives them; at most `limit` of them. */
export const viewRows = (
  snap: DocSnapshot,
  ids: ReadonlySet<string>,
  ctx: ViewContext,
  limit: number
): { rows: ViewBlock[]; more: number } => {
  const order = contentOrder(snap, null, ctx).filter(item => ids.has(item.id));
  const rows = order.slice(0, limit).flatMap(({ id, depth }) => {
    const block = snap.get(id);

    return block === undefined ? [] : [viewBlock(snap, block, depth, { detail: 'full' }, ctx)];
  });

  return { rows, more: Math.max(0, order.length - limit) };
};

/** One doc.find hit. No id: the document title. `edit` names the command for a field text.replace cannot change. */
export interface FindHit {
  id?: string;
  type?: string;
  field?: string;
  edit?: 'block.update' | 'doc.setTitle';
  start?: number;
  end?: number;
  snippet?: string;
}

const SNIPPET_CONTEXT = 20;

export const findBlocks = (
  snap: DocSnapshot,
  args: { text?: string; type?: string; rootId?: string; limit?: number; matchCase?: boolean; wholeWord?: boolean },
  ctx: ViewContext
): { count: number; matches: FindHit[] } => {
  if (args.text === undefined && args.type === undefined) {
    throw failure('INVALID_ARGS', 'Give text, type, or both.');
  }
  if (args.rootId !== undefined && !snap.has(args.rootId)) {
    throw failure('BLOCK_NOT_FOUND', `Block "${args.rootId}" does not exist.`, { path: '/rootId', details: { id: args.rootId } });
  }

  const query = args.text;
  const options = { matchCase: args.matchCase === true, wholeWord: args.wholeWord === true, keepEdgeSpaces: true };
  const hitsIn = (text: string, hit: FindHit): FindHit[] => query === undefined
    ? []
    : findTextMatches(text, query, options).map(({ start, end }) => ({
      ...hit, start, end, snippet: text.slice(Math.max(0, start - SNIPPET_CONTEXT), end + SNIPPET_CONTEXT),
    }));
  // The find bar searches the page title too; a subtree has none.
  const title = args.rootId === undefined && args.type === undefined && snap.title !== undefined
    ? hitsIn(snap.title, { field: 'title', edit: 'doc.setTitle' })
    : [];
  const blocks = contentOrder(snap, args.rootId ?? null, ctx).map(({ id }) => {
    const block = snap.get(id);

    if (block === undefined) {
      throw failure('BLOCK_NOT_FOUND', `Block "${id}" does not exist.`, { details: { id } });
    }

    return block;
  }).filter(block => args.type === undefined || block.type === args.type).flatMap((block): FindHit[] => {
    const id = block.id;

    if (query === undefined) {
      return [{ id, type: block.type }];
    }

    const entry = ctx.tools.get(block.type)?.entry;
    const rich = (entry?.richTextFields ?? []).flatMap(field =>
      hitsIn(textOf(block, ctx, field) ?? '', { id, type: block.type, field }));
    const plain = (entry?.findFields ?? []).flatMap(field => {
      const value = block.data[field];

      return typeof value === 'string' ? hitsIn(value, { id, type: block.type, field, edit: 'block.update' }) : [];
    });

    return [...rich, ...plain];
  });
  const matches = [...title, ...blocks];

  return { count: matches.length, matches: matches.slice(0, args.limit ?? 20) };
};

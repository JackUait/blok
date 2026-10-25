import { createComputedReader } from '../database/computed-read';
import { isRichText } from '../rich-text/guards';
import { findTextMatches } from '../text-match';
import { LOAD_DEFAULT_FILLS } from '../tool-actions/load-defaults';
import { failure } from './errors';

import type { DocumentView, ViewArgs, ViewBlock } from '../../../types/agent';
import type { DocSnapshot, SnapBlock } from './snapshot';
import type { PlannerContext } from './types';

type ViewContext = Pick<PlannerContext, 'tools' | 'richText'>;
type ComputedFor = ReturnType<typeof createComputedReader>;

const computedReader = (snap: DocSnapshot): ComputedFor => createComputedReader(id => snap.get(id));

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

/** The comment thread the block is, or sits under; undefined for page content. */
export const annotationOf = (
  snap: DocSnapshot,
  id: string,
  isAnnotation: (type: string) => boolean
): SnapBlock | undefined => {
  const seen = new Set<string>();
  const cursor: { id: string | null } = { id };

  while (cursor.id !== null && !seen.has(cursor.id)) {
    const block = snap.get(cursor.id);

    if (block !== undefined && isAnnotation(block.type)) {
      return block;
    }
    seen.add(cursor.id);
    cursor.id = snap.parentOf(cursor.id);
  }

  return undefined;
};

/** Agents skip comment threads (user decision 2026-10-16), so naming one fails, but not as a missing block. */
export const annotationMessage = (id: string, thread: SnapBlock): string =>
  `${thread.id === id ? `Block "${id}" is a ${thread.type} block` : `Block "${id}" is inside ${thread.type} block "${thread.id}"`}, a comment people left. Agents do not read or write comments.`;

const isAnnotationIn = (ctx: ViewContext) => (type: string): boolean => ctx.tools.get(type)?.entry.children.annotation === true;

/** Not page content (a comment thread), or under one: reads leave it out. */
const inAnnotation = (snap: DocSnapshot, id: string, ctx: ViewContext): boolean =>
  annotationOf(snap, id, isAnnotationIn(ctx)) !== undefined;

/** Fails when the id is not there, or is a comment thread or under one. */
const requireContent = (snap: DocSnapshot, id: string, ctx: ViewContext, path: string): void => {
  if (!snap.has(id)) {
    throw failure('BLOCK_NOT_FOUND', `Block "${id}" does not exist.`, { path, details: { id } });
  }
  const thread = annotationOf(snap, id, isAnnotationIn(ctx));

  if (thread !== undefined) {
    throw failure('ANNOTATION_BLOCK', annotationMessage(id, thread), { path, details: { id } });
  }
};

const contentOrder = (snap: DocSnapshot, rootId: string | null, ctx: ViewContext): Array<{ id: string; depth: number }> =>
  snap.readingOrder(rootId).filter(item => !inAnnotation(snap, item.id, ctx));

const viewBlock = (
  snap: DocSnapshot,
  block: SnapBlock,
  depth: number,
  args: ViewArgs,
  ctx: ViewContext,
  computedFor: ComputedFor
): ViewBlock => {
  const tool = ctx.tools.get(block.type);
  const text = tool === undefined ? undefined : textOf(block, ctx);
  const textLimit = args.textLimit ?? 120;
  // A stored block can lack defaults the editor fills on load; show it as the editor would. A copy: reads never write.
  const fill = tool?.runtime.normalize;
  const data = fill !== undefined && LOAD_DEFAULT_FILLS.has(fill) ? fill(block.data) : block.data;
  const attrs = Object.fromEntries((tool?.entry.summaryFields ?? [])
    .filter(key => data[key] !== undefined)
    .map((key): [string, unknown] => [key, data[key]]));
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
    entry.data = data;
    if (block.tunes !== undefined) {
      entry.tunes = block.tunes;
    }
    const computed = computedFor(block.id, block.parent);

    if (computed !== undefined) {
      entry.computed = computed;
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

  if (rootId !== null) {
    requireContent(snap, rootId, ctx, '/rootId');
  }
  args.ids?.forEach((id, index) => requireContent(snap, id, ctx, `/ids/${index}`));

  const ids = args.ids === undefined ? undefined : new Set(args.ids);
  const order = contentOrder(snap, rootId, ctx).filter(item =>
    (ids === undefined || ids.has(item.id)) && (args.depth === undefined || item.depth <= args.depth));
  const start = args.cursor === undefined ? 0 : order.findIndex(item => `c:${item.id}` === args.cursor);

  if (start < 0) {
    throw failure('INVALID_ARGS', 'The cursor is no longer valid: the document changed. Re-read from the start.', { path: '/cursor' });
  }

  const limit = args.limit ?? 200;
  const next = order[start + limit];
  const computedFor = computedReader(snap);
  const blocks = order.slice(start, start + limit).map(({ id, depth }) => {
    const block = snap.get(id);

    if (block === undefined) {
      throw failure('BLOCK_NOT_FOUND', `Block "${id}" does not exist.`, { details: { id } });
    }

    return viewBlock(snap, block, depth, args, ctx, computedFor);
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
  const computedFor = computedReader(snap);
  const rows = order.slice(0, limit).flatMap(({ id, depth }) => {
    const block = snap.get(id);

    return block === undefined ? [] : [viewBlock(snap, block, depth, { detail: 'full' }, ctx, computedFor)];
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
  if (args.rootId !== undefined) {
    requireContent(snap, args.rootId, ctx, '/rootId');
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

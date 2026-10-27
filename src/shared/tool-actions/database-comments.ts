import { databaseTarget, readDatabase, rowsOf } from './database';

import type { ToolActionContext } from '../../../types/tools/tool-description';
import type { AnnotationActionImpl } from '../agent/tool-action-context';

const COMMENT = 'database-comment';

type Comment = { id: string; data: Record<string, unknown>; children: readonly string[]; thread: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (ctx: ToolActionContext, text: unknown): string => {
  const trimmed = typeof text === 'string' ? text.trim() : '';

  return trimmed === '' ? ctx.fail('INVALID_ARGS', 'A comment needs some text.') : trimmed;
};

const nowOf = (ctx: ToolActionContext): number => ctx.now ?? Date.now();

const requireRow = (ctx: ToolActionContext, databaseId: string, rowId: unknown): void => {
  if (!rowsOf(ctx, databaseId).some(row => row.id === rowId)) {
    ctx.fail('PRECONDITION_FAILED', `Block ${String(rowId)} is not a row of this database.`);
  }
};

/**
 * A thread sits straight under a row of this database; a reply sits under a thread.
 * A resolved thread is out of reach: the panel hides it, with no way to reopen it.
 */
const commentOf = (ctx: ToolActionContext, databaseId: string, id: string): Comment => {
  const block = ctx.read(id);

  if (block === null || block.type !== COMMENT) {
    return ctx.fail('PRECONDITION_FAILED', `Block ${id} is not a comment. Comment ids are in a full read of the row, under comments.`);
  }
  const parent = block.parentId === null ? null : ctx.read(block.parentId);
  const thread = parent?.type !== COMMENT;
  const rowId = thread ? block.parentId : parent.parentId;

  if (!rowsOf(ctx, databaseId).some(row => row.id === rowId)) {
    ctx.fail('PRECONDITION_FAILED', `Comment ${id} is not on a row of this database.`);
  }
  const threadData = thread ? block.data : parent.data;

  if (isRecord(threadData) && threadData.resolved === true) {
    ctx.fail('PRECONDITION_FAILED', `Comment ${id} is in a resolved thread. People no longer see it, and nothing can reopen it.`);
  }

  return { id, data: isRecord(block.data) ? block.data : {}, children: block.children, thread };
};

const requireThread = (ctx: ToolActionContext, databaseId: string, id: string): Comment => {
  const comment = commentOf(ctx, databaseId, id);

  return comment.thread ? comment : ctx.fail('PRECONDITION_FAILED', `Comment ${id} is a reply. Name its thread instead.`);
};

/**
 * As the comment panel's isOwn: the person the agent acts for wrote it. An
 * anonymous comment is no one's, so an agent never claims one.
 */
const requireOwn = (ctx: ToolActionContext, comment: Comment): void => {
  const author = comment.data.authorId;

  if (typeof author !== 'string' || author === '' || author !== ctx.actorId) {
    ctx.fail('PRECONDITION_FAILED', `Comment ${comment.id} was written by someone else. You can edit or delete only your own comments.`);
  }
};

/** The person the agent acts for; without one the comment is anonymous, as a person with no name writes it. */
const authorOf = (ctx: ToolActionContext): { authorId?: string } =>
  (ctx.actorId === undefined || ctx.actorId === '' ? {} : { authorId: ctx.actorId });

const insertComment = (ctx: ToolActionContext, parentId: string, text: string, propertyId?: string): { commentId: string } => ({
  commentId: ctx.insert({
    type: COMMENT,
    parentId,
    position: 'end',
    data: { text, createdAt: nowOf(ctx), ...authorOf(ctx), ...(propertyId === undefined ? {} : { propertyId }) },
  }),
});

const addComment: AnnotationActionImpl<{ rowId: string; text: string; propertyId?: string }, { commentId: string }> = {
  reachesAnnotations: true,
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    const text = textOf(ctx, args.text);

    requireRow(ctx, block.id, args.rowId);
    if (args.propertyId !== undefined && !readDatabase(block).schema.some(property => property.id === args.propertyId)) {
      ctx.fail('PRECONDITION_FAILED', `This database has no property ${args.propertyId}.`);
    }

    return insertComment(ctx, args.rowId, text, args.propertyId);
  },
};

const replyToComment: AnnotationActionImpl<{ threadId: string; text: string }, { commentId: string }> = {
  reachesAnnotations: true,
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    const text = textOf(ctx, args.text);

    requireThread(ctx, block.id, args.threadId);

    return insertComment(ctx, args.threadId, text);
  },
};

const editComment: AnnotationActionImpl<{ commentId: string; text: string }, void> = {
  reachesAnnotations: true,
  run: (ctx, args) => {
    const comment = commentOf(ctx, databaseTarget(ctx).id, args.commentId);
    const text = textOf(ctx, args.text);

    requireOwn(ctx, comment);
    // The panel saves nothing when the text did not change.
    if (text !== comment.data.text) {
      ctx.update(comment.id, { text, editedAt: nowOf(ctx) });
    }
  },
};

const resolveComment: AnnotationActionImpl<{ threadId: string }, void> = {
  reachesAnnotations: true,
  run: (ctx, args) => {
    const thread = requireThread(ctx, databaseTarget(ctx).id, args.threadId);

    ctx.update(thread.id, { resolved: true });
  },
};

const subtreeOf = (ctx: ToolActionContext, id: string): string[] =>
  [id, ...(ctx.read(id)?.children ?? []).flatMap(child => subtreeOf(ctx, child))];

const deleteComment: AnnotationActionImpl<{ commentId: string }, { removedIds: string[] }> = {
  reachesAnnotations: true,
  run: (ctx, args) => {
    const comment = commentOf(ctx, databaseTarget(ctx).id, args.commentId);

    requireOwn(ctx, comment);
    const removedIds = subtreeOf(ctx, comment.id);

    // As the panel: deleting a thread deletes the replies in it, whoever wrote them.
    ctx.remove(comment.id, { withChildren: true });

    return { removedIds };
  },
};

export const DATABASE_COMMENT_HANDLERS: Readonly<Record<string, AnnotationActionImpl>> = {
  addComment, replyToComment, editComment, resolveComment, deleteComment,
};

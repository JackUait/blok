import type { API } from '../../../types';
import type { DatabaseCommentData } from '../database-comment/types';

const COMMENT_TOOL = 'database-comment';

/** One comment as the thread UI reads it. */
export interface StoredComment {
  id: string;
  data: DatabaseCommentData;
}

/** A thread: its first comment and the replies under it. */
export interface StoredThread extends StoredComment {
  replies: StoredComment[];
}

/** Who writes a new comment: the host's current user, else the collaboration name, else nobody (shown as Anonymous). */
export interface CommentAuthor {
  authorId?: string;
  authorName?: string;
}

type CommentApi = Pick<API, 'blocks' | 'tools'>;

const readComment = (api: CommentApi, id: string): DatabaseCommentData | undefined => {
  const block = api.blocks.getById(id);
  const box: { data?: DatabaseCommentData } = {};

  if (block?.name !== COMMENT_TOOL) return undefined;
  block.call('readData', { receive: (data: DatabaseCommentData) => { box.data = data; } });

  return box.data;
};

const commentsUnder = (api: CommentApi, parentId: string): StoredComment[] =>
  api.blocks.getChildren(parentId).flatMap((child) => {
    const data = child.name === COMMENT_TOOL ? readComment(api, child.id) : undefined;

    return data === undefined ? [] : [{ id: child.id, data }];
  });

/**
 * Built-in comments: thread blocks under each row (design 18, option A).
 * Writes skip document undo, like the layout tabs do: comments are not page edits.
 */
export class BuiltInComments {
  private readonly api: CommentApi;
  private readonly author: () => CommentAuthor;
  private readonly now: () => number;

  constructor(api: CommentApi, author: () => CommentAuthor, now: () => number = Date.now) {
    this.api = api;
    this.author = author;
    this.now = now;
  }

  /** The host registered the comment tool and the editor can write without capture. */
  public available(): boolean {
    return this.api.blocks.transactWithoutCapture !== undefined
      && this.api.tools.getBlockTools().some((tool) => tool.name === COMMENT_TOOL);
  }

  public threads(rowId: string): StoredThread[] {
    return commentsUnder(this.api, rowId).map((thread) => ({ ...thread, replies: commentsUnder(this.api, thread.id) }));
  }

  /** What a badge shows: the comments in threads that are still open. */
  public count(rowId: string): number {
    return this.threads(rowId)
      .filter((thread) => thread.data.resolved !== true)
      .reduce((sum, thread) => sum + 1 + thread.replies.length, 0);
  }

  /** Starts a thread on the row, or on one of its cells. Returns its id. */
  public add(rowId: string, text: string, propertyId?: string): string | undefined {
    return this.insert(rowId, text, propertyId);
  }

  public reply(threadId: string, text: string): string | undefined {
    return this.insert(threadId, text, undefined);
  }

  public edit(id: string, text: string): void {
    const trimmed = text.trim();
    const data = readComment(this.api, id);

    if (data === undefined || trimmed === '' || trimmed === data.text) return;
    this.change(id, { text: trimmed, editedAt: this.now() });
  }

  public resolve(threadId: string, resolved: boolean): void {
    const data = readComment(this.api, threadId);

    if (data === undefined || (data.resolved === true) === resolved) return;
    this.change(threadId, { resolved });
  }

  /** Deletes one comment; deleting the first comment of a thread deletes the thread. */
  public remove(id: string): void {
    const index = this.api.blocks.getBlockIndex(id);

    if (index === undefined || readComment(this.api, id) === undefined) return;
    this.write(() => {
      void this.api.blocks.delete(index, false);
    });
  }

  private insert(parentId: string, text: string, propertyId: string | undefined): string | undefined {
    const trimmed = text.trim();

    if (trimmed === '' || this.api.blocks.getById(parentId) === null) return undefined;
    const data: DatabaseCommentData = {
      text: trimmed,
      createdAt: this.now(),
      ...this.author(),
      ...(propertyId === undefined ? {} : { propertyId }),
    };
    const box: { id?: string } = {};

    this.write(() => {
      box.id = this.api.blocks.insertAt(COMMENT_TOOL, data, { parentId, position: 'end' }).id;
    });

    return box.id;
  }

  /** The tool takes the change and saves it as derived data: no undo step, redo kept. */
  private change(id: string, param: { text?: string; editedAt?: number; resolved?: boolean }): void {
    const block = this.api.blocks.getById(id);

    if (block === null) return;
    block.call('updateComment', param);
    block.dispatchChange({ derived: true });
  }

  private write(fn: () => void): void {
    this.api.blocks.transactWithoutCapture?.(fn);
  }
}

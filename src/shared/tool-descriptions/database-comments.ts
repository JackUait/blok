import type { BlokSchema, ToolActionDeclaration } from '../../../types/tools/tool-description';

/** Long enough for any real comment; the cap keeps one command from growing a row without end. */
export const COMMENT_TEXT_MAX = 10000;

const closed = (properties: Record<string, unknown>, required: string[]): BlokSchema => ({
  type: 'object', required, additionalProperties: false, properties,
});

const TEXT = { type: 'string', minLength: 1, maxLength: COMMENT_TEXT_MAX, description: 'Plain text, not Markdown or HTML. Trimmed.' };
const ROW_ID = { type: 'string', minLength: 1, description: 'Id of a database-row child block.' };
const THREAD_ID = { type: 'string', minLength: 1, description: 'Id of a thread: a comment straight under a row, from the row\'s comments in a full read.' };
const COMMENT_ID = { type: 'string', minLength: 1, description: 'Id of a thread or a reply, from the row\'s comments in a full read.' };
const NEW_COMMENT = closed({ commentId: { type: 'string' } }, ['commentId']);
const OWN_ONLY = 'Only comments marked own: the person you act for wrote them. Anyone else\'s, or an anonymous one, fails with PRECONDITION_FAILED, as the comment menu shows only on your own.';
const MIRRORS = ['ui-file:src/tools/database/database-comments-panel.ts'];

/** The row comment panel's actions (database-comments-panel.ts), each on a database's own rows. */
export const DATABASE_COMMENT_ACTIONS: ToolActionDeclaration[] = [
  {
    name: 'addComment',
    summary: 'Start a comment thread on a row, or on one of its cells with propertyId. You write it for the person you act for.',
    guidance: 'Comments are not page content: a full read of the row lists them under comments. A database with host comments, or where the person may not comment, refuses it.',
    target: 'block',
    args: closed({ rowId: ROW_ID, text: TEXT, propertyId: { type: 'string', minLength: 1, description: 'Id of a property in schema.' } }, ['rowId', 'text']),
    result: NEW_COMMENT,
    mirrors: MIRRORS,
  },
  {
    name: 'replyToComment',
    summary: 'Reply in a thread. Anyone\'s thread takes a reply; a reply takes none.',
    target: 'block',
    args: closed({ threadId: THREAD_ID, text: TEXT }, ['threadId', 'text']),
    result: NEW_COMMENT,
    mirrors: MIRRORS,
  },
  {
    name: 'editComment',
    summary: 'Change the text of a comment, which then shows as edited.',
    guidance: OWN_ONLY,
    target: 'block',
    args: closed({ commentId: COMMENT_ID, text: TEXT }, ['commentId', 'text']),
    mirrors: MIRRORS,
  },
  {
    name: 'resolveComment',
    summary: 'Resolve a thread (resolved true) or reopen it (false). Anyone\'s thread, as its resolve button does.',
    target: 'block',
    args: closed({ threadId: THREAD_ID, resolved: { type: 'boolean' } }, ['threadId', 'resolved']),
    mirrors: MIRRORS,
  },
  {
    name: 'deleteComment',
    summary: 'Delete a reply, or a thread with every reply in it.',
    guidance: OWN_ONLY,
    target: 'block',
    args: closed({ commentId: COMMENT_ID }, ['commentId']),
    result: closed({ removedIds: { type: 'array', items: { type: 'string' } } }, ['removedIds']),
    mirrors: MIRRORS,
  },
];

import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const DATABASE_COMMENT_DATA = {
  type: 'object',
  description: 'One comment on a database row. A thread is a comment under the row; its replies are its children. Not page content: views and exports skip it.',
  required: ['text', 'createdAt'],
  additionalProperties: false,
  properties: {
    text: { type: 'string', description: 'Plain text, not HTML.' },
    createdAt: { type: 'number', description: 'Epoch ms when it was written.' },
    authorId: { type: 'string', description: 'The writer, as the host knows people. Absent without a host directory.' },
    authorName: { type: 'string', description: 'The writer\'s display name when it was written. Absent for an anonymous writer.' },
    propertyId: { type: 'string', description: 'Set on a thread about one cell: that property\'s id.' },
    editedAt: { type: 'number', description: 'Epoch ms of the last edit.' },
    resolved: { type: 'boolean', description: 'Set on a resolved thread.' },
  },
};

export const describeDatabaseComment = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A comment on a database row, kept out of the row\'s page content.',
  guidance: 'Not written with block.* commands. A full read of a row lists its threads under comments; write them with database.addComment, replyToComment, editComment, resolveComment and deleteComment.',
  data: DATABASE_COMMENT_DATA,
  inputFields: [],
});

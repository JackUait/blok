import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const DATABASE_ROW_DATA = {
  type: 'object',
  description: 'One row of a database block. Optional pageId points to a separate body document.',
  required: ['properties', 'position'],
  additionalProperties: false,
  properties: {
    properties: {
      type: 'object',
      description: 'Column values keyed by property id. Values follow the parent database\'s schema, so the shape is open.',
      additionalProperties: true,
    },
    position: { type: 'string', description: 'Fractional-index sort key.' },
    title: {
      type: 'string',
      description: 'Row title, mirrored from the title column. Absent on rows written before this key existed.',
    },
    pageId: { type: 'string', minLength: 1, description: 'Id of the separate document that holds the row page body.' },
    bodyBlocks: {
      type: 'boolean',
      description: 'True once the page body lives in the row\'s child blocks. A legacy body blob in a richText property is then ignored.',
    },
    icon: { type: 'string', description: 'The row page icon, an emoji.' },
    cover: { type: 'string', description: 'The row page cover, an image URL.' },
    convertedValues: {
      type: 'object',
      description: 'Values a property type change could not carry over, keyed by property id; restored if the type changes back.',
      additionalProperties: {
        type: 'object',
        required: ['type', 'value'],
        additionalProperties: false,
        properties: { type: { type: 'string' }, value: { description: 'The value as the old type stored it.' } },
      },
    },
  },
};

export const describeDatabaseRow = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'One row of a database. Its child blocks are its page body. An optional pageId points to a separate body document instead.',
  guidance: 'Write row values with database.setRowValues on the parent database: the title mirrors the title property.',
  data: DATABASE_ROW_DATA,
  summaryFields: ['title'],
});

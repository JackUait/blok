import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const TABLE_DATA = {
  type: 'object',
  description: 'A grid whose cells reference child blocks by id; the referenced blocks are siblings in `blocks` carrying `parent` = the table id.',
  required: ['withHeadings', 'withHeadingColumn', 'content'],
  additionalProperties: false,
  properties: {
    withHeadings: { type: 'boolean', description: 'First row is a heading row.' },
    withHeadingColumn: { type: 'boolean', description: 'First column is a heading column.' },
    stretched: { type: 'boolean', description: 'Table spans the full editor width.' },
    content: {
      type: 'array',
      description: 'Rows of cells.',
      items: {
        type: 'array',
        items: {
          anyOf: [
            { type: 'string', description: 'Legacy plain-text cell, still accepted on load.' },
            {
              type: 'object',
              required: ['blocks'],
              additionalProperties: false,
              properties: {
                blocks: { type: 'array', items: { type: 'string' }, description: 'Ids of the blocks rendered in this cell, in order.' },
                id: { type: 'string', description: 'Column id. Every cell of one column carries the same value.' },
                rowId: { type: 'string', description: 'Row id. Every cell of one row carries the same value.' },
                text: { type: 'string', description: 'Inline HTML mirror of the cell, kept for import/export paths.' },
                color: { type: 'string', description: 'Cell background color preset name.' },
                textColor: { type: 'string' },
                placement: {
                  type: 'string',
                  enum: [
                    'top-left', 'top-center', 'top-right',
                    'middle-left', 'middle-center', 'middle-right',
                    'bottom-left', 'bottom-center', 'bottom-right',
                  ],
                },
                colspan: { type: 'integer', minimum: 1, description: 'Only set on a merge origin.' },
                rowspan: { type: 'integer', minimum: 1, description: 'Only set on a merge origin.' },
                mergedInto: {
                  type: 'array',
                  description: '[row, col] of the merge origin covering this cell.',
                  items: { type: 'integer' },
                  minItems: 2,
                  maxItems: 2,
                },
              },
            },
          ],
        },
      },
    },
    colWidths: { type: 'array', items: { type: 'number' }, description: 'Column widths in pixels. Omit for equal widths.' },
    initialColWidth: { type: 'number', description: 'Per-column width in pixels captured at creation.' },
    textSize: { type: 'string', enum: ['compact', 'comfortable'], description: 'Omitted means "compact".' },
  },
};

export const describeTable = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A grid. Each cell holds child blocks; content maps cells to those block ids.',
  guidance: 'Create tables with table.create, never block.insert. Change rows, columns, merges and cell styles with the table.* actions; content cannot be written directly. To edit text in a cell, edit the cell\'s child block.',
  data: TABLE_DATA,
  summaryFields: ['withHeadings', 'withHeadingColumn'],
  guardedFields: { content: 'table.*' },
});

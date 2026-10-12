import { richText } from './rich-text';

import type { BlokSchema, BlockToolDescription, ToolActionDeclaration } from '../../../types/tools/tool-description';

const RICH_CELLS = { type: 'array', items: { type: 'array', items: richText('Text of one cell.') } };

export const RANGE_ARGS: BlokSchema = {
  type: 'object',
  description: 'Inclusive cell range, zero-based.',
  required: ['fromRow', 'fromCol', 'toRow', 'toCol'],
  additionalProperties: false,
  properties: {
    fromRow: { type: 'integer', minimum: 0 },
    fromCol: { type: 'integer', minimum: 0 },
    toRow: { type: 'integer', minimum: 0 },
    toCol: { type: 'integer', minimum: 0 },
  },
};

const PLACEMENTS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

const LINE_ARGS: BlokSchema = {
  type: 'object',
  required: ['at'],
  additionalProperties: false,
  properties: {
    at: { type: 'integer', minimum: 0 },
    count: { type: 'integer', minimum: 1, default: 1 },
  },
};

const MOVE_ARGS: BlokSchema = {
  type: 'object',
  required: ['from', 'to'],
  additionalProperties: false,
  properties: {
    from: { type: 'integer', minimum: 0 },
    to: { type: 'integer', minimum: 0, description: 'Index the moved line ends up at.' },
  },
};

export const TABLE_ACTIONS: ToolActionDeclaration[] = [
  {
    name: 'create',
    summary: 'Create a table with rows x cols cells, each holding one paragraph.',
    target: 'create',
    args: {
      type: 'object',
      required: ['rows', 'cols'],
      additionalProperties: false,
      properties: {
        rows: { type: 'integer', minimum: 1 },
        cols: { type: 'integer', minimum: 1 },
        withHeadings: { type: 'boolean' },
        withHeadingColumn: { type: 'boolean' },
        cells: { ...RICH_CELLS, description: 'Optional starting text, row by row.' },
      },
    },
    result: {
      type: 'object',
      required: ['id', 'childIds'],
      properties: {
        id: { type: 'string' },
        childIds: { type: 'array', items: { type: 'string' } },
      },
    },
    mirrors: [],
  },
  {
    name: 'insertRows',
    summary: 'Insert empty rows before row at (use the row count to append).',
    target: 'block',
    args: {
      type: 'object',
      required: ['at'],
      additionalProperties: false,
      properties: {
        at: { type: 'integer', minimum: 0 },
        count: { type: 'integer', minimum: 1, default: 1 },
        cells: { ...RICH_CELLS, description: 'Optional text for the new rows, row by row.' },
      },
    },
    result: {
      type: 'object',
      required: ['childIds'],
      properties: { childIds: { type: 'array', items: { type: 'string' } } },
    },
    mirrors: ['menu:table/table-insert-row-above', 'menu:table/table-insert-row-below', 'action:table/insert-row-above', 'action:table/insert-row-below'],
  },
  {
    name: 'insertColumns',
    summary: 'Insert empty columns before column at (use the column count to append).',
    target: 'block',
    args: {
      type: 'object',
      required: ['at'],
      additionalProperties: false,
      properties: {
        at: { type: 'integer', minimum: 0 },
        count: { type: 'integer', minimum: 1, default: 1 },
        cells: { ...RICH_CELLS, description: 'Optional text for the new columns, column by column.' },
      },
    },
    result: {
      type: 'object',
      required: ['childIds'],
      properties: { childIds: { type: 'array', items: { type: 'string' } } },
    },
    mirrors: ['menu:table/table-insert-column-left', 'menu:table/table-insert-column-right', 'action:table/insert-col-left', 'action:table/insert-col-right'],
  },
  {
    name: 'deleteRows',
    summary: 'Delete rows and the blocks in their cells.',
    target: 'block',
    preconditions: ['At least one row must remain.'],
    args: LINE_ARGS,
    mirrors: ['menu:table/table-delete-row', 'action:table/delete-row'],
  },
  {
    name: 'deleteColumns',
    summary: 'Delete columns and the blocks in their cells.',
    target: 'block',
    preconditions: ['At least one column must remain.'],
    args: LINE_ARGS,
    mirrors: ['menu:table/table-delete-column', 'action:table/delete-col'],
  },
  {
    name: 'moveRow',
    summary: 'Move one row to another index.',
    target: 'block',
    preconditions: ['The row is not part of a merge and does not land inside one.'],
    args: MOVE_ARGS,
    mirrors: ['action:table/move-row'],
  },
  {
    name: 'moveColumn',
    summary: 'Move one column to another index.',
    target: 'block',
    preconditions: ['The column is not part of a merge and does not land inside one.'],
    args: MOVE_ARGS,
    mirrors: ['action:table/move-col'],
  },
  {
    name: 'duplicateRows',
    summary: 'Copy rows, with their blocks, colours and placement, right after the copied range.',
    target: 'block',
    args: LINE_ARGS,
    mirrors: ['menu:table/table-duplicate-*', 'action:table/duplicate-row'],
  },
  {
    name: 'duplicateColumns',
    summary: 'Copy columns, with their blocks, colours, placement and width, right after the copied range.',
    target: 'block',
    args: LINE_ARGS,
    mirrors: ['menu:table/table-duplicate-*', 'action:table/duplicate-col'],
  },
  {
    name: 'clearCells',
    summary: 'Empty the cells in a range; each keeps one empty paragraph.',
    target: 'block',
    args: { type: 'object', required: ['range'], additionalProperties: false, properties: { range: RANGE_ARGS } },
    mirrors: ['menu:table/table-clear-*', 'menu:table/table-clear-selection'],
  },
  {
    name: 'styleCells',
    summary: 'Set or clear background colour, text colour and placement on a range of cells.',
    guidance: 'Colours take a preset name (gray, brown, orange, yellow, green, blue, purple, pink, red) or a CSS colour. null clears. Covered cells of a merge are skipped.',
    target: 'block',
    args: {
      type: 'object',
      required: ['range'],
      additionalProperties: false,
      properties: {
        range: RANGE_ARGS,
        color: { type: ['string', 'null'], description: 'Background colour.' },
        textColor: { type: ['string', 'null'] },
        placement: { anyOf: [{ enum: PLACEMENTS }, { type: 'null' }], description: 'Where content sits in the cell.' },
      },
    },
    mirrors: ['menu:table/cellColor', 'menu:table/cellPlacement'],
  },
  {
    name: 'fillCells',
    summary: 'Copy the first column (right) or first row (down) of a range across the range. The other cells lose their blocks.',
    target: 'block',
    args: {
      type: 'object',
      required: ['range', 'direction'],
      additionalProperties: false,
      properties: { range: RANGE_ARGS, direction: { enum: ['right', 'down'] } },
    },
    mirrors: [],
  },
  {
    name: 'mergeCells',
    summary: 'Merge a rectangle of cells into its top-left cell. Their blocks move into it.',
    target: 'block',
    preconditions: ['The range has at least two cells and does not cut through another merged cell.'],
    args: { type: 'object', required: ['range'], additionalProperties: false, properties: { range: RANGE_ARGS } },
    mirrors: ['menu:table/table-merge-cells'],
  },
  {
    name: 'splitCell',
    summary: 'Split a merged cell back into single cells. Its content stays in the top-left cell.',
    target: 'block',
    preconditions: ['The cell at row, col is the top-left cell of a merge.'],
    args: {
      type: 'object',
      required: ['row', 'col'],
      additionalProperties: false,
      properties: { row: { type: 'integer', minimum: 0 }, col: { type: 'integer', minimum: 0 } },
    },
    mirrors: ['menu:table/table-split-cell'],
  },
];

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
                placement: { type: 'string', enum: PLACEMENTS },
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
  inputFields: [],
  summaryFields: ['withHeadings', 'withHeadingColumn'],
  guardedFields: { content: 'table.*' },
  actions: TABLE_ACTIONS,
});

import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const COLUMN_DATA = {
  type: 'object',
  description: 'One column of a column_list. Its content is its `content` children.',
  additionalProperties: false,
  properties: {
    widthRatio: { type: 'number', exclusiveMinimum: 0, description: 'Width relative to sibling columns. Omitted for an even split.' },
  },
};

export const describeColumn = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'One column of a column_list. Its content is its children.',
  guidance: 'Change widths with column_list.setWidths on the list, not by writing widthRatio on one column.',
  data: COLUMN_DATA,
  inputFields: [],
  defaultData: {},
  summaryFields: ['widthRatio'],
});

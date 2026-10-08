import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const COLUMN_LIST_DATA = {
  type: 'object',
  description: 'A row of columns. Carries no data — the columns are its `content` children.',
  additionalProperties: false,
};

export const describeColumnList = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A row of columns. The columns are its children.',
  guidance: 'Create one with column_list.create, which makes the columns too. Move an existing block into a column with block.move. The toolbox columnCount value is not saved data; never write it.',
  data: COLUMN_LIST_DATA,
  inputFields: [],
  defaultData: {},
});

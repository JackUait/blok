import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { COLOR_PRESET_NAMES } from './paragraph';

export const TABLE_OF_CONTENTS_DATA = {
  type: 'object',
  description: 'An outline of the page headings. The list is read from the document each time and never saved.',
  additionalProperties: false,
  properties: {
    textColor: { type: 'string', description: 'Text color preset name, e.g. "red".' },
    backgroundColor: { type: 'string', description: 'Background color preset name.' },
  },
};

export const describeTableOfContents = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'An outline of the page headings, read from the document each time.',
  guidance: `It stores no headings: add or edit header blocks instead. textColor and backgroundColor take a preset name: ${COLOR_PRESET_NAMES}.`,
  data: TABLE_OF_CONTENTS_DATA,
  defaultData: {},
});

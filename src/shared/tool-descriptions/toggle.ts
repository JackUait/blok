import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { COLOR_PRESET_NAMES, RICH_TEXT_GUIDANCE } from './paragraph';
import { richText } from './rich-text';

export const TOGGLE_DATA = {
  type: 'object',
  description: 'A collapsible summary line. Its body blocks reference it as `parent`.',
  required: ['text'],
  additionalProperties: false,
  properties: {
    text: richText('Rich text of the summary.'),
    textColor: { type: 'string', description: 'Text color preset name, e.g. "red".' },
    backgroundColor: { type: 'string', description: 'Background color preset name.' },
    isOpen: { type: 'boolean', deprecated: true, description: 'Ignored. Open state is personal and never saved.' },
  },
};

export const describeToggle = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A collapsible line. Its body is the blocks nested under it.',
  guidance: `${RICH_TEXT_GUIDANCE} Put the body in child blocks. Open or closed is per person and never saved. textColor and backgroundColor take a preset name: ${COLOR_PRESET_NAMES}.`,
  data: TOGGLE_DATA,
  inputFields: ['text'],
  defaultData: { text: [] },
  viewState: ['isOpen'],
});

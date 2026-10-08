import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { COLOR_PRESET_NAMES } from './paragraph';

export const CALLOUT_DATA = {
  type: 'object',
  description: 'A highlighted panel. Its body blocks reference it as `parent`; the panel itself holds no text.',
  required: ['emoji'],
  additionalProperties: false,
  properties: {
    emoji: { type: 'string', description: 'Leading emoji. Empty string hides it.' },
    textColor: { type: ['string', 'null'], description: 'Preset name, or null to inherit.' },
    backgroundColor: { type: ['string', 'null'], description: 'Preset name, or null for none.' },
  },
};

export const describeCallout = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A highlighted panel with an emoji. Its body is child blocks.',
  guidance: `The panel holds no text itself: insert the body as child blocks. emoji is one emoji or "" to hide it. textColor and backgroundColor take a preset name (${COLOR_PRESET_NAMES}) or null.`,
  data: CALLOUT_DATA,
  inputFields: [],
  defaultData: { emoji: '💡' },
  summaryFields: ['emoji'],
});

import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const TAB_DATA = {
  type: 'object',
  description: 'One tab of a tabs block. Its content is its `content` children.',
  required: ['title'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'Plain text, not HTML. Empty for an untitled tab.' },
    icon: { type: 'string', description: 'Emoji shown before the title. Omitted when the tab has none.' },
  },
};

export const describeTab = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'One tab of a tabs block. Its content is its children.',
  guidance: 'title is plain text, not HTML. icon is one emoji, or omit it.',
  data: TAB_DATA,
  defaultData: { title: '' },
  summaryFields: ['title', 'icon'],
});

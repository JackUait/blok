import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { RICH_TEXT_GUIDANCE } from './paragraph';
import { richText } from './rich-text';

export const QUOTE_DATA = {
  type: 'object',
  required: ['text'],
  additionalProperties: false,
  properties: {
    text: richText('Rich text of the quote.'),
    size: { type: 'string', enum: ['default', 'large'] },
  },
};

export const describeQuote = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A quotation.',
  guidance: `${RICH_TEXT_GUIDANCE} size is "default" or "large".`,
  data: QUOTE_DATA,
  defaultData: { text: [] },
  summaryFields: ['size'],
});

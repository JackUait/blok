import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { richText } from './rich-text';

export const COLOR_PRESET_NAMES = 'gray, brown, orange, yellow, green, blue, purple, pink, red';

export const RICH_TEXT_GUIDANCE = 'Rich-text fields take segments: [{ "text": "…", "marks": { "bold": true } }]. Never write Markdown into them; use markdown.insert to import Markdown.';

export const PARAGRAPH_DATA = {
  type: 'object',
  description: 'A line of rich text.',
  required: ['text'],
  additionalProperties: false,
  properties: {
    text: richText('The line\'s rich text.'),
    textColor: { type: 'string', description: 'Text color preset name, e.g. "red".' },
    backgroundColor: { type: 'string', description: 'Background color preset name.' },
  },
};

export const describeParagraph = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A paragraph of rich text. The default block.',
  guidance: `${RICH_TEXT_GUIDANCE} textColor and backgroundColor take a preset name: ${COLOR_PRESET_NAMES}.`,
  data: PARAGRAPH_DATA,
  defaultData: { text: [] },
  examples: [{ text: [{ text: 'Ship it ' }, { text: 'today', marks: { bold: true } }] }],
});

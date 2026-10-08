import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const CODE_DATA = {
  type: 'object',
  description: 'A code block. `code` is raw text, never HTML.',
  required: ['code', 'language'],
  additionalProperties: false,
  properties: {
    code: { type: 'string' },
    language: { type: 'string', description: 'Language identifier, e.g. "javascript", "plain text".' },
    lineNumbers: { type: 'boolean' },
    filename: { type: 'string', description: 'File name shown above the code, e.g. "block.ts". Omitted when empty.' },
  },
};

export const describeCode = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A code block with a language and an optional file name.',
  guidance: '`code` is raw text, never HTML and never a Markdown fence. language is a lowercase name such as "javascript" or "plain text".',
  data: CODE_DATA,
  defaultData: { code: '', language: 'plain text' },
  examples: [{ code: 'const a = 1;', language: 'javascript', filename: 'a.js' }],
  summaryFields: ['language', 'filename'],
});

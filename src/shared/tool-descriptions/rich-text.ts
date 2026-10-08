/** Rich-text schema pieces shared by every tool description and by blokDocumentSchema. */

/** Horizontal placement, shared by the media and embed tools. */
export const ALIGNMENT = ['left', 'center', 'right'] as const;

/** Formatting on one run of rich text. */
export const RICH_TEXT_MARKS = {
  type: 'object',
  description: 'Formatting on one run. A key Blok does not know is dropped on load, except `tag:<name>` keys from custom inline tools.',
  properties: {
    bold: { const: true },
    italic: { const: true },
    underline: { const: true },
    strikethrough: { const: true },
    code: { const: true },
    sup: { const: true },
    sub: { const: true },
    highlight: { const: true, description: 'A highlight with no colour of its own.' },
    color: { type: 'string', description: 'Preset name ("red") or any CSS colour.' },
    background: { type: 'string', description: 'Preset name ("red") or any CSS colour.' },
    link: {
      type: 'object',
      required: ['href'],
      additionalProperties: false,
      properties: { href: { type: 'string' }, target: { type: 'string' }, rel: { type: 'string' } },
    },
  },
  patternProperties: { '^tag:': { type: 'object', additionalProperties: { type: 'string' } } },
} as const;

/** A rich-text field: an array of segments (types/rich-text.d.ts), or inline HTML. */
export const richText = (description: string): Record<string, unknown> => ({
  description,
  oneOf: [
    {
      type: 'array',
      description: 'Rich-text segments, in order. Preferred: this is the shape Blok saves.',
      items: {
        anyOf: [
          {
            type: 'object',
            required: ['text'],
            additionalProperties: false,
            properties: { text: { type: 'string', description: 'Line breaks are "\\n".' }, marks: RICH_TEXT_MARKS },
          },
          {
            type: 'object',
            required: ['embed'],
            additionalProperties: false,
            properties: {
              embed: {
                oneOf: [
                  { type: 'object', required: ['equation'], additionalProperties: false, properties: { equation: { type: 'object', required: ['expression'], properties: { expression: { type: 'string' } } } } },
                  { type: 'object', required: ['page'], additionalProperties: false, properties: { page: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } },
                  { type: 'object', required: ['html'], additionalProperties: false, properties: { html: { type: 'string', description: 'Inline markup the segment model has no slot for, kept verbatim.' } } },
                ],
              },
              marks: RICH_TEXT_MARKS,
            },
          },
        ],
      },
    },
    { type: 'string', description: 'Inline HTML: <b>, <i>, <u>, <s>, <a>, <code>, <mark>, <sup>, <sub>, <br>. Accepted on input.' },
  ],
});

/** Rich-text schema pieces shared by every tool description and by blokDocumentSchema. */

import { DEFAULT_HIGHLIGHT_BACKGROUND } from '../agent/mark-input';
import { COLOR_PRESETS } from '../color-presets';

const PRESET_NAMES = COLOR_PRESETS.map(preset => `"${preset.name}"`).join(', ');

/** Horizontal placement, shared by the media and embed tools. */
export const ALIGNMENT = ['left', 'center', 'right'] as const;

/** Formatting on one run of rich text. */
export const RICH_TEXT_MARKS = {
  type: 'object',
  description: 'Formatting on one run. Unknown keys are dropped, except custom `tag:<name>` marks.',
  properties: {
    bold: { const: true },
    italic: { const: true },
    underline: { const: true },
    strikethrough: { const: true },
    code: { const: true },
    sup: { const: true, description: 'Not with sub on one run.' },
    sub: { const: true },
    highlight: { const: true, description: `Stored as background "${DEFAULT_HIGHLIGHT_BACKGROUND}".` },
    color: { type: 'string', description: `${PRESET_NAMES}. A hex, rgb or hsl value is stored as the nearest of them. A non-colour is dropped.` },
    background: { type: 'string', description: 'Like color. White and transparent are dropped.' },
    link: {
      type: 'object',
      description: 'Missing target and rel get the Link tool\'s defaults.',
      required: ['href'],
      additionalProperties: false,
      properties: { href: { type: 'string' }, target: { type: 'string' }, rel: { type: 'string' } },
    },
  },
  patternProperties: { '^tag:': { type: 'object', additionalProperties: { type: 'string' } } },
} as const;

/** One run of text with its marks. */
export const TEXT_SEGMENT = {
  type: 'object',
  required: ['text'],
  additionalProperties: false,
  properties: { text: { type: 'string', description: 'Line breaks are "\\n".' }, marks: RICH_TEXT_MARKS },
} as const;

/** An inline equation, page mention or kept markup, in the flow of the text. */
export const EMBED_SEGMENT = {
  type: 'object',
  required: ['embed'],
  additionalProperties: false,
  properties: {
    embed: {
      oneOf: [
        { type: 'object', required: ['equation'], additionalProperties: false, properties: { equation: { type: 'object', required: ['expression'], properties: { expression: { type: 'string', description: 'LaTeX.' } } } } },
        { type: 'object', required: ['page'], additionalProperties: false, properties: { page: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } },
        { type: 'object', required: ['html'], additionalProperties: false, properties: { html: { type: 'string', description: 'Inline markup with no segment shape, kept verbatim.' } } },
      ],
    },
    marks: RICH_TEXT_MARKS,
  },
} as const;


/** A rich-text field: an array of segments (types/rich-text.d.ts), or a plain string. */
export const richText = (description: string): Record<string, unknown> => ({
  description,
  oneOf: [
    {
      type: 'array',
      description: 'Rich-text segments, in order. Preferred: this is the shape Blok saves.',
      items: { anyOf: [TEXT_SEGMENT, EMBED_SEGMENT] },
    },
    { type: 'string', description: 'In saved data, inline HTML. An agent command stores a string as plain text, tags and all: use segments for formatting.' },
  ],
});

/** The contract's default general guidance: how to write every inline format. */
export const RICH_TEXT_PRIMER = [
  'Rich text is a list of segments: { text, marks? } or { embed, marks? }. A plain string is plain text, HTML tags included.',
  `Marks: ${Object.keys(RICH_TEXT_MARKS.properties).join(', ')}, and tag:<name> for a custom inline tool. sup and sub cannot share a run.`,
  `highlight is stored as background "${DEFAULT_HIGHLIGHT_BACKGROUND}". color and background take a preset: ${PRESET_NAMES}. A hex, rgb or hsl colour is stored as the nearest preset; a CSS colour name stays as written. A value that is not a colour, and a white or transparent background, is dropped.`,
  'A link needs href. Missing target and rel get the Link tool\'s defaults.',
  'Embeds: { equation: { expression } } is inline LaTeX; { page: { id } } mentions a page block.',
  // UNSET_ALL and UNSET_TAGS in agent/rich-text-ops.ts: importing them drags the sanitizers into the headless snapshot.
  'text.format with unset ["*"] clears every mark; "tag:*" clears every custom mark.',
  'markdown.insert cannot write underline, sup, sub, highlight or colours: insert the text, then use text.format.',
].join('\n');

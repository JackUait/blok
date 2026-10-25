/** Rich-text schema pieces shared by every tool description and by blokDocumentSchema. */

import { DEFAULT_HIGHLIGHT_BACKGROUND } from '../agent/mark-input';
import { COLOR_PRESETS } from '../color-presets';
import { DEFAULT_LINK_REL, DEFAULT_LINK_TARGET, SAME_PAGE_LINK_TARGET } from '../link-defaults';

const PRESET_NAMES = COLOR_PRESETS.map(preset => `"${preset.name}"`).join(', ');

/** Horizontal placement, shared by the media and embed tools. */
export const ALIGNMENT = ['left', 'center', 'right'] as const;

/** Formatting on one run of rich text. */
export const RICH_TEXT_MARKS = {
  type: 'object',
  description: 'Formatting on one run. Unknown keys drop, except custom `tag:<name>` marks.',
  properties: {
    bold: { const: true },
    italic: { const: true },
    underline: { const: true },
    strikethrough: { const: true },
    code: { const: true },
    sup: { const: true, description: 'Not with sub on one run.' },
    sub: { const: true },
    highlight: { const: true, description: `Stored as background "${DEFAULT_HIGHLIGHT_BACKGROUND}" unless background is set.` },
    color: { type: 'string', description: `${PRESET_NAMES}. Hex, rgb, hsl snap to the nearest; names and var() stay; other syntaxes drop.` },
    background: { type: 'string', description: 'Like color; page backgrounds drop.' },
    link: {
      type: 'object',
      description: `Default "${DEFAULT_LINK_TARGET}"/"${DEFAULT_LINK_REL}", "${SAME_PAGE_LINK_TARGET}" for #anchors.`,
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
        { type: 'object', required: ['equation'], additionalProperties: false, properties: { equation: { type: 'object', required: ['expression'], additionalProperties: false, properties: { expression: { type: 'string', description: 'LaTeX.' } } } } },
        { type: 'object', required: ['page'], additionalProperties: false, properties: { page: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } } } },
        { type: 'object', required: ['html'], additionalProperties: false, properties: { html: { type: 'string', description: 'Kept verbatim.' } } },
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
  `highlight alone is stored as background "${DEFAULT_HIGHLIGHT_BACKGROUND}"; with a background, as that background. color and background take a preset: ${PRESET_NAMES}. Hex, rgb and hsl are stored as the nearest preset. A CSS colour name is lowercased and kept, and so is var(--name). Other syntaxes (oklch, lab, hwb, color()) are dropped, as are a transparent colour and a white or dark-grey page background.`,
  `A link needs href. With no target or rel it gets target "${DEFAULT_LINK_TARGET}" and rel "${DEFAULT_LINK_REL}"; an "#anchor" href gets target "${SAME_PAGE_LINK_TARGET}". A target or rel you give is kept, but in the editor a host link config replaces both.`,
  'Embeds: { equation: { expression } } is inline LaTeX; { page: { id } } mentions a page: id is the pageId in a page block\'s data, not the block id.',
  // UNSET_ALL and UNSET_TAGS in agent/rich-text-ops.ts: importing them drags the sanitizers into the headless snapshot.
  'text.format with unset ["*"] clears every mark; "tag:*" clears every custom mark.',
  'markdown.insert cannot write underline, sup, sub, highlight or colours: insert the text, then use text.format.',
].join('\n');

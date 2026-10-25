import type { BlockToolDescription, ToolActionDeclaration } from '../../../types/tools/tool-description';

export const BOOKMARK_DATA = {
  type: 'object',
  description: 'A static link preview card built from OpenGraph metadata.',
  required: ['url'],
  additionalProperties: false,
  properties: {
    url: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    image: { type: 'string', description: 'Preview image URL.' },
    favicon: { type: 'string' },
    domain: { type: 'string' },
  },
};

export const BOOKMARK_ACTIONS: ToolActionDeclaration[] = [
  {
    name: 'create',
    summary: 'Create a link preview card. When the host fetches link previews, it fills the title, description and image.',
    target: 'create',
    // Without the service the card keeps just the url, so the command works everywhere.
    uses: ['linkMetadata'],
    args: {
      type: 'object',
      required: ['url'],
      additionalProperties: false,
      properties: { url: { type: 'string', pattern: '^https?://' } },
    },
    result: {
      type: 'object',
      required: ['id', 'childIds'],
      properties: { id: { type: 'string' }, childIds: { type: 'array', items: { type: 'string' } } },
    },
    mirrors: [],
  },
];

export const describeBookmark = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A link preview card.',
  guidance: 'Create one with bookmark.create: it fetches title, description and image. Do not invent preview fields.',
  data: BOOKMARK_DATA,
  summaryFields: ['url', 'title'],
  actions: BOOKMARK_ACTIONS,
});

import type { BlockToolDescription } from '../../../types/tools/tool-description';

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

export const describeBookmark = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A link preview card.',
  guidance: 'Create one with bookmark.create: it fetches title, description and image. Do not invent preview fields.',
  data: BOOKMARK_DATA,
  summaryFields: ['url', 'title'],
});

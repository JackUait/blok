import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const PAGE_LINK_DATA = {
  type: 'object',
  description: 'A non-owning reference to a page. It has no children.',
  required: ['pageId'],
  additionalProperties: false,
  properties: {
    pageId: { type: 'string', minLength: 1, description: 'Id of the referenced page.' },
  },
};

export const describePageLink = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A link to an existing page. It owns nothing.',
  guidance: 'pageId must name a page that exists. To make a new page, insert a page block instead.',
  data: PAGE_LINK_DATA,
  summaryFields: ['pageId'],
});

import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const PAGE_ICON_SCHEMA = {
  description:
    'The page icon. Absent when none. The editor ignores a malformed icon when it loads one; this schema rejects it. Extra keys are allowed, because the editor keeps them.',
  oneOf: [
    {
      type: 'object',
      required: ['type', 'value'],
      properties: {
        type: { const: 'emoji' },
        value: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['type', 'url'],
      properties: {
        type: { const: 'image' },
        url: { type: 'string' },
      },
    },
  ],
} as const;

export const PAGE_DATA = {
  type: 'object',
  description: 'A link to a sub-page. The page body lives in a separate document named by `pageId`, not in this one, so the block has no children.',
  required: ['pageId'],
  additionalProperties: false,
  properties: {
    pageId: { type: 'string', description: 'Id of the separate document that holds the page.' },
    textColor: { type: 'string', description: 'Text color preset name, e.g. "red".' },
    backgroundColor: { type: 'string', description: 'Background color preset name.' },
  },
};

export const describePage = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A sub-page. Its body is a separate document named by pageId.',
  guidance: 'Inserting a page asks the host to create the page document. To rename the page this block points to, or change its icon, use page.rename or page.setIcon. To change the title of the document you are editing, use doc.setTitle.',
  data: PAGE_DATA,
  inputFields: [],
  summaryFields: ['pageId'],
});

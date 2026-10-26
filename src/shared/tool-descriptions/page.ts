import type { BlockToolDescription, ToolActionDeclaration } from '../../../types/tools/tool-description';

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

export const PAGE_ACTIONS: ToolActionDeclaration[] = [
  {
    name: 'rename',
    summary: 'Rename the page this block points to. Not this document: use doc.setTitle for that.',
    target: 'block',
    runtime: 'any',
    effects: 'host',
    requires: ['pageBackend'],
    preconditions: ['Send it alone in its batch.'],
    args: {
      type: 'object',
      required: ['title'],
      additionalProperties: false,
      properties: { title: { type: 'string' } },
    },
    mirrors: ['menu:page/page-rename'],
  },
  {
    name: 'setIcon',
    summary: 'Set or clear the icon of the page this block points to.',
    target: 'block',
    runtime: 'any',
    effects: 'host',
    requires: ['pageBackend'],
    preconditions: ['Send it alone in its batch.'],
    args: {
      type: 'object',
      required: ['icon'],
      additionalProperties: false,
      properties: { icon: { anyOf: [PAGE_ICON_SCHEMA, { type: 'null' }] } },
    },
    mirrors: ['menu:page/page-edit-icon'],
  },
];

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
  guidance: 'Where page is insertable, inserting one makes the host create the page document: leave out data.pageId. block.delete removes only this link, as a person\'s Move to Trash does; the page document stays with the host. To rename the page this block points to, or change its icon, use page.rename or page.setIcon. To change the title of the document you are editing, use doc.setTitle. In the editor a read gives pageTitle, the title the block shows; other runtimes leave it out.',
  data: PAGE_DATA,
  inputFields: [],
  summaryFields: ['pageId'],
  // A person never re-points a page block; a written pageId could name a page this actor cannot open.
  guardedFields: { pageId: 'block.insert' },
  actions: PAGE_ACTIONS,
});

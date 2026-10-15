import type { BlockToolDescription, ToolActionDeclaration } from '../../../types/tools/tool-description';

export const TABS_ACTIONS: ToolActionDeclaration[] = [
  {
    name: 'create',
    target: 'create',
    summary: 'Create a tabs block with its tabs.',
    guidance: 'Omit tabs for three tabs titled Tab 1 to Tab 3. A new tab has no content; add blocks inside a tab with block.insert.',
    args: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tabs: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['title'],
            additionalProperties: false,
            properties: { title: { type: 'string' }, icon: { type: 'string' } },
          },
        },
      },
    },
    result: {
      type: 'object',
      required: ['id', 'childIds'],
      properties: {
        id: { type: 'string' },
        childIds: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'addTab',
    target: 'block',
    summary: 'Add a tab at a zero-based index.',
    guidance: 'Omit at, or pass an index past the last tab, to append. Omit title for "Tab <n>", where n is the new tab count.',
    args: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        icon: { type: 'string' },
        at: { type: 'integer', minimum: 0 },
      },
    },
    result: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    },
  },
  {
    name: 'deleteTab',
    target: 'block',
    summary: 'Delete a tab and its content.',
    args: {
      type: 'object',
      required: ['tabId'],
      additionalProperties: false,
      properties: { tabId: { type: 'string' } },
    },
    preconditions: [
      'tabId must be a tab of this tabs block.',
      'Deleting the last tab deletes the whole tabs block.',
    ],
    mirrors: ['menu:tabs/tabs-delete'],
  },
];

export const TABS_DATA = {
  type: 'object',
  description: "A set of tabs. Carries no data except a database's draft mark — the tabs are its `content` children, which are only `tab` blocks. The open tab is not saved.",
  additionalProperties: false,
  properties: {
    draft: {
      type: 'object',
      description: "Set by a database's Customize layout on a row-page view tab not applied yet. Other editors hide it; Apply removes it. Never write it.",
      required: ['at', 'by'],
      additionalProperties: false,
      properties: {
        at: { type: 'number', description: 'Epoch ms when it was made.' },
        by: { type: 'array', items: { type: 'integer' }, description: "The maker's collaboration client ids; empty without collaboration." },
      },
    },
  },
};

export const describeTabs = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A set of tabs. Each tab is a child tab block.',
  guidance: 'Create one with tabs.create. Add and delete tabs with tabs.addTab and tabs.deleteTab. Which tab is open is per person and never saved.',
  data: TABS_DATA,
  inputFields: [],
  defaultData: {},
  actions: TABS_ACTIONS,
});

import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const TABS_DATA = {
  type: 'object',
  description: 'A set of tabs. Carries no data — the tabs are its `content` children, which are only `tab` blocks. The open tab is not saved.',
  additionalProperties: false,
  properties: {},
};

export const describeTabs = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A set of tabs. Each tab is a child tab block.',
  guidance: 'Create one with tabs.create. Add and delete tabs with tabs.addTab and tabs.deleteTab. Which tab is open is per person and never saved.',
  data: TABS_DATA,
  inputFields: [],
  defaultData: {},
});

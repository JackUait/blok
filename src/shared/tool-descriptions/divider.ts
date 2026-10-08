import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const DIVIDER_DATA = {
  type: 'object',
  description: 'A horizontal rule. Carries no data.',
  additionalProperties: false,
};

export const describeDivider = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A horizontal rule.',
  data: DIVIDER_DATA,
  defaultData: {},
});

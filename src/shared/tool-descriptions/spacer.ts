import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const SPACER_DATA = {
  type: 'object',
  description: 'Vertical whitespace.',
  additionalProperties: false,
  properties: {
    height: { type: 'number', minimum: 38, maximum: 600, description: 'Gap in pixels. Defaults to 38; out-of-range values are clamped on load.' },
  },
};

export const describeSpacer = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'Vertical whitespace.',
  guidance: 'height is pixels, 38 to 600.',
  data: SPACER_DATA,
  defaultData: { height: 38 },
  summaryFields: ['height'],
});

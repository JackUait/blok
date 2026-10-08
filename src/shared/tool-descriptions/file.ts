import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const FILE_DATA = {
  type: 'object',
  description: 'A downloadable file card.',
  required: ['url'],
  additionalProperties: false,
  properties: {
    url: { type: 'string' },
    fileName: { type: 'string' },
    size: { type: 'integer', description: 'Bytes.' },
    mimeType: { type: 'string' },
    caption: { type: 'string' },
    captionVisible: { type: 'boolean' },
  },
};

export const describeFile = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A downloadable file card.',
  guidance: 'Set the file with file.setSource. fileName and caption are plain text.',
  data: FILE_DATA,
  summaryFields: ['fileName', 'mimeType'],
});

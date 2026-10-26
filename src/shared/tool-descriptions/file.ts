import type { BlockToolDescription, ToolActionDeclaration } from '../../../types/tools/tool-description';
import { fileUploadAction, urlSourceAction } from './url-action';

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

export const FILE_ACTIONS: ToolActionDeclaration[] = [
  urlSourceAction('setSource', 'Set or replace the file from a URL.'),
  fileUploadAction('a file card'),
];

export const describeFile = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A downloadable file card.',
  guidance: 'Insert it with url set, or upload a file with file.uploadFile where the host allows it; replace the file with file.setSource, which also copies it to the host. fileName and caption are plain text.',
  data: FILE_DATA,
  inputFields: ['fileName', 'caption'],
  summaryFields: ['fileName', 'mimeType'],
  actions: FILE_ACTIONS,
});

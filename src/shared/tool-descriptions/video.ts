import type { BlockToolDescription, ToolActionDeclaration } from '../../../types/tools/tool-description';
import { ALIGNMENT } from './rich-text';
import { fileUploadAction, urlSourceAction } from './url-action';

export const VIDEO_DATA = {
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: {
    url: { type: 'string' },
    variants: {
      type: 'array',
      description: 'Every rendition, best format first. Ignored unless it contains `url`, the most compatible one.',
      items: {
        type: 'object',
        required: ['url', 'mimeType'],
        additionalProperties: false,
        properties: { url: { type: 'string' }, mimeType: { type: 'string' } },
      },
    },
    caption: { type: 'string' },
    captionVisible: { type: 'boolean' },
    width: { type: 'number', minimum: 10, maximum: 100 },
    alignment: { type: 'string', enum: ALIGNMENT },
    autoplay: { type: 'boolean' },
    loop: { type: 'boolean' },
    hideControls: { type: 'boolean' },
    fileName: { type: 'string' },
    mimeType: { type: 'string' },
    aspectRatio: { type: 'string', description: 'Intrinsic ratio, e.g. "16 / 9".' },
  },
};

export const VIDEO_ACTIONS: ToolActionDeclaration[] = [
  urlSourceAction('setSource', 'Set or replace the video from a URL.'),
  fileUploadAction('a video block'),
];

export const describeVideo = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A video player.',
  guidance: 'Insert it with url set, or upload a file with video.uploadFile where the host allows it; replace the video with video.setSource, which also copies it to the host. caption is plain text.',
  data: VIDEO_DATA,
  summaryFields: ['alignment', 'width', 'autoplay', 'loop'],
  actions: VIDEO_ACTIONS,
});

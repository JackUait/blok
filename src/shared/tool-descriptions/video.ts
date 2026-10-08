import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { ALIGNMENT } from './rich-text';

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

export const describeVideo = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A video player.',
  guidance: 'Set the source with video.setSource. caption is plain text.',
  data: VIDEO_DATA,
  summaryFields: ['alignment', 'width', 'autoplay', 'loop'],
});

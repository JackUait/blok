import type { BlockToolDescription, ToolActionDeclaration } from '../../../types/tools/tool-description';
import { ALIGNMENT } from './rich-text';

export const EMBED_DATA = {
  type: 'object',
  description: 'A live third-party embed. Only registry-matched provider URLs are embedded.',
  required: ['service', 'source', 'embed'],
  additionalProperties: false,
  properties: {
    service: { type: 'string', description: 'Registry key, e.g. "youtube".' },
    source: { type: 'string', description: 'The original pasted URL.' },
    embed: { type: 'string', description: 'Provider-sanctioned embed URL. Must be https.' },
    kind: { type: 'string', enum: ['iframe', 'script'] },
    width: { type: 'number' },
    height: { type: 'number' },
    widthPercent: { type: 'number', minimum: 10, maximum: 100 },
    alignment: { type: 'string', enum: ALIGNMENT },
    caption: { type: 'string' },
    captionVisible: { type: 'boolean' },
  },
};

export const EMBED_ACTIONS: ToolActionDeclaration[] = [
  {
    name: 'setUrl',
    summary: 'Set or change the embedded URL. The provider is found from the URL.',
    target: 'block',
    preconditions: ['The URL belongs to a known provider.'],
    args: {
      type: 'object',
      required: ['url'],
      additionalProperties: false,
      properties: { url: { type: 'string', pattern: '^https?://' } },
    },
    mirrors: [],
  },
  {
    name: 'create',
    summary: 'Create an embed from a URL. The provider is found from the URL.',
    target: 'create',
    preconditions: ['The URL belongs to a known provider. A profile or channel page is not a video: use bookmark.create for it.'],
    args: {
      type: 'object',
      required: ['url'],
      additionalProperties: false,
      properties: { url: { type: 'string', pattern: '^https?://' } },
    },
    result: {
      type: 'object',
      required: ['id', 'childIds'],
      properties: { id: { type: 'string' }, childIds: { type: 'array', items: { type: 'string' } } },
    },
    mirrors: [],
  },
];

export const describeEmbed = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A live embed from a known provider (YouTube, Figma, …).',
  guidance: 'Create one with embed.create and change its URL with embed.setUrl: both find the provider and fill service, embed and kind. Never write those yourself. caption is plain text.',
  data: EMBED_DATA,
  summaryFields: ['service', 'source'],
  actions: EMBED_ACTIONS,
});

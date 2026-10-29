import { failure } from './errors';

import type { AgentError, Edit } from '../../../types/agent';
import type { AgentPorts } from './types';

type MediaPort = NonNullable<AgentPorts['media']>;

/**
 * Fields whose URL the block loads as soon as it renders. A link a person must click
 * (a bookmark's `url`, a link mark) is not here. Inline HTML is checked in every field.
 */
const MEDIA_FIELDS: Readonly<Record<string, readonly string[]>> = {
  image: ['url', 'variants'],
  video: ['url', 'variants'],
  audio: ['url', 'coverUrl'],
  file: ['url'],
  bookmark: ['image', 'favicon'],
  // `properties` holds file cells as { url } objects.
  'database-row': ['cover', 'properties'],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `url` strings at any depth: a variant list, a file cell. */
const nestedUrls = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(nestedUrls);
  }
  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, inner]) => key === 'url' && typeof inner === 'string' ? [inner] : nestedUrls(inner));
};

/** HTML anywhere in the data: inline embed segments, and HTML-carrying strings such as table cells. */
const htmlUrls = (value: unknown, media: MediaPort): string[] => {
  if (typeof value === 'string') {
    return value.includes('<') ? media.urlsInHtml(value) : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(inner => htmlUrls(inner, media));
  }

  return isRecord(value) ? Object.values(value).flatMap(inner => htmlUrls(inner, media)) : [];
};

const dataUrls = (type: string | undefined, data: Record<string, unknown>, media: MediaPort): string[] => {
  const fields = type === undefined ? [] : MEDIA_FIELDS[type] ?? [];
  const direct = fields.flatMap(field => {
    const value = data[field];

    return typeof value === 'string' ? [value] : nestedUrls(value);
  });

  return [...direct, ...htmlUrls(data, media)];
};

const refused = (url: string, commandIndex: number, blockId: string | undefined): AgentError =>
  failure('DATA_REJECTED', `${blockId === undefined ? 'The page' : `Block "${blockId}"`} would load ${url}, and this host does not let agents load media from there. Leave it out, or use a URL the host allows.`, {
    commandIndex, path: `/commands/${commandIndex}`,
    details: { ...(blockId !== undefined && { blockId }), reason: 'media-url', url },
  }).error;

/**
 * The refusals for media URLs an edit writes that the host's hook refuses. Without a hook
 * (MCP, the store, the server runtimes) nothing is checked.
 * `typeOf` reads a block's type in the document as the batch has changed it so far.
 */
export const mediaProblems = (
  media: MediaPort | undefined,
  edit: Edit,
  commandIndex: number,
  typeOf: (id: string) => string | undefined
): AgentError[] => {
  if (media === undefined) {
    return [];
  }
  const check = (urls: string[], blockId: string | undefined): AgentError[] =>
    [...new Set(urls)].filter(url => !media.allows(url)).map(url => refused(url, commandIndex, blockId));

  switch (edit.op) {
    case 'insert': {
      const walk = (block: typeof edit.block): AgentError[] => [
        ...check(dataUrls(block.type, block.data, media), block.id),
        ...block.children.flatMap(walk),
      ];

      return walk(edit.block);
    }
    case 'replaceType':
      return check(dataUrls(edit.type, edit.data, media), edit.id);
    case 'setData':
      return check(dataUrls(typeOf(edit.id), edit.patch, media), edit.id);
    case 'setRichText':
      return check(htmlUrls(edit.value, media), edit.id);
    case 'setPageField':
      return isRecord(edit.value) && edit.value.type === 'image' ? check(nestedUrls(edit.value), undefined) : [];
    case 'move':
    case 'remove':
    case 'setTunes':
      return [];
  }
};

import type { PageIcon } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The id `create` answered with; anything else keeps the id Blok passed. */
export const createdId = (answer: unknown): string | undefined =>
  isRecord(answer) && typeof answer.pageId === 'string' && answer.pageId !== '' ? answer.pageId : undefined;

/** A well-formed host icon, or undefined. */
export const readIcon = (value: unknown): PageIcon | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.type === 'emoji' && typeof value.value === 'string' && value.value !== '') {
    return { type: 'emoji', value: value.value };
  }
  if (value.type === 'image' && typeof value.url === 'string' && value.url !== '') {
    return { type: 'image', url: value.url };
  }

  return undefined;
};

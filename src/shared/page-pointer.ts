/**
 * Blok's page block points at another document by a string `pageId`. A
 * consumer may register its own tool under the key `page`; without a
 * non-empty `pageId` the block is theirs and keeps the unknown-block handling.
 */
export const isPagePointer = (type: string, data: unknown): boolean =>
  type === 'page'
  && typeof data === 'object'
  && data !== null
  && typeof (data as { pageId?: unknown }).pageId === 'string'
  && (data as { pageId?: unknown }).pageId !== '';

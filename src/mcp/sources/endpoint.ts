import { surfaceError } from '../errors';

import type { DocumentSource, SourceListing } from './types';
import { assertDocumentShape, isRecord } from './types';

const unavailable = (what: string): Error => surfaceError('SOURCE_UNAVAILABLE', `The document endpoint ${what}.`);

const parseJson = (text: string, what: string): unknown => {
  try {
    const parsed: unknown = JSON.parse(text);

    return parsed;
  } catch {
    throw unavailable(`answered non-JSON ${what}`);
  }
};

const hasStringId = (value: unknown): value is { id: string; title?: unknown } =>
  isRecord(value) && typeof value.id === 'string';

/**
 * Speaks the host's existing doc routes (packages/server/README.md, "endpoint"),
 * plus an optional list route that only MCP uses.
 */
export const createEndpointSource = (
  config: { url: string; endpointAuth: string; list?: string },
  fetchImpl: typeof fetch = fetch,
): DocumentSource => {
  const urlOf = (documentId: string): string => `${config.url.replace(/\/$/, '')}/${encodeURIComponent(documentId)}`;

  const call = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetchImpl(url, init);
    } catch {
      throw unavailable('could not be reached');
    }
  };

  const source: DocumentSource = {
    kind: 'endpoint',
    load: async (documentId) => {
      const response = await call(urlOf(documentId), { headers: { Authorization: config.endpointAuth } });

      if (response.status !== 200) {
        throw unavailable(`answered ${response.status} for ${documentId}`);
      }
      const body = parseJson(await response.text(), `for ${documentId}`);

      if (body === null) {
        return { raw: { blocks: [] }, version: null };
      }
      if (isRecord(body) && 'data' in body && !('blocks' in body)) {
        const version = typeof body.version === 'string' ? body.version : null;

        if (body.data === null) {
          return { raw: { blocks: [] }, version };
        }
        assertDocumentShape(body.data, documentId);

        return { raw: body.data, version };
      }
      assertDocumentShape(body, documentId);

      return { raw: body, version: null };
    },
    save: async (documentId, document, { ifVersion }) => {
      const response = await call(urlOf(documentId), {
        method: 'PUT',
        headers: {
          Authorization: config.endpointAuth,
          'Content-Type': 'application/json',
          ...(ifVersion !== null && { 'Blok-Doc-Version': ifVersion }),
        },
        body: JSON.stringify(document),
      });

      // README recommends 409 for a stale PUT; without it the host is last-writer-wins (spec §3.6).
      if (response.status === 409) {
        throw surfaceError('DOCUMENT_CHANGED', 'Someone saved this document since you opened it. Read it again, then retry.');
      }
      if (response.status < 200 || response.status > 299) {
        throw unavailable(`refused the save with ${response.status}`);
      }
      const text = await response.text();

      if (text === '') {
        return { version: ifVersion };
      }
      try {
        const body: unknown = JSON.parse(text);

        return { version: isRecord(body) && typeof body.version === 'string' ? body.version : ifVersion };
      } catch {
        return { version: ifVersion };
      }
    },
  };

  if (config.list !== undefined) {
    const listUrl = config.list;

    source.list = async ({ query, cursor, limit }): Promise<SourceListing> => {
      const params = new URLSearchParams({
        ...(query !== undefined && { query }),
        ...(cursor !== undefined && { cursor }),
        limit: String(limit),
      });
      const response = await call(`${listUrl}?${params.toString()}`, { headers: { Authorization: config.endpointAuth } });

      if (response.status !== 200) {
        throw unavailable(`list answered ${response.status}`);
      }
      const body = parseJson(await response.text(), 'for the list');

      if (!isRecord(body) || !Array.isArray(body.documents)) {
        throw unavailable('list answered without a "documents" array');
      }

      return {
        documents: body.documents.filter(hasStringId).map((doc) => ({
          id: doc.id,
          title: typeof doc.title === 'string' ? doc.title : null,
        })),
        nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null,
      };
    };
  }

  return source;
};

// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { handleDocumentRequest } from '../../../scripts/dev-doc-store.mjs';

const SEED = { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'seed' } }] };

describe('handleDocumentRequest', () => {
  let documents: Map<string, unknown>;

  beforeEach(() => {
    documents = new Map();
  });

  const request = (method: string, path: string, body?: string): { status: number; body?: string } =>
    handleDocumentRequest({ documents, seed: SEED, method, path, body });

  it('serves the seed document for a document nobody has written yet', () => {
    const response = request('GET', '/docs/playground');

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body ?? '')).toEqual(SEED);
  });

  it('serves what was written back', () => {
    const edited = { blocks: [{ id: 'b', type: 'paragraph', data: { text: 'edited' } }] };

    expect(request('PUT', '/docs/playground', JSON.stringify(edited)).status).toBe(204);
    expect(JSON.parse(request('GET', '/docs/playground').body ?? '')).toEqual(edited);
  });

  it('keeps documents apart by id', () => {
    request('PUT', '/docs/one', JSON.stringify({ blocks: [] }));

    expect(JSON.parse(request('GET', '/docs/two').body ?? '')).toEqual(SEED);
  });

  it('decodes an escaped document id', () => {
    request('PUT', '/docs/a%20b', JSON.stringify({ blocks: [] }));

    expect(documents.has('a b')).toBe(true);
  });

  it('answers 404 away from the document path', () => {
    expect(request('GET', '/elsewhere').status).toBe(404);
  });

  it('answers 405 for a method the sync service never sends', () => {
    expect(request('DELETE', '/docs/playground').status).toBe(405);
  });

  // A stray request must not take the whole dev store down mid-session.
  it('refuses a malformed document id instead of throwing', () => {
    expect(request('GET', '/docs/%zz').status).toBe(400);
  });

  // A malformed body must not take the whole dev store down mid-session.
  it('refuses an unparseable write instead of throwing', () => {
    expect(request('PUT', '/docs/playground', 'not json').status).toBe(400);
    expect(documents.size).toBe(0);
  });
});

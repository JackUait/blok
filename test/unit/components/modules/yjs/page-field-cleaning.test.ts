// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { readPageFields, type PageFields } from '../../../../../src/components/modules/yjs/page-fields';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

const parsePageObject = (json: string): PageFields => {
  const parsed: unknown = JSON.parse(json);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected a page object');
  }

  // Malformed fields must reach the same boundary as loaded JSON.
  return parsed;
};

describe('page field cleaning on JSON load', () => {
  let store: DocumentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new DocumentStore(new YBlockSerializer());
  });

  afterEach(() => {
    store.destroy();
    vi.restoreAllMocks();
  });

  it('loads a numeric title without losing the valid icon', () => {
    const fields = parsePageObject('{"title":42,"icon":{"type":"emoji","value":"🧭"}}');
    const before = structuredClone(fields);

    expect(() => store.pageFromJSON(fields)).not.toThrow();
    expect(store.page.get('title')).toBe(42);
    expect(store.page.get('icon')).toEqual({ type: 'emoji', value: '🧭' });
    expect(readPageFields(store.page)).toEqual({ icon: { type: 'emoji', value: '🧭' } });
    expect(fields).toEqual(before);
  });

  it('loads an emoji icon without a value without losing the title', () => {
    const fields = parsePageObject('{"title":"Bad icon","icon":{"type":"emoji","url":"https://example.com/x.png"}}');
    const before = structuredClone(fields);

    expect(() => store.pageFromJSON(fields)).not.toThrow();
    expect(store.page.get('icon')).toEqual({ type: 'emoji', url: 'https://example.com/x.png' });
    expect(store.page.get('title')).toBe('Bad icon');
    expect(readPageFields(store.page)).toEqual({ title: 'Bad icon' });
    expect(fields).toEqual(before);
  });
});

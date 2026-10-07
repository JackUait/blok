import { describe, expect, it } from 'vitest';
import { resolveTabKey, type TabKeyInput } from '../../../../../src/components/modules/tabSync/identity';

const base: TabKeyInput = {
  documentId: undefined,
  recordId: 'abc',
  idSource: 'persistence',
  hasSaved: false,
  isEmpty: false,
  pathname: '/docs/42',
};

describe('resolveTabKey', () => {
  it('keys format-2 documents apart from tabs of a format-1 build', () => {
    expect(resolveTabKey({ ...base, documentId: 'doc-42' })).toBe('blok-tab:2:id:doc-42');
    expect(resolveTabKey(base)).toBe('blok-tab:2:auto:abc:/docs/42');
  });

  it('uses the host documentId alone, whatever the path', () => {
    expect(resolveTabKey({ ...base, documentId: 'doc-42', pathname: '/a' }))
      .toBe(resolveTabKey({ ...base, documentId: 'doc-42', pathname: '/b' }));
  });

  it('keys auto mode on id + pathname', () => {
    expect(resolveTabKey(base)).not.toBe(resolveTabKey({ ...base, pathname: '/docs/43' }));
  });

  it('never auto-joins an empty document', () => {
    expect(resolveTabKey({ ...base, isEmpty: true })).toBeNull();
  });

  it('never auto-joins a document passed through raw data', () => {
    expect(resolveTabKey({ ...base, idSource: 'data' })).toBeNull();
  });

  it('auto-joins a minted id only after a save', () => {
    expect(resolveTabKey({ ...base, idSource: 'minted' })).toBeNull();
    expect(resolveTabKey({ ...base, idSource: 'minted', hasSaved: true })).not.toBeNull();
  });

  it('has no key without any id', () => {
    expect(resolveTabKey({ ...base, recordId: null })).toBeNull();
  });

  it('an explicit documentId joins even an empty document', () => {
    expect(resolveTabKey({ ...base, documentId: 'd', isEmpty: true })).not.toBeNull();
  });
});

// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '../helpers/domShims';
import { parseXml } from '../../../../../../src/tools/file/pptx/parser/XmlParser';

describe('SafeXmlNode.attr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves namespace-prefixed attributes by local name when the prefix differs', () => {
    const node = parseXml(`
      <root xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            rel:id="rId7"/>
    `);

    expect(node.attr('r:id')).toBe('rId7');
  });

  it('keeps exact unprefixed attributes ahead of namespace-local fallback', () => {
    const node = parseXml(`
      <root xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            id="local-id"
            rel:id="rId7"/>
    `);

    expect(node.attr('id')).toBe('local-id');
    expect(node.attr('r:id')).toBe('rId7');
  });

  it('uses any namespaced attribute for unknown prefixes with the same local name', () => {
    const node = parseXml(`
      <root xmlns:foo="urn:test" foo:id="foo-id"/>
    `);

    expect(node.attr('bar:id')).toBe('foo-id');
  });

  it('does not treat unprefixed attributes as unknown-prefixed namespace matches', () => {
    const node = parseXml('<root id="plain-id"/>');

    expect(node.attr('bar:id')).toBeUndefined();
  });
});

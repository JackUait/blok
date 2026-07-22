// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { blocksToViewNodes } from '../../../src/view';
import type { ViewNode } from '../../../src/view';

/**
 * `blocksToViewNodes` — the framework-agnostic JSON tree behind the React
 * bindings (`@experimental`). Same options and sanitization pipeline as
 * `blocksToHtml`; must stay DOM-free (node environment, like
 * index.purity.test.ts).
 */
describe('blocksToViewNodes', () => {
  it('maps a paragraph with inline marks to element and text nodes', () => {
    const nodes = blocksToViewNodes({
      blocks: [{ type: 'paragraph', data: { text: 'Hello <b>world</b>' } }],
    });

    expect(nodes).toEqual([
      {
        tag: 'p',
        attrs: {},
        children: [
          { text: 'Hello ' },
          { tag: 'b', attrs: {}, children: [{ text: 'world' }] },
        ],
      },
    ]);
  });

  it('carries sanitized attributes as a plain string record', () => {
    const nodes = blocksToViewNodes({
      blocks: [{ type: 'paragraph', data: { text: '<a href="https://x.test" target="_blank" rel="noopener">link</a>' } }],
    });

    const paragraph = nodes[0];

    expect('tag' in paragraph && paragraph.children[0]).toEqual({
      tag: 'a',
      attrs: { href: 'https://x.test', target: '_blank', rel: 'noopener' },
      children: [{ text: 'link' }],
    });
  });

  it('sanitizes malicious inline content before mapping', () => {
    const nodes = blocksToViewNodes({
      blocks: [{ type: 'paragraph', data: { text: 'safe<script>alert(1)</script><img src=x onerror=alert(1)>' } }],
    });

    expect(JSON.stringify(nodes)).not.toContain('script');
    expect(JSON.stringify(nodes)).not.toContain('onerror');
    expect(nodes).toEqual([{ tag: 'p', attrs: {}, children: [{ text: 'safe' }] }]);
  });

  it('preserves the mark color style attribute', () => {
    const nodes = blocksToViewNodes({
      blocks: [{ type: 'paragraph', data: { text: '<mark style="color: rgb(255, 0, 0);">red</mark>' } }],
    });

    const paragraph = nodes[0];
    const mark = 'tag' in paragraph ? paragraph.children[0] : undefined;

    expect(mark).toBeDefined();
    expect(mark !== undefined && 'tag' in mark && mark.attrs.style).toContain('color');
  });

  it('supports the same custom renderers option as blocksToHtml', () => {
    const nodes = blocksToViewNodes(
      { blocks: [{ type: 'shout', data: { text: 'loud' } }] },
      { renderers: { shout: (data, ctx) => `<aside>${ctx.sanitizeInline(String(data.text))}</aside>` } }
    );

    expect(nodes).toEqual([{ tag: 'aside', attrs: {}, children: [{ text: 'loud' }] }]);
  });

  it('returns an empty tree for malformed documents and skips comments-only output', () => {
    expect(blocksToViewNodes(null)).toEqual([]);
    expect(blocksToViewNodes(undefined)).toEqual([]);

    const commented: ViewNode[] = blocksToViewNodes(
      { blocks: [{ type: 'mystery', data: {} }] },
      { onUnknownBlock: 'comment' }
    );

    // HTML comments have no ViewNode representation — they are dropped.
    expect(commented).toEqual([]);
  });

  it('runs DOM-free (purity contract)', () => {
    blocksToViewNodes({ blocks: [{ type: 'paragraph', data: { text: 'pure' } }] });

    expect(Reflect.get(globalThis, 'window')).toBeUndefined();
    expect(Reflect.get(globalThis, 'document')).toBeUndefined();
  });
});

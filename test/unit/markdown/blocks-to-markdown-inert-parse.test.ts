import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blocksToMarkdown } from '../../../src/markdown/blocks-to-markdown';

/** HTML strings that were parsed into an element of the live document. */
const liveParses = (spy: { mock: { contexts: unknown[]; calls: unknown[][] } }): string[] =>
  spy.mock.calls
    .map(([html], index) => ({ html: String(html), owner: (spy.mock.contexts[index] as Element).ownerDocument }))
    .filter(({ owner }) => owner === document)
    .map(({ html }) => html);

describe('blocksToMarkdown reads block HTML in an inert document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never parses stored HTML into the live document, where <img onerror> would run', () => {
    const setter = vi.spyOn(Element.prototype, 'innerHTML', 'set');
    const payload = 'secret <img src=x onerror="alert(1)">';

    const markdown = blocksToMarkdown([{ tool: 'paragraph', data: { text: payload } }]);

    expect(liveParses(setter)).toEqual([]);
    expect(markdown).toBe('secret ![](x)');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blocksToHtml } from '../../../src/view/blocks-to-html';
import { blocksToPlainText } from '../../../src/view/blocks-to-plain-text';

const HINT = '<span data-blok-annotation="A &quot;quote&quot;" data-blok-annotation-subtitle="Anna">the phrase</span>';
const doc = (text: string): { blocks: Array<{ id: string; type: string; data: { text: string } }> } =>
  ({ blocks: [ { id: 'a', type: 'paragraph', data: { text } } ] });

describe('a hint in the static view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the span with its text and subtitle', () => {
    expect(blocksToHtml(doc(`We found ${HINT} here.`))).toContain(`We found ${HINT} here.`);
  });

  it('keeps a hint that arrives as a rich-text mark', () => {
    const html = blocksToHtml({
      blocks: [ {
        id: 'a',
        type: 'paragraph',
        data: { text: [ { text: 'the phrase', marks: { annotation: { text: 'A quote', subtitle: 'Anna' } } } ] },
      } ],
    });

    expect(html).toContain('<span data-blok-annotation="A quote" data-blok-annotation-subtitle="Anna">the phrase</span>');
  });

  it('reads as its phrase alone in plain text', () => {
    expect(blocksToPlainText(doc(`We found ${HINT} here.`))).toBe('We found the phrase here.');
  });
});

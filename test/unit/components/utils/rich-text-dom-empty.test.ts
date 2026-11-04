// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { htmlToSegmentsDom, parseInlineHtmlWithDom } from '../../../../src/components/utils/rich-text-dom';

describe('parseInlineHtmlWithDom with empty html', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives no nodes without building a document', () => {
    const build = vi.spyOn(document.implementation, 'createHTMLDocument');

    expect(parseInlineHtmlWithDom('')).toEqual([]);
    expect(build).not.toHaveBeenCalled();
  });

  it('gives the same segments as parsing would', () => {
    const parsed = document.implementation.createHTMLDocument('').body;

    parsed.innerHTML = '';

    expect(htmlToSegmentsDom('')).toEqual(htmlToSegmentsDom('<span></span>'));
    expect(parsed.childNodes).toHaveLength(0);
  });
});

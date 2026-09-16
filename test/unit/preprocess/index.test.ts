import { describe, it, expect } from 'vitest';
import { preprocessLegacyCmsHtml, preprocessLegacyCmsHtmlIn } from '../../../src/preprocess/index';

describe('preprocessLegacyCmsHtml', () => {
  it('takes a string and returns a cleaned string', () => {
    expect(preprocessLegacyCmsHtml('<p>&nbsp;</p><del>gone</del>')).toBe('<s>gone</s>');
  });

  it('keeps an image that a spacer sweep would have destroyed', () => {
    expect(preprocessLegacyCmsHtml('<p><img src="photo.png"></p>'))
      .toBe('<p><img src="photo.png"></p>');
  });

  it('parses inertly — no element of the input is adopted into the live document', () => {
    preprocessLegacyCmsHtml('<p><img src="does-not-exist.png"></p>');

    expect(document.querySelector('img')).toBeNull();
  });

  it('also exposes the in-place form for callers that already hold a DOM', () => {
    const wrapper = document.createElement('div');

    wrapper.innerHTML = '<p>&nbsp;</p><p>kept</p>';
    preprocessLegacyCmsHtmlIn(wrapper);

    expect(wrapper.innerHTML).toBe('<p>kept</p>');
  });
});

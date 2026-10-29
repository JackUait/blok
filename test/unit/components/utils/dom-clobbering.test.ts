import { describe, expect, it } from 'vitest';

import { isClobbered } from '../../../../src/components/utils/dom-clobbering';

const formWith = (html: string): HTMLFormElement => {
  const form = document.createElement('form');

  form.innerHTML = html;

  return form;
};

describe('isClobbered', () => {
  it('is false for a form whose controls shadow nothing', () => {
    expect(isClobbered(formWith('<input name="email"><input id="password">'))).toBe(false);
  });

  // Real forms name controls after form members a sanitizer never reads.
  it('is false for a form whose controls shadow only members a walk never reads', () => {
    expect(isClobbered(formWith('<label>Name</label><input name="name"><input id="title"><button id="submit">Send</button><input name="action">'))).toBe(false);
  });

  it('is false for elements that are not forms', () => {
    const div = document.createElement('div');

    div.innerHTML = '<input name="nextSibling">';

    expect(isClobbered(div)).toBe(false);
  });

  it.each([
    '<input name="nextSibling">',
    '<input name="nodeName">',
    '<input id="attributes">',
    '<img name="removeChild">',
    '<p><input name="childNodes"></p>',
  ])('is true for a form holding %s', (html) => {
    expect(isClobbered(formWith(html))).toBe(true);
  });
});

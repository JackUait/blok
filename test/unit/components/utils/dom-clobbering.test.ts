import { describe, expect, it } from 'vitest';

import { isClobbered } from '../../../../src/components/utils/dom-clobbering';

/**
 * A browser lets a form's named control shadow a form member; jsdom does not,
 * so these tests shadow it the same way: an own property on the form.
 * @param name - member to shadow
 * @param control - what the member now returns
 */
const shadow = (form: HTMLFormElement, name: string, control: Element): HTMLFormElement => {
  Object.defineProperty(form, name, { value: control, configurable: true });

  return form;
};

describe('isClobbered', () => {
  it('is false for a form whose members are its own', () => {
    const form = document.createElement('form');

    form.innerHTML = '<label>Name</label><input name="name"><input id="title"><button id="submit">Send</button>';

    expect(isClobbered(form)).toBe(false);
  });

  it('is false for elements that are not forms', () => {
    expect(isClobbered(shadow(document.createElement('div') as unknown as HTMLFormElement, 'nextSibling', document.createElement('input')))).toBe(false);
  });

  it.each([ 'nextSibling', 'nodeName', 'attributes', 'childNodes', 'removeChild', 'replaceWith' ])('is true when a control shadows %s', (name) => {
    expect(isClobbered(shadow(document.createElement('form'), name, document.createElement('input')))).toBe(true);
  });

  // `<input form="f">` outside the form shadows its members too, so markup inside the form proves nothing.
  it('is true when the shadowing control sits outside the form', () => {
    const outside = document.createElement('input');

    outside.setAttribute('form', 'f');
    outside.setAttribute('name', 'nodeName');

    expect(isClobbered(shadow(document.createElement('form'), 'nodeName', outside))).toBe(true);
  });
});

import { describe, it, expect, afterEach } from 'vitest';

import { isEntireContentSelected } from '../../../../src/tools/list/content-operations';

/**
 * Text before the element on purpose: the range has to be scoped to the element
 * itself, and a document-wide one would swallow that text instead.
 */
const host = (text: string): HTMLElement => {
  const element = document.createElement('div');

  element.textContent = text;
  document.body.append(document.createTextNode('before'), element);

  return element;
};

const selecting = (element: HTMLElement, start: number, end: number): Range => {
  const text = element.firstChild;

  if (text === null) {
    throw new Error('the fixture has no text to select');
  }

  const range = document.createRange();

  range.setStart(text, start);
  range.setEnd(text, end);

  return range;
};

describe('list content selection mutants', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('reports a selection covering the whole content', () => {
    const element = host('hello');

    expect(isEntireContentSelected(element, selecting(element, 0, 5))).toBe(true);
  });

  it('refuses a selection that starts past the beginning', () => {
    const element = host('hello');

    expect(isEntireContentSelected(element, selecting(element, 1, 5))).toBe(false);
  });

  it('refuses a selection that stops before the end', () => {
    const element = host('hello');

    expect(isEntireContentSelected(element, selecting(element, 0, 4))).toBe(false);
  });
});

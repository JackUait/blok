import { describe, it, expect } from 'vitest';

import { preserveEquationSpan } from '../../../../src/components/shared/inline-content-sanitize';

const span = (html: string, latex?: string): Element => {
  const element = document.createElement('span');

  element.innerHTML = html;
  if (latex !== undefined) {
    element.setAttribute('data-latex', latex);
  }

  return element;
};

describe('preserveEquationSpan mutants', () => {
  it('drops a span that carries no equation source', () => {
    expect(preserveEquationSpan(span('text'))).toBe(false);
  });

  it('keeps the source attribute and replaces a stale rendering with it', () => {
    const element = span('<span class="katex">rendered</span>', 'x^2');

    expect(preserveEquationSpan(element)).toStrictEqual({ 'data-latex': true });
    expect(element.textContent).toBe('x^2');
    expect(element.children).toHaveLength(0);
  });

  // The text already reads as the source, so rewriting it would flatten markup
  // that is allowed to stay.
  it('leaves a span whose text already is the source untouched', () => {
    const element = span('<b>x</b><i>^2</i>', 'x^2');

    expect(preserveEquationSpan(element)).toStrictEqual({ 'data-latex': true });
    expect(element.children).toHaveLength(2);
  });
});

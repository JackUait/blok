import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withHighlightFallback } from '../../../../src/components/utils/highlight-inheritance';

vi.mock('../../../../src/styles/highlight-fallback.css?inline', () => ({ default: '[data-blok-interface] ::highlight(x){color:red}' }));

const FALLBACK = '[data-blok-interface] ::highlight(x){color:red}';

/** Makes getComputedStyle report the probe's highlight colour on its child, as an inheriting engine does. */
const reportInherited = (): void => {
  const real = window.getComputedStyle.bind(window);

  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = real(element);

    if (pseudo !== undefined && pseudo !== null && pseudo.startsWith('::highlight(') && element.parentElement?.localName === 'blok-highlight-probe') {
      return { ...style, backgroundColor: 'rgb(1, 2, 3)' };
    }

    return style;
  });
};

describe('withHighlightFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends the descendant-form fallback when highlights do not inherit', () => {
    expect(withHighlightFallback('.a{}', undefined)).toBe(`.a{}\n${FALLBACK}`);
  });

  it('leaves the CSS alone when the engine inherits highlights', () => {
    reportInherited();

    expect(withHighlightFallback('.a{}', undefined)).toBe('.a{}');
  });

  it('removes the probe element and its style', () => {
    const before = document.documentElement.outerHTML;

    reportInherited();
    withHighlightFallback('.a{}', undefined);

    expect(document.documentElement.outerHTML).toBe(before);
  });

  it('gives the probe style the CSP nonce', () => {
    const nonces: Array<string | null> = [];

    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      nonces.push(document.head.querySelector('style:last-of-type')?.getAttribute('nonce') ?? null);

      return { backgroundColor: '' } as CSSStyleDeclaration;
    });
    withHighlightFallback('.a{}', 'n0nce');

    expect(nonces).toEqual(['n0nce']);
  });
});

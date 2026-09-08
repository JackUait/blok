import { describe, it, expect } from 'vitest';

import { Hint } from '../../../../../src/components/utils/popover/components/hint/hint';
import { css } from '../../../../../src/components/utils/popover/components/hint/hint.const';

const rendered = (alignment?: 'center' | 'start'): HTMLElement =>
  new Hint({ title: 'Bold', alignment }).getElement();

describe('popover hint mutants', () => {
  it('carries the centred alignment class, and says so in the attribute', () => {
    const root = rendered('center');

    expect(root.classList.contains(css.alignedCenter)).toBe(true);
    expect(root.classList.contains(css.alignedStart)).toBe(false);
    expect(root.getAttribute('data-alignment')).toBe('center');
  });

  // Anything that is not the word center is start, including nothing at all.
  it('falls back to start alignment', () => {
    for (const root of [rendered('start'), rendered()]) {
      expect(root.classList.contains(css.alignedStart)).toBe(true);
      expect(root.classList.contains(css.alignedCenter)).toBe(false);
    }
    expect(rendered().getAttribute('data-alignment')).toBe('start');
  });

  it('renders the title, and a description only when there is one', () => {
    expect(rendered().textContent).toBe('Bold');
    expect(new Hint({ title: 'Bold', description: 'CMD+B' }).getElement().children).toHaveLength(2);
  });
});

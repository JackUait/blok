import { describe, it, expect } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

const rules = (): Array<{ selector: string; body: string }> =>
  css.split('}')
    .map(chunk => chunk.split('{'))
    .filter(([selector]) => selector.includes('.blok-ink-well__veil'))
    .map(([selector, body = '']) => ({ selector: selector.trim(), body }));

describe('cover picker veil over a chosen picture', () => {
  it('is hidden at rest', () => {
    const base = rules().find(r => /\.blok-ink-well__veil\s*$/.test(r.selector));

    expect(base?.body).toMatch(/opacity:\s*0/);
  });

  it('shows on hover, and only over a picture', () => {
    const shown = rules().filter(r => /opacity:\s*1/.test(r.body));

    expect(shown.length).toBeGreaterThan(0);
    shown.forEach(r => {
      r.selector.split(',').forEach(part => {
        expect(part).toContain('[data-picture]');
        expect(part).toContain(':hover');
      });
    });
  });
});

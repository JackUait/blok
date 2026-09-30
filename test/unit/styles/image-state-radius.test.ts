/**
 * Static analysis of src/styles/main.css to guarantee that the image block's
 * frame and its three non-rendered states (empty, uploading, error) share one
 * corner radius, so cycling the states in the same block does not change the
 * corners.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

const findRuleBody = (source: string, selector: string): string | null => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|,\\s*|\\s)${escaped}\\s*\\{([^}]*)\\}`, 'm');
  const match = source.match(pattern);

  return match === null ? null : match[1];
};

const extractRadius = (body: string | null): string | null => {
  if (body === null) return null;
  const match = body.match(/border-radius:\s*([^;]+);/);

  return match === null ? null : match[1].trim();
};

describe('Image state card radius (src/styles/main.css)', () => {
  it.each([
    '.blok-media-empty__card',
    '.blok-image-uploading__card',
    '.blok-image-error',
    '[data-blok-tool="image"] .blok-image-inner img',
  ])('%s uses the block frame radius', (selector) => {
    expect(extractRadius(findRuleBody(css, selector))).toBe('var(--blok-radius-block)');
  });

  it('empty-state source tabs sit concentric inside the card header', () => {
    expect(extractRadius(findRuleBody(css, '.blok-media-empty__tab'))).toBe('var(--blok-radius-inner, var(--blok-radius-control))');
  });

  it('empty-state inner panel sits concentric inside the card, not at the card radius', () => {
    expect(extractRadius(findRuleBody(css, '.blok-media-empty__panel'))).toBe('var(--blok-radius-inner, var(--blok-radius-block))');
  });
});

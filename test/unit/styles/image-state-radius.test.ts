/**
 * Static analysis of src/styles/main.css to guarantee that the three
 * non-rendered image states (empty, uploading, error) share the same corner
 * rounding token. Historically the uploading card hardcoded `12px` while the
 * other two used `var(--blok-radius-lg)`, making the states look slightly
 * different when cycled in the same block.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/main.css'), 'utf-8');

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
  it('empty state card uses the shared --blok-radius-lg token', () => {
    const radius = extractRadius(findRuleBody(css, '.blok-image-empty__card'));

    expect(radius).toBe('var(--blok-radius-lg)');
  });

  it('uploading state card uses the shared --blok-radius-lg token', () => {
    const radius = extractRadius(findRuleBody(css, '.blok-image-uploading__card'));

    expect(radius).toBe('var(--blok-radius-lg)');
  });

  it('error state card uses the shared --blok-radius-lg token', () => {
    const radius = extractRadius(findRuleBody(css, '.blok-image-error'));

    expect(radius).toBe('var(--blok-radius-lg)');
  });

  it('rendered image uses the shared --blok-radius-lg token', () => {
    const radius = extractRadius(findRuleBody(css, '[data-blok-tool="image"] .blok-image-inner img'));

    expect(radius).toBe('var(--blok-radius-lg)');
  });

  it('empty-state source tabs (Upload / Link) use the softer --blok-radius-md token so their pill shape harmonises with the 12px outer card', () => {
    const radius = extractRadius(findRuleBody(css, '.blok-image-empty__tab'));

    expect(radius).toBe('var(--blok-radius-md)');
  });

  it('empty-state inner panel matches the outer card radius so both curves feel of the same family', () => {
    const radius = extractRadius(findRuleBody(css, '.blok-image-empty__panel'));

    expect(radius).toBe('var(--blok-radius-lg)');
  });
});

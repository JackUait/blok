import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postcss from 'postcss';
import type { Rule } from 'postcss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Ask AI preview draws a heading before the real one exists. It must use the
 * same host tokens and fallbacks as heading.css, or the hand-off jumps in size.
 * The preview rules live in assistant.css (not in heading.css's selector lists,
 * which would ship them in the view stylesheet), so this test keeps them in step.
 */

const STYLES = resolve(__dirname, '../../../src/styles');

const bodyOf = (file: string, selector: string): string | null => {
  const root = postcss.parse(readFileSync(resolve(STYLES, file), 'utf8'));
  const found: Rule[] = [];

  root.walkRules((rule) => {
    if (rule.selectors.includes(selector)) {
      found.push(rule);
    }
  });

  return found.length === 1 ? found[0].nodes.map(String).join('; ') : null;
};

describe('Ask AI preview heading typography', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shares the heading weight, bottom margin and line-height', () => {
    const real = bodyOf('heading.css', '[data-blok-tool="header"]');

    expect(real).not.toBeNull();
    expect(bodyOf('assistant.css', '[data-blok-ai-preview] [data-blok-heading-level]')).toBe(real);
  });

  it.each([1, 2, 3, 4, 5, 6])('sizes level %i like the real heading', (level) => {
    const real = bodyOf('heading.css', `:where([data-blok-tool="header"])[data-blok-heading-level="${level}"]`);

    expect(real).not.toBeNull();
    expect(bodyOf('assistant.css', `[data-blok-ai-preview] [data-blok-heading-level="${level}"]`)).toBe(real);
  });
});

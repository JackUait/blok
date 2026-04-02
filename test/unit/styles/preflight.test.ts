import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Preflight CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../../src/styles/main.css'), 'utf-8');

  it('should not reset border-radius on form elements', () => {
    /**
     * Tailwind v4 preflight resets form elements inside [data-blok-interface] and [data-blok-popover].
     * A `border-radius: 0` in that reset rule prevents Tailwind utility classes like `rounded-lg`
     * from working on <button> elements due to a browser edge case with var() in CSS shorthand properties.
     */
    const formResetMatch = css.match(
      /:where\(\[data-blok-interface\][\s\S]*?\) :is\(button[\s\S]*?\)\s*\{([^}]+)\}/
    );

    expect(formResetMatch).not.toBeNull();

    const ruleBody = formResetMatch?.[1] ?? '';

    expect(ruleBody).not.toContain('border-radius');
  });
});

import { describe, it, expect } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

describe('Preflight CSS', () => {

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

describe('Theme tokens', () => {
  it('defines --blok-bg-secondary in the light theme', () => {
    expect(css).toContain('--blok-bg-secondary');
  });

  it('defines --blok-border-secondary in the light theme', () => {
    expect(css).toContain('--blok-border-secondary');
  });

  it('maps bg-secondary to the Tailwind @theme inline block', () => {
    expect(css).toContain('--color-bg-secondary');
  });

  it('maps border-secondary to the Tailwind @theme inline block', () => {
    expect(css).toContain('--color-border-secondary');
  });
});

/**
 * The − and + in the table size card each sit in their own square chip,
 * inset from the stepper's frame, so a hover fill never touches the border.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ruleBody = (selector: string): string | undefined =>
  new RegExp(`(?:^|[},])\\s*${escape(selector)}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'm').exec(css)?.[1];

const px = (body: string | undefined, prop: string): number =>
  Number(new RegExp(`(?:^|[;\\s])${prop}:\\s*(\\d+)px`).exec(body ?? '')?.[1]);

describe('table size stepper look', () => {
  const frame = ruleBody('[data-blok-table-fullscreen-stepper]');
  const step = ruleBody('[data-blok-table-fullscreen-step]');

  it('insets each step chip from the frame on every side', () => {
    // --blok-space-0-5 is 2px: 28px frame minus two 1px borders minus 2px twice.
    expect(frame).toMatch(/padding:\s*var\(--blok-space-0-5\)/);
    expect(px(step, 'width')).toBe(px(step, 'height'));
    expect(px(step, 'height')).toBe(px(frame, 'height') - 2 - 2 * 2);
  });

  it('rounds the chip less than the frame so the curves stay parallel', () => {
    expect(frame).toMatch(/border-radius:\s*var\(--blok-radius-field\)/);
    expect(step).toMatch(/border-radius:\s*var\(--blok-radius-control\)/);
  });

  it('centres the glyph in the chip', () => {
    expect(step).toMatch(/display:\s*inline-flex/);
    expect(step).toMatch(/align-items:\s*center/);
    expect(step).toMatch(/justify-content:\s*center/);
  });

  it('shows a deeper fill while pressed', () => {
    expect(css).toMatch(/\[data-blok-table-fullscreen-step\][^{]*:active:not\(:disabled\)\s*\{[^}]*background-color:\s*var\(--blok-icon-active-bg\)/);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../../../src/tools/image/darkroom/darkroom.css'), 'utf8');
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);

  if (at === -1) {
    throw new Error(`missing ${selector}`);
  }

  return css.slice(at, css.indexOf('}', at));
};
const BLUE = /#(?:3b82f6|2563eb|1d4ed8|0a84ff|007aff|4a90e2)|\bblue\b|--blok-(?:link|focus)/i;

describe('darkroom.css', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the selected shape chip is neutral: active tokens, never blue', () => {
    const selected = rule('.blok-darkroom__chip[data-active="true"]');

    expect(selected).toContain('var(--blok-icon-active-bg)');
    expect(selected).not.toMatch(BLUE);
  });

  it('Done is white on black, not blue', () => {
    const done = rule('.blok-darkroom__btn--primary');

    expect(done).not.toMatch(BLUE);
    expect(done).toMatch(/background:\s*var\(--blok-darkroom-done-bg\)/);
    expect(done).toMatch(/color:\s*var\(--blok-darkroom-done-ink\)/);
    expect(rule('.blok-darkroom')).toMatch(/--blok-darkroom-done-bg:\s*#fff;/);
    expect(rule('.blok-darkroom')).toMatch(/--blok-darkroom-done-ink:\s*#000;/);
  });

  it('the frame radius comes from the morph channel', () => {
    expect(rule('.blok-darkroom__frame')).toMatch(/border-radius:\s*var\(--blok-radius-darkroom-frame\)/);
  });

  it('a hidden control stays hidden even where the rule sets display', () => {
    expect(rule('.blok-darkroom [hidden]')).toMatch(/display:\s*none/);
  });

  it('never uses the font shorthand with inherit, which drops the whole declaration', () => {
    expect(css).not.toMatch(/font:[^;]*\binherit\b/);
  });

  it('the fly-out clone is fixed, radius-morphed, and scales its img from the corner', () => {
    const flight = rule('.blok-darkroom-flight');

    expect(flight).toMatch(/position:\s*fixed/);
    expect(flight).toMatch(/border-radius:\s*var\(--blok-radius-darkroom-frame\)/);
    expect(rule('.blok-darkroom-flight img')).toMatch(/transform-origin:\s*0 0/);
  });

  it('is imported by main.css instead of the old crop styles', () => {
    const main = readFileSync(resolve(__dirname, '../../../../../src/styles/main.css'), 'utf8');

    expect(main).toContain("@import '../tools/image/darkroom/darkroom.css';");
    expect(main).not.toContain('crop-editor.css');
    expect(main).not.toContain('crop-modal.css');
  });
});

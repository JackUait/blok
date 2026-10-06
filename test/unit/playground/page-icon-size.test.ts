import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const css = readFileSync(resolve(__dirname, '../../../src/playground/playground.css'), 'utf-8');

const rule = (selector: string): string => {
  const match = new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css);

  if (match === null) {
    throw new Error(`No rule for ${selector}`);
  }

  return match[1];
};

const px = (block: string, property: string): number => {
  const match = new RegExp(`(?:^|[\\s;])${property}:\\s*(\\d+)px`).exec(block);

  if (match === null) {
    throw new Error(`No ${property} in rule`);
  }

  return Number(match[1]);
};

describe('page header icon', () => {
  const icon = rule('.pg-page-icon');

  it('draws the emoji at Notion size', () => {
    expect(px(icon, 'font-size')).toBe(78);
  });

  it('keeps a hover box around the whole glyph', () => {
    expect(px(icon, 'width')).toBeGreaterThan(px(icon, 'font-size'));
    expect(px(icon, 'height')).toBeGreaterThan(px(icon, 'font-size'));
  });

  it('keeps the emoji fully opaque when the button is disabled in read-only', () => {
    // Chrome paints color emoji with the alpha of `color`; a disabled button's UA color is 30% gray.
    expect(rule('.pg-page-icon:disabled')).toMatch(/(?:^|[\s;])color:\s*inherit/);
  });
});

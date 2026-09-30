/**
 * The radius design system (docs/plans/2026-09-30-radius-design-system.md):
 * one ordered primitive scale, role tokens built only from it, and Tailwind's
 * `rounded-*` classes wired to it so the two never drift apart.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (file: string): string => readFileSync(resolve(__dirname, '../../../src/styles', file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const colors = read('colors.css');
const isolation = read('isolation.css');

const declared = (source: string, name: string): string | null => {
  const match = source.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));

  return match === null ? null : match[1].trim();
};

const toPx = (value: string): number => {
  const rem = value.match(/^([\d.]+)rem$/);

  if (rem !== null) {
    return Number(rem[1]) * 16;
  }

  const px = value.match(/^([\d.]+)px$/);

  if (px !== null) {
    return Number(px[1]);
  }

  return value === '0' ? 0 : Number.NaN;
};

const PRIMITIVES = ['0', '2', '4', '6', '8', '10', '12', '16'];

const ROLES: Record<string, string> = {
  dialog: '12',
  surface: '10',
  block: '10',
  field: '8',
  'control-lg': '8',
  control: '6',
  'control-sm': '4',
  mark: '2',
  floor: '4',
};

describe('radius primitives', () => {
  it('each primitive is its name in px, written in rem so it follows the root font size', () => {
    for (const step of PRIMITIVES) {
      const value = declared(colors, `--blok-radius-${step}`);

      expect(value, `--blok-radius-${step}`).not.toBeNull();
      expect(toPx(value ?? ''), `--blok-radius-${step}`).toBe(Number(step));

      if (step !== '0') {
        expect(value).toMatch(/rem$/);
      }
    }
  });

  it('declares a full step for pills', () => {
    expect(declared(colors, '--blok-radius-full')).toBe('9999px');
  });
});

describe('radius roles', () => {
  it('every role points at a primitive, never a literal', () => {
    for (const [role, step] of Object.entries(ROLES)) {
      expect(declared(colors, `--blok-radius-${role}`), role).toBe(`var(--blok-radius-${step})`);
    }

    expect(declared(colors, '--blok-radius-pill')).toBe('var(--blok-radius-full)');
  });

  it('keeps sub-step notches (crop handles, carets) on one micro token', () => {
    expect(toPx(declared(colors, '--blok-radius-notch') ?? '')).toBe(1.5);
  });
});

describe('Tailwind radius classes', () => {
  const TAILWIND: Record<string, string> = {
    '--radius': '4',
    '--radius-xs': '2',
    '--radius-sm': '4',
    '--radius-md': '6',
    '--radius-lg': '8',
    '--radius-xl': '12',
    '--radius-2xl': '16',
  };

  it('resolve to Blok primitives, so a host override of a primitive moves the class too', () => {
    for (const [name, step] of Object.entries(TAILWIND)) {
      expect(declared(isolation, name), name).toBe(`var(--blok-radius-${step})`);
    }
  });

  it('are re-pinned on every root that carries Blok tokens', () => {
    const block = isolation.match(/([^{}]*)\{\s*--radius:/);

    expect(block).not.toBeNull();
    const selectors = (block?.[1] ?? '').split(',').map((s) => s.trim());

    expect(selectors).toEqual(expect.arrayContaining([
      ':where([data-blok-interface])',
      ':where([data-blok-popover])',
      ':where([data-blok-top-layer])',
    ]));
  });
});

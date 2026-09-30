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

describe('removed radius names', () => {
  it.each(['xs', 'sm', 'md', 'lg', 'xl', 'md-plus', 'hairline', 'none'])('--blok-radius-%s is gone', (name) => {
    expect(declared(colors, `--blok-radius-${name}`)).toBeNull();
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
  // The radius law bans every Tailwind radius step, so nothing reads --radius-*.
  // A re-pin would only add bytes to every stylesheet, view.css included.
  it('are not re-pinned, because no Blok class reads --radius-*', () => {
    expect(isolation).not.toMatch(/--radius(?:-\w+)?\s*:/);
  });
});

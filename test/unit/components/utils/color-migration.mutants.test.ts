import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const deps = vi.hoisted(() => ({
  presets: new Map<string, string | null>(),
  whites: new Set<string>(),
  darks: new Set<string>(),
}));

// The real mappers answer null for anything that is not a raw colour, which
// hides every guard behind them. A mapper that always matches makes each guard
// the only thing standing between a value and a rewrite.
vi.mock('../../../../src/components/utils/color-mapping', () => ({
  mapToNearestPresetName: (value: string): string | null =>
    (deps.presets.has(value) ? deps.presets.get(value) ?? null : 'red'),
}));

vi.mock('../../../../src/components/utils/default-page-colors', () => ({
  isDefaultWhiteBackground: (value: string): boolean => deps.whites.has(value),
  isDefaultDarkBackground: (value: string): boolean => deps.darks.has(value),
}));

vi.mock('../../../../src/components/shared/color-presets', () => ({
  colorVarName: (name: string, mode: string): string => `var(--mapped-${name}-${mode})`,
}));

import { migrateMarkColors } from '../../../../src/components/utils/color-migration';

const migrated = (style: string): { color: string; background: string } => {
  const container = document.createElement('div');
  const mark = document.createElement('mark');

  mark.setAttribute('style', style);
  container.appendChild(mark);
  migrateMarkColors(container);

  return {
    color: mark.style.getPropertyValue('color'),
    background: mark.style.getPropertyValue('background-color'),
  };
};

describe('mark colour migration mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deps.presets.clear();
    deps.whites.clear();
    deps.darks.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rewrites a raw colour to its preset variable, per property mode', () => {
    expect(migrated('color: #ff0000; background-color: #00ff00')).toStrictEqual({
      color: 'var(--mapped-red-text)',
      background: 'var(--mapped-red-bg)',
    });
  });

  // A variable the mapper would rewrite to something else, so the guard is the
  // only thing keeping it as it is.
  it('leaves a value that is already a variable', () => {
    expect(migrated('color: var(--custom-accent)').color).toBe('var(--custom-accent)');
  });

  it('leaves transparent alone', () => {
    expect(migrated('color: transparent').color).toBe('transparent');
  });

  // An unset property reads as the empty string, and the empty string must not
  // be treated as a colour to map.
  it('does not invent a colour for a property that has none', () => {
    expect(migrated('background-color: #00ff00').color).toBe('');
  });

  it('strips a default page background, and only from the background', () => {
    deps.whites.add('rgb(255, 255, 255)');

    expect(migrated('color: rgb(255, 255, 255); background-color: rgb(255, 255, 255)')).toStrictEqual({
      color: 'var(--mapped-red-text)',
      background: '',
    });
  });

  it('strips a default dark background too', () => {
    deps.darks.add('rgb(25, 25, 25)');

    expect(migrated('background-color: rgb(25, 25, 25)').background).toBe('');
  });

  it('leaves a value no preset matches untouched', () => {
    deps.presets.set('rgb(1, 2, 3)', null);

    expect(migrated('color: rgb(1, 2, 3)').color).toBe('rgb(1, 2, 3)');
  });
});

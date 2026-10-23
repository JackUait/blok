/**
 * Notion's `pencilLineSmall` (feel findings B08): a slim pencil whose tip sits
 * on a baseline, with its cap drawn apart. It must not read as IconPencil.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as Icons from '../../../../src/components/icons';

const STROKE = 1.25;

const iconOf = (name: string): string => {
  const icon: unknown = Object.entries(Icons).find(([key]) => key === name)?.[1];

  if (typeof icon !== 'string') {
    throw new Error(`Missing ${name}`);
  }

  return icon;
};

/** Paths in drawing order: body, cap, baseline. */
const pathsOf = (markup: string): Map<string, string> => {
  const ds = [...new DOMParser().parseFromString(markup, 'image/svg+xml').querySelectorAll('path')].map((path) => path.getAttribute('d') ?? '');

  return new Map(ds.map((d, i) => [['body', 'cap', 'baseline'][i] ?? `extra${i}`, d]));
};

const numbers = (d: string): number[] => (d.match(/-?[\d.]+/g) ?? []).map(Number);

describe('IconPencilLine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws a body, a separate cap and a baseline', () => {
    expect([...pathsOf(iconOf('IconPencilLine')).keys()].sort()).toStrictEqual(['baseline', 'body', 'cap']);
  });

  it('puts the pencil tip on the baseline, and starts the baseline past the body', () => {
    const parts = pathsOf(iconOf('IconPencilLine'));
    const [tipX, tipY] = numbers(parts.get('body') ?? '');
    const [lineX, lineY] = numbers(parts.get('baseline') ?? '');

    expect(lineY).toBe(tipY);
    expect(lineX - tipX).toBeGreaterThanOrEqual(3 * STROKE);
  });

  it('keeps the cap at least one stroke clear of the body', () => {
    const parts = pathsOf(iconOf('IconPencilLine'));
    const body = numbers(parts.get('body') ?? '');
    const [capX, capY] = numbers(parts.get('cap') ?? '');
    // The body's top end (its 3rd and 4th points) runs at 45°: x - y is constant along it.
    const edge = body[4] - body[5];
    const gap = Math.abs(capX - capY - edge) / Math.SQRT2;

    expect(gap - STROKE).toBeGreaterThanOrEqual(STROKE * 0.9);
  });

  it('is a different picture from IconPencil', () => {
    expect(iconOf('IconPencilLine')).not.toBe(Icons.IconPencil);
  });
});

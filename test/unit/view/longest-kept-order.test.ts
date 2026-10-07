// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { longestKeptOrder } from '../../../src/view/longest-kept-order';

interface LisCase { positions: number[]; kept: number[] }
const isCases = (value: unknown): value is { cases: LisCase[] } =>
  typeof value === 'object' && value !== null && Array.isArray((value as { cases?: unknown }).cases);
const raw: unknown = JSON.parse(readFileSync(resolve(__dirname, '../../fixtures/version-history/lis-cases.json'), 'utf8'));
const cases = isCases(raw) ? raw.cases : [];

describe('longestKeptOrder', () => {
  it('has fixture cases', () => {
    expect(cases.length).toBeGreaterThan(5);
  });

  it.each(cases)('keeps $kept for $positions', ({ positions, kept }) => {
    expect(longestKeptOrder(positions)).toEqual(kept);
  });
});

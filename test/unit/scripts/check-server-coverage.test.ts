// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COVERAGE_THRESHOLDS,
  GO_COVERAGE_THRESHOLDS,
  validateGoCoverage,
  validateServerCoverage,
} from '../../../scripts/check-server-coverage.mjs';

const coverage = (lineRate: string, branchRate: string): string =>
  `<?xml version="1.0"?><coverage branch-rate="${branchRate}" line-rate="${lineRate}"></coverage>`;

describe('check-server-coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts coverage at the enforced floors', () => {
    expect(validateServerCoverage(coverage('0.80', '0.80'))).toEqual({
      lines: 80,
      branches: 80,
    });
    expect(COVERAGE_THRESHOLDS).toEqual({
      lines: 80,
      branches: 80,
    });
  });

  it('rejects line coverage below the floor', () => {
    expect(() => validateServerCoverage(coverage('0.799', '0.90')))
      .toThrow('Line coverage 79.9% is below 80%');
  });

  // Rounding before the compare would let 79.996% pass an 80% floor.
  it('rejects coverage that only rounds up to the floor', () => {
    expect(() => validateServerCoverage(coverage('0.79996', '0.90')))
      .toThrow('Line coverage 79.99% is below 80%');
  });

  it('rejects branch coverage below the floor', () => {
    expect(() => validateServerCoverage(coverage('0.90', '0.799')))
      .toThrow('Branch coverage 79.9% is below 80%');
  });

  it.each([
    ['<report />', 'Missing Cobertura coverage element'],
    [coverage('unknown', '0.90'), 'Invalid Cobertura line-rate'],
    [coverage('0.90', '1.01'), 'Invalid Cobertura branch-rate'],
  ])('rejects malformed coverage: %#', (xml, message) => {
    expect(() => validateServerCoverage(xml)).toThrow(message);
  });
});

const goProfile = (...blocks: string[]): string =>
  ['mode: atomic', ...blocks, ''].join('\n');

describe('check-server-coverage for Go profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts covered statements over all statements, as go tool cover does', () => {
    expect(validateGoCoverage(goProfile(
      'example.com/m/a.go:1.1,2.2 8 1',
      'example.com/m/a.go:3.1,4.2 2 0',
    ))).toEqual({ statements: 80 });
    expect(GO_COVERAGE_THRESHOLDS).toEqual({ statements: 80 });
  });

  it('rejects statement coverage below the floor', () => {
    expect(() => validateGoCoverage(goProfile(
      'example.com/m/a.go:1.1,2.2 799 1',
      'example.com/m/a.go:3.1,4.2 201 0',
    ))).toThrow('Go statement coverage 79.9% is below 80%');
  });

  it('rejects statement coverage that only rounds up to the floor', () => {
    expect(() => validateGoCoverage(goProfile(
      'example.com/m/a.go:1.1,2.2 79996 1',
      'example.com/m/a.go:3.1,4.2 20004 0',
    ))).toThrow('Go statement coverage 79.99% is below 80%');
  });

  // A package listed by two test binaries appears twice; a block counts once,
  // and covered when any listing ran it.
  it('counts a repeated block once and covered when any listing ran it', () => {
    expect(validateGoCoverage(goProfile(
      'example.com/m/a.go:1.1,2.2 4 0',
      'example.com/m/a.go:1.1,2.2 4 3',
      'example.com/m/a.go:1.1,2.2 4 0',
      'example.com/m/a.go:3.1,4.2 1 0',
    ))).toEqual({ statements: 80 });
  });

  it.each([
    ['', 'Missing Go coverage mode line'],
    ['mode: atomic\n', 'Go coverage profile has no statements'],
    [goProfile('example.com/m/a.go:1.1,2.2 x 1'), 'Invalid Go coverage line: example.com/m/a.go:1.1,2.2 x 1'],
  ])('rejects a malformed Go profile: %#', (profile, message) => {
    expect(() => validateGoCoverage(profile)).toThrow(message);
  });
});

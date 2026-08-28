// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COVERAGE_THRESHOLDS,
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

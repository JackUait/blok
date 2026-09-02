import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBlockingCodeqlFindings } from '../../../scripts/check-codeql-results.mjs';

describe('getBlockingCodeqlFindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns high-severity security results', () => {
    const findings = getBlockingCodeqlFindings({
      runs: [{
        tool: {
          driver: {
            rules: [{
              id: 'js/incomplete-url-substring-sanitization',
              properties: { 'security-severity': '8.1' },
            }],
          },
        },
        results: [{
          ruleId: 'js/incomplete-url-substring-sanitization',
          message: { text: 'User-controlled URL bypasses validation' },
        }],
      }],
    });

    expect(findings).toEqual([{
      ruleId: 'js/incomplete-url-substring-sanitization',
      severity: 8.1,
      message: 'User-controlled URL bypasses validation',
    }]);
  });

  it('ignores results below the high-severity floor', () => {
    const findings = getBlockingCodeqlFindings({
      runs: [{
        tool: {
          driver: {
            rules: [{
              id: 'js/low-severity-result',
              properties: { 'security-severity': '4.0' },
            }],
          },
        },
        results: [{
          ruleId: 'js/low-severity-result',
          message: { text: 'Low severity result' },
        }],
      }],
    });

    expect(findings).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const COVERAGE_THRESHOLDS = Object.freeze({
  lines: 80,
  branches: 80,
});

const percentage = (coverageTag, attribute) => {
  const match = new RegExp(`\\b${attribute}="([^"]+)"`).exec(coverageTag);
  const rate = Number(match?.[1]);

  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(`Invalid Cobertura ${attribute}`);
  }

  return Number((rate * 100).toFixed(2));
};

export const validateServerCoverage = (
  xml,
  thresholds = COVERAGE_THRESHOLDS,
) => {
  const coverageTag = /<coverage\b[^>]*>/.exec(xml)?.[0];

  if (coverageTag === undefined) {
    throw new Error('Missing Cobertura coverage element');
  }

  const result = {
    lines: percentage(coverageTag, 'line-rate'),
    branches: percentage(coverageTag, 'branch-rate'),
  };

  if (result.lines < thresholds.lines) {
    throw new Error(
      `Line coverage ${result.lines}% is below ${thresholds.lines}%`,
    );
  }

  if (result.branches < thresholds.branches) {
    throw new Error(
      `Branch coverage ${result.branches}% is below ${thresholds.branches}%`,
    );
  }

  return result;
};

const main = () => {
  const path = process.argv[2];

  if (path === undefined || process.argv.length !== 3) {
    throw new Error('Usage: node scripts/check-server-coverage.mjs <cobertura.xml>');
  }

  const result = validateServerCoverage(readFileSync(path, 'utf8'));

  process.stdout.write(
    `Server coverage passed: ${result.lines}% lines, ` +
    `${result.branches}% branches.\n`,
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

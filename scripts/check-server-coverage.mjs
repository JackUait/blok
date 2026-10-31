import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const COVERAGE_THRESHOLDS = Object.freeze({
  lines: 80,
  branches: 80,
});

// Go measures statements only; it has no branch metric to hold a floor on.
export const GO_COVERAGE_THRESHOLDS = Object.freeze({
  statements: 80,
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

/**
 * Reads a `go test -coverprofile` file. A block listed more than once (one
 * package measured by several test binaries) counts once, and is covered
 * when any listing ran it. This is what `go tool cover -func` totals.
 */
export const validateGoCoverage = (
  profile,
  thresholds = GO_COVERAGE_THRESHOLDS,
) => {
  const [header, ...lines] = profile.split('\n');

  if (!/^mode: (?:set|count|atomic)$/.test(header ?? '')) {
    throw new Error('Missing Go coverage mode line');
  }

  const blocks = new Map();

  for (const line of lines) {
    if (line === '') {
      continue;
    }

    const match = /^(\S+:\d+\.\d+,\d+\.\d+) (\d+) (\d+)$/.exec(line);

    if (match === null) {
      throw new Error(`Invalid Go coverage line: ${line}`);
    }

    const [, block, statements, count] = match;
    const previous = blocks.get(block);

    blocks.set(block, {
      statements: Number(statements),
      covered: (previous?.covered ?? false) || Number(count) > 0,
    });
  }

  let total = 0;
  let covered = 0;

  for (const block of blocks.values()) {
    total += block.statements;
    covered += block.covered ? block.statements : 0;
  }

  if (total === 0) {
    throw new Error('Go coverage profile has no statements');
  }

  const statements = Number(((covered / total) * 100).toFixed(2));

  if (statements < thresholds.statements) {
    throw new Error(
      `Go statement coverage ${statements}% is below ${thresholds.statements}%`,
    );
  }

  return { statements };
};

const main = () => {
  const args = process.argv.slice(2);

  if (args.length === 2 && args[0] === '--go') {
    const result = validateGoCoverage(readFileSync(args[1], 'utf8'));

    process.stdout.write(
      `Go server coverage passed: ${result.statements}% statements.\n`,
    );
    return;
  }

  if (args.length !== 1) {
    throw new Error(
      'Usage: node scripts/check-server-coverage.mjs <cobertura.xml> | --go <coverprofile>',
    );
  }

  const result = validateServerCoverage(readFileSync(args[0], 'utf8'));

  process.stdout.write(
    `Server coverage passed: ${result.lines}% lines, ` +
    `${result.branches}% branches.\n`,
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

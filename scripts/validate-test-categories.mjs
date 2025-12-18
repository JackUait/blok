#!/usr/bin/env node

/**
 * Test Categorization Validation Script
 *
 * Ensures all E2E test files are categorized in playwright.config.ts.
 * This prevents tests from being accidentally excluded or miscategorized.
 *
 * Usage:
 *   node scripts/validate-test-categories.mjs
 *
 * Exit codes:
 *   0 - All tests are properly categorized
 *   1 - Uncategorized or duplicate tests found
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

/**
 * Get all E2E test files from the test directory
 */
function getTestFiles() {
  const testDir = join(rootDir, 'test/playwright/tests');
  const output = execSync(`find "${testDir}" -name "*.spec.ts" -type f`, {
    encoding: 'utf8',
    cwd: rootDir,
  });

  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(file => relative(join(rootDir, 'test/playwright/tests'), file));
}

/**
 * Parse the test patterns from playwright.config.ts
 */
function getTestPatterns() {
  const configPath = join(rootDir, 'playwright.config.ts');
  const configContent = readFileSync(configPath, 'utf8');

  const crossBrowserMatch = configContent.match(/const CROSS_BROWSER_TESTS = \[([\s\S]*?)\] as const/);
  const logicMatch = configContent.match(/const LOGIC_TESTS = \[([\s\S]*?)\] as const/);

  const extractPatterns = (match) => {
    if (!match) return [];
    return match[1]
      .split('\n')
      .map(line => line.match(/'([^']+)'/)?.[1])
      .filter(Boolean);
  };

  return {
    crossBrowser: extractPatterns(crossBrowserMatch),
    logic: extractPatterns(logicMatch),
  };
}

/**
 * Convert glob pattern to regex
 * Handles **, *, and ? wildcards
 */
function globToRegex(pattern) {
  // Remove leading **/ - we'll handle this by allowing match from start or after /
  let normalizedPattern = pattern.replace(/^\*\*\//, '');

  // Escape special regex characters (but not * and ?)
  let regexStr = '';
  for (let i = 0; i < normalizedPattern.length; i++) {
    const char = normalizedPattern[i];
    const nextChar = normalizedPattern[i + 1];

    if (char === '*' && nextChar === '*') {
      // ** matches anything including /
      regexStr += '.*';
      i++; // Skip next *
      // Skip following / if present
      if (normalizedPattern[i + 1] === '/') {
        i++;
      }
    } else if (char === '*') {
      // * matches anything except /
      regexStr += '[^/]*';
    } else if (char === '?') {
      regexStr += '.';
    } else if ('.+^${}()|[]\\'.includes(char)) {
      regexStr += '\\' + char;
    } else {
      regexStr += char;
    }
  }

  // Pattern should match the entire path or path starting after any directory
  return new RegExp(`^(.*\\/)?${regexStr}$`);
}

/**
 * Check if a file matches any of the given patterns
 */
function matchesPatterns(file, patterns) {
  return patterns.some(pattern => {
    const regex = globToRegex(pattern);
    const matches = regex.test(file);
    return matches;
  });
}

function main() {
  console.log('Validating E2E test categorization...\n');

  const testFiles = getTestFiles();
  const patterns = getTestPatterns();

  const uncategorized = [];
  const duplicates = [];
  const crossBrowserFiles = [];
  const logicFiles = [];

  for (const file of testFiles) {
    const inCrossBrowser = matchesPatterns(file, patterns.crossBrowser);
    const inLogic = matchesPatterns(file, patterns.logic);

    if (inCrossBrowser && inLogic) {
      duplicates.push(file);
    } else if (inCrossBrowser) {
      crossBrowserFiles.push(file);
    } else if (inLogic) {
      logicFiles.push(file);
    } else {
      uncategorized.push(file);
    }
  }

  // Report results
  console.log(`Found ${testFiles.length} test files:\n`);
  console.log(`  Cross-browser tests: ${crossBrowserFiles.length}`);
  console.log(`  Logic-only tests:    ${logicFiles.length}`);

  let hasErrors = false;

  if (uncategorized.length > 0) {
    hasErrors = true;
    console.log(`\n${uncategorized.length} UNCATEGORIZED test(s) found:`);
    uncategorized.forEach(file => console.log(`  - ${file}`));
    console.log('\nAdd these to CROSS_BROWSER_TESTS or LOGIC_TESTS in playwright.config.ts');
    console.log('  - CROSS_BROWSER_TESTS: Tests involving browser-specific behavior');
    console.log('  - LOGIC_TESTS: Pure JavaScript/API tests (browser-agnostic)');
  }

  if (duplicates.length > 0) {
    hasErrors = true;
    console.log(`\n${duplicates.length} DUPLICATE categorization(s) found:`);
    duplicates.forEach(file => console.log(`  - ${file}`));
    console.log('\nRemove duplicates - each test should be in only one category.');
  }

  if (hasErrors) {
    console.log('\nValidation FAILED');
    process.exit(1);
  }

  console.log('\nAll tests properly categorized!');
  process.exit(0);
}

main();

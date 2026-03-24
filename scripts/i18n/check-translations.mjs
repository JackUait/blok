#!/usr/bin/env node

/**
 * Translation completeness checker
 *
 * Validates that all locale translation files have the same keys as the English source of truth.
 * Reports missing keys (error) and extra keys (warning).
 *
 * Usage: node scripts/i18n/check-translations.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '../../src/components/i18n/locales');
const SOURCE_LOCALE = 'en';
const SRC_DIR = join(__dirname, '../../src');

// ANSI color codes
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

/**
 * Recursively extracts all leaf keys from a nested object as dot-notation paths
 * @param {object} obj - The object to extract keys from
 * @param {string} prefix - Current path prefix
 * @returns {Set<string>} Set of dot-notation key paths
 */
function extractKeys(obj, prefix = '') {
  const keys = new Set();

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // Recurse into nested objects
      for (const nestedKey of extractKeys(value, path)) {
        keys.add(nestedKey);
      }
    } else {
      // Leaf node (string or other primitive)
      keys.add(path);
    }
  }

  return keys;
}

/**
 * Loads and parses a JSON translation file
 * @param {string} locale - Locale code (e.g., 'en', 'ru')
 * @returns {object} Parsed JSON content
 */
function loadTranslation(locale) {
  const filePath = join(LOCALES_DIR, locale, 'messages.json');
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Gets all available locales from the locales directory
 * @returns {string[]} Array of locale codes
 */
function getAvailableLocales() {
  return readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * Extracts all statically-known i18n keys from a TypeScript source string.
 * Matches .t('key') and .t("key") — skips dynamic arguments.
 *
 * @param {string} source - File contents as a string
 * @returns {Set<string>} Set of key strings found
 */
export function extractKeysFromSource(source) {
  const keys = new Set();
  // Match .t('key') or .t("key") — require opening paren immediately after t
  const regex = /\.t\((['"])([^'"]+)\1/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const key = match[2];
    if (key.includes('.') && !key.endsWith('.')) {
      keys.add(key);
    }
  }
  return keys;
}

/**
 * Recursively scans a directory for .ts files and collects all static i18n keys.
 *
 * @param {string} dir - Directory to scan
 * @returns {Set<string>} Combined set of all keys found
 */
export function scanSourceKeys(dir) {
  const keys = new Set();

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      for (const key of scanSourceKeys(fullPath)) {
        keys.add(key);
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const source = readFileSync(fullPath, 'utf-8');
      for (const key of extractKeysFromSource(source)) {
        keys.add(key);
      }
    }
  }

  return keys;
}

/**
 * Phase 2: Verifies that all static i18n keys used in source code exist in en/messages.json.
 *
 * @param {Set<string>} sourceKeys - Keys defined in en/messages.json
 * @returns {boolean} True if errors were found
 */
function checkKeyCoverage(sourceKeys) {
  console.log(`${colors.dim}Scanning source code for i18n key usage...${colors.reset}\n`);

  const usedKeys = scanSourceKeys(SRC_DIR);

  console.log(`${colors.dim}Found ${usedKeys.size} unique static key references in source${colors.reset}\n`);

  // Keys used in code but not defined in en/messages.json
  const missingFromSource = [...usedKeys].filter((key) => !sourceKeys.has(key));

  // Keys defined in en/messages.json but not referenced in code (warning only)
  const unusedInCode = [...sourceKeys].filter((key) => !usedKeys.has(key));

  let hasErrors = false;

  if (missingFromSource.length === 0) {
    console.log(`${colors.green}✓${colors.reset} All source keys are defined in en/messages.json`);
  } else {
    hasErrors = true;
    console.log(
      `${colors.red}✗${colors.reset} ${missingFromSource.length} key${missingFromSource.length === 1 ? '' : 's'} used in source but missing from en/messages.json:`
    );
    for (const key of missingFromSource.sort()) {
      console.log(`  ${colors.red}-${colors.reset} ${key}`);
    }
  }

  if (unusedInCode.length > 0) {
    console.log(
      `\n${colors.yellow}⚠${colors.reset} ${unusedInCode.length} key${unusedInCode.length === 1 ? '' : 's'} in en/messages.json not found in static source scan (may be dynamic):`
    );
    for (const key of unusedInCode.sort()) {
      console.log(`  ${colors.yellow}?${colors.reset} ${key}`);
    }
  }

  console.log('');
  return hasErrors;
}

/**
 * Main validation function
 */
function main() {
  console.log(`\n${colors.dim}Checking translation completeness...${colors.reset}\n`);
  console.log(`${colors.dim}Source of truth: ${SOURCE_LOCALE}/messages.json${colors.reset}\n`);

  // Load source translation
  const sourceTranslation = loadTranslation(SOURCE_LOCALE);
  const sourceKeys = extractKeys(sourceTranslation);

  console.log(`${colors.dim}Found ${sourceKeys.size} keys in source${colors.reset}\n`);

  // --- Phase 1: locale completeness ---

  const locales = getAvailableLocales().filter((locale) => locale !== SOURCE_LOCALE);

  let hasErrors = false;
  let hasWarnings = false;

  for (const locale of locales) {
    const translation = loadTranslation(locale);
    const translationKeys = extractKeys(translation);

    const missingKeys = [...sourceKeys].filter((key) => !translationKeys.has(key));
    const extraKeys = [...translationKeys].filter((key) => !sourceKeys.has(key));

    if (missingKeys.length === 0 && extraKeys.length === 0) {
      console.log(`${colors.green}✓${colors.reset} ${locale}: All ${sourceKeys.size} keys present`);
    } else {
      if (missingKeys.length > 0) {
        hasErrors = true;
        console.log(
          `${colors.red}✗${colors.reset} ${locale}: Missing ${missingKeys.length} key${missingKeys.length === 1 ? '' : 's'}`
        );
        for (const key of missingKeys.sort()) {
          console.log(`  ${colors.red}-${colors.reset} ${key}`);
        }
      }

      if (extraKeys.length > 0) {
        hasWarnings = true;
        const prefix = missingKeys.length > 0 ? '  ' : '';
        console.log(
          `${prefix}${colors.yellow}⚠${colors.reset} ${locale}: ${extraKeys.length} extra key${extraKeys.length === 1 ? '' : 's'} (not in source)`
        );
        for (const key of extraKeys.sort()) {
          console.log(`  ${colors.yellow}+${colors.reset} ${key}`);
        }
      }
    }
  }

  console.log('');

  if (hasErrors) {
    console.log(
      `${colors.red}Translation check failed.${colors.reset} Add missing keys to the translation files.\n`
    );
  } else if (hasWarnings) {
    console.log(
      `${colors.yellow}Translation check passed with warnings.${colors.reset} Consider removing extra keys.\n`
    );
  } else {
    console.log(`${colors.green}All translations are complete!${colors.reset}\n`);
  }

  // --- Phase 2: source key coverage ---

  console.log(`${colors.dim}${'─'.repeat(60)}${colors.reset}\n`);
  console.log(`${colors.dim}Checking source key coverage...${colors.reset}\n`);

  const coverageErrors = checkKeyCoverage(sourceKeys);

  if (coverageErrors) {
    console.log(
      `${colors.red}Source coverage check failed.${colors.reset} Add missing keys to en/messages.json.\n`
    );
    hasErrors = true;
  } else {
    console.log(`${colors.green}Source coverage check passed!${colors.reset}\n`);
  }

  if (hasErrors) {
    process.exit(1);
  }
}

// Only run when executed directly (not imported by tests)
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}

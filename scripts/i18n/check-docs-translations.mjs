#!/usr/bin/env node

/**
 * Docs translation completeness checker
 *
 * Validates that all locale files in docs/src/i18n/ have the same keys as the
 * English source of truth (en.json). Automatically discovers any .json locale
 * files present — adding a new language requires no changes to this script.
 *
 * Reports missing keys (error → exit 1) and extra keys (warning → exit 0).
 *
 * Usage: node scripts/i18n/check-docs-translations.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const LOCALES_DIR = join(__dirname, '../../docs/src/i18n');
const SOURCE_LOCALE = 'en';

// ANSI color codes
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

/**
 * Recursively extracts all leaf keys from a nested object as dot-notation paths.
 *
 * @param {Record<string, unknown>} obj - The object to extract keys from
 * @param {string} prefix - Current path prefix (used during recursion)
 * @returns {Set<string>} Set of dot-notation key paths
 */
export function extractKeys(obj, prefix = '') {
  const keys = new Set();

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const nestedKey of extractKeys(/** @type {Record<string, unknown>} */ (value), path)) {
        keys.add(nestedKey);
      }
    } else {
      keys.add(path);
    }
  }

  return keys;
}

/**
 * Returns keys that are in source but missing from target, sorted alphabetically.
 *
 * @param {Set<string>} sourceKeys
 * @param {Set<string>} targetKeys
 * @returns {string[]}
 */
export function findMissingKeys(sourceKeys, targetKeys) {
  return [...sourceKeys].filter((key) => !targetKeys.has(key)).sort();
}

/**
 * Returns keys that are in target but not in source, sorted alphabetically.
 *
 * @param {Set<string>} sourceKeys
 * @param {Set<string>} targetKeys
 * @returns {string[]}
 */
export function findExtraKeys(sourceKeys, targetKeys) {
  return [...targetKeys].filter((key) => !sourceKeys.has(key)).sort();
}

/**
 * Discovers all locale codes available in a directory by listing *.json files,
 * then excluding the source locale.
 *
 * This is future-proof: adding a new language (e.g. zh.json, de.json) is
 * automatically detected without any changes to this script.
 *
 * @param {string} dir - Directory to scan
 * @param {string} sourceLocale - The reference locale to exclude (e.g. 'en')
 * @returns {string[]} Array of locale codes (filenames without .json extension)
 */
export function discoverLocales(dir, sourceLocale) {
  return readdirSync(dir)
    .filter((file) => extname(file) === '.json' && basename(file, '.json') !== sourceLocale)
    .map((file) => basename(file, '.json'));
}

/**
 * Loads and parses a locale JSON file.
 *
 * @param {string} dir - Directory containing locale files
 * @param {string} locale - Locale code (e.g. 'en', 'ru')
 * @returns {Record<string, unknown>}
 */
function loadLocale(dir, locale) {
  const filePath = join(dir, `${locale}.json`);
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Main validation function. Reads the source locale, discovers all others,
 * and reports missing/extra keys per locale.
 *
 * Exits 1 if any locale has missing keys.
 * Exits 0 with warnings if any locale has extra keys only.
 */
function main() {
  console.log(`\n${colors.dim}Checking docs translation completeness...${colors.reset}`);
  console.log(`${colors.dim}Directory: ${LOCALES_DIR}${colors.reset}`);
  console.log(`${colors.dim}Source of truth: ${SOURCE_LOCALE}.json${colors.reset}\n`);

  const sourceData = loadLocale(LOCALES_DIR, SOURCE_LOCALE);
  const sourceKeys = extractKeys(sourceData);

  console.log(`${colors.dim}Found ${sourceKeys.size} keys in ${SOURCE_LOCALE}.json${colors.reset}\n`);

  const locales = discoverLocales(LOCALES_DIR, SOURCE_LOCALE);

  if (locales.length === 0) {
    console.log(`${colors.yellow}⚠${colors.reset} No other locale files found. Nothing to check.\n`);
    return;
  }

  let hasErrors = false;
  let hasWarnings = false;

  for (const locale of locales.sort()) {
    const data = loadLocale(LOCALES_DIR, locale);
    const keys = extractKeys(data);

    const missing = findMissingKeys(sourceKeys, keys);
    const extra = findExtraKeys(sourceKeys, keys);

    if (missing.length === 0 && extra.length === 0) {
      console.log(`${colors.green}✓${colors.reset} ${locale}.json — all ${sourceKeys.size} keys present`);
    } else {
      if (missing.length > 0) {
        hasErrors = true;
        console.log(
          `${colors.red}✗${colors.reset} ${locale}.json — missing ${missing.length} key${missing.length === 1 ? '' : 's'}:`
        );
        for (const key of missing) {
          console.log(`  ${colors.red}-${colors.reset} ${key}`);
        }
      }

      if (extra.length > 0) {
        hasWarnings = true;
        const indent = missing.length > 0 ? '  ' : '';
        console.log(
          `${indent}${colors.yellow}⚠${colors.reset} ${locale}.json — ${extra.length} extra key${extra.length === 1 ? '' : 's'} (not in ${SOURCE_LOCALE}.json):`
        );
        for (const key of extra) {
          console.log(`  ${colors.yellow}+${colors.reset} ${key}`);
        }
      }
    }
  }

  console.log('');

  if (hasErrors) {
    console.log(
      `${colors.red}Docs translation check failed.${colors.reset} Add missing keys to the locale files listed above.\n`
    );
    process.exit(1);
  } else if (hasWarnings) {
    console.log(
      `${colors.yellow}Docs translation check passed with warnings.${colors.reset} Consider removing extra keys.\n`
    );
  } else {
    console.log(`${colors.green}All docs translations are complete!${colors.reset}\n`);
  }
}

// Only run main() when this file is executed directly (not when imported for tests)
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}

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
 * Main validation function
 */
function main() {
  console.log(`\n${colors.dim}Checking translation completeness...${colors.reset}\n`);
  console.log(`${colors.dim}Source of truth: ${SOURCE_LOCALE}/messages.json${colors.reset}\n`);

  // Load source translation
  const sourceTranslation = loadTranslation(SOURCE_LOCALE);
  const sourceKeys = extractKeys(sourceTranslation);

  console.log(`${colors.dim}Found ${sourceKeys.size} keys in source${colors.reset}\n`);

  // Get all locales except source
  const locales = getAvailableLocales().filter((locale) => locale !== SOURCE_LOCALE);

  let hasErrors = false;
  let hasWarnings = false;

  for (const locale of locales) {
    const translation = loadTranslation(locale);
    const translationKeys = extractKeys(translation);

    // Find missing keys (in source but not in translation)
    const missingKeys = [...sourceKeys].filter((key) => !translationKeys.has(key));

    // Find extra keys (in translation but not in source)
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
    process.exit(1);
  } else if (hasWarnings) {
    console.log(
      `${colors.yellow}Translation check passed with warnings.${colors.reset} Consider removing extra keys.\n`
    );
  } else {
    console.log(`${colors.green}All translations are complete!${colors.reset}\n`);
  }
}

main();

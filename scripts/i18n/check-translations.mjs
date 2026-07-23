#!/usr/bin/env node

/**
 * Translation completeness checker
 *
 * Validates locale completeness and structural integrity against the English source of truth.
 * Reports missing keys and integrity findings as errors, and extra keys as warnings.
 *
 * Usage: node scripts/i18n/check-translations.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '../../src/components/i18n/locales');
const SOURCE_LOCALE = 'en';
const SRC_DIR = join(__dirname, '../../src');

const EMPTY_KEY_SET = new Set();
const BOUNDARY_WHITESPACE_EXCEPTIONS_BY_LOCALE = {
  ja: new Set([
    'blockSettings.orConjunction',
    'blockSettings.openMenuAction',
  ]),
  ko: new Set([
    'blockSettings.openMenuAction',
  ]),
};

/**
 * Returns narrowly reviewed exceptions for fragments whose target-language
 * orthography must not copy the English source's boundary spaces.
 *
 * @param {string} locale - Locale code
 * @returns {ReadonlySet<string>} Translation keys exempted for this locale
 */
export function getBoundaryWhitespaceExceptions(locale) {
  return BOUNDARY_WHITESPACE_EXCEPTIONS_BY_LOCALE[locale] ?? EMPTY_KEY_SET;
}

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
 * Loads the raw and parsed forms of a JSON translation file.
 *
 * @param {string} locale - Locale code (e.g., 'en', 'ru')
 * @returns {{
 *   raw: string,
 *   translation: Record<string, unknown>,
 *   invalidRoot: boolean
 * }} Raw JSON, safe dictionary, and root validation result
 */
function loadTranslationFile(locale) {
  const filePath = join(LOCALES_DIR, locale, 'messages.json');
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  const invalidRoot =
    parsed === null || typeof parsed !== 'object' || Array.isArray(parsed);

  return {
    raw,
    translation: invalidRoot ? {} : parsed,
    invalidRoot,
  };
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
 * Extracts a sorted multiset of curly-brace placeholders from a message.
 *
 * @param {string} value - Translation message
 * @returns {string[]} Sorted placeholder names, including duplicates
 */
export function extractPlaceholders(value) {
  return [...value.matchAll(/\{([^{}]+)\}/g)]
    .map((match) => match[1])
    .filter((placeholder) => placeholder !== undefined)
    .sort();
}

/**
 * Finds duplicate keys in a flat locale JSON object.
 *
 * @param {string} raw - Raw JSON file contents
 * @returns {string[]} Duplicate keys
 */
export function findDuplicateJsonKeys(raw) {
  const counts = new Map();
  let depth = 0;

  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];

    if (character === '"') {
      const start = index;
      let escaped = false;

      for (index += 1; index < raw.length; index++) {
        const stringCharacter = raw[index];

        if (escaped) {
          escaped = false;
        } else if (stringCharacter === '\\') {
          escaped = true;
        } else if (stringCharacter === '"') {
          break;
        }
      }

      let next = index + 1;
      while (/\s/u.test(raw[next] ?? '')) next += 1;

      if (depth === 1 && raw[next] === ':') {
        const key = JSON.parse(raw.slice(start, index + 1));
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      continue;
    }

    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
}

/**
 * Finds structural integrity issues in a locale relative to the source locale.
 *
 * @param {Record<string, string>} sourceTranslation - Source key-values
 * @param {Record<string, unknown>} translation - Target locale key-values
 * @param {{boundaryWhitespaceExceptions?: ReadonlySet<string>}} [options] - Reviewed structural exceptions
 * @returns {Array<{key: string, kind: string, value: unknown}>} Detected issues
 */
export function findLocaleIntegrityIssues(sourceTranslation, translation, options = {}) {
  const issues = [];
  const controls = /[\u0000-\u001F\u007F]/u;
  const boundaryWhitespaceExceptions =
    options.boundaryWhitespaceExceptions ?? EMPTY_KEY_SET;
  const edgeWhitespace = (value) => ({
    leading: value.match(/^\s*/u)?.[0] ?? '',
    trailing: value.match(/\s*$/u)?.[0] ?? '',
  });
  for (const key of Object.keys(translation)) {
    const sourceValue = sourceTranslation[key];
    const value = translation[key];

    if (typeof value !== 'string') {
      issues.push({ key, kind: 'non-string', value });
      continue;
    }

    if (value.trim() === '') {
      issues.push({ key, kind: 'empty', value });
    }

    if (typeof sourceValue === 'string') {
      if (
        JSON.stringify(extractPlaceholders(value)) !==
        JSON.stringify(extractPlaceholders(sourceValue))
      ) {
        issues.push({ key, kind: 'placeholder-mismatch', value });
      }

      const sourceEdgeWhitespace = edgeWhitespace(sourceValue);
      const translatedEdgeWhitespace = edgeWhitespace(value);
      const replacesLeadingSpaceWithPunctuation =
        sourceEdgeWhitespace.leading !== '' &&
        translatedEdgeWhitespace.leading === '' &&
        /^\p{P}\s/u.test(value) &&
        sourceEdgeWhitespace.trailing === translatedEdgeWhitespace.trailing;

      if (
        JSON.stringify(translatedEdgeWhitespace) !==
          JSON.stringify(sourceEdgeWhitespace) &&
        !replacesLeadingSpaceWithPunctuation &&
        !boundaryWhitespaceExceptions.has(key)
      ) {
        issues.push({ key, kind: 'boundary-whitespace', value });
      }
    }

    if (value !== value.normalize('NFC')) {
      issues.push({ key, kind: 'non-nfc', value });
    }

    if (value.includes('\uFFFD')) {
      issues.push({ key, kind: 'replacement-character', value });
    }

    if (controls.test(value)) {
      issues.push({ key, kind: 'control-character', value });
    }
  }

  return issues;
}

/**
 * Detects double-encoded UTF-8 values in a translation object.
 *
 * Double-encoding occurs when UTF-8 bytes are misinterpreted as Latin-1 and
 * re-encoded to UTF-8. This produces mojibake like "Ð¦Ð²ÐµÑ" instead of "Цвет".
 *
 * Uses round-trip verification: decode as latin1 → re-encode as utf8 → compare
 * to original. Only true double-encoding round-trips cleanly.
 *
 * @param {Record<string, unknown>} translation - Flat key-value translation object
 * @returns {Array<{key: string, value: string, corrected: string}>} Detected issues
 */
export function detectDoubleEncoding(translation) {
  const issues = [];

  for (const [key, value] of Object.entries(translation)) {
    if (typeof value !== 'string') continue;

    // Only check values with characters above ASCII (potential multi-byte)
    if (!/[^\x00-\x7F]/.test(value)) continue;

    // Check if all non-ASCII codepoints fall within Latin-1 range (U+0080–U+00FF).
    // Correctly-encoded non-Latin scripts (Tamil, Japanese, Arabic, etc.) use codepoints
    // well above U+00FF, so they are excluded immediately — no false positives.
    const hasHighCodepoints = [...value].some((ch) => ch.codePointAt(0) > 0xff);
    if (hasHighCodepoints) continue;

    // All codepoints are within Latin-1 range — attempt round-trip decode
    const buf = Buffer.from(value, 'latin1');
    const decoded = buf.toString('utf8');

    // Must not produce replacement characters (U+FFFD)
    if (decoded.includes('\ufffd')) continue;

    // Must differ from original (if identical, it's just ASCII/Latin-1 text)
    if (decoded === value) continue;

    // Round-trip: re-encoding the decoded string should reproduce the original
    const roundTrip = Buffer.from(decoded, 'utf8').toString('latin1');
    if (roundTrip === value) {
      issues.push({ key, value, corrected: decoded });
    }
  }

  return issues;
}

/**
 * Finds translation keys whose values are identical to the English source.
 *
 * @param {Record<string, string>} sourceTranslation - English source key-values
 * @param {Record<string, string>} translation - Target locale key-values
 * @returns {string[]} Keys with values identical to English
 */
export function findUntranslatedKeys(sourceTranslation, translation) {
  const untranslated = [];

  for (const [key, sourceValue] of Object.entries(sourceTranslation)) {
    if (key in translation && translation[key] === sourceValue) {
      untranslated.push(key);
    }
  }

  return untranslated;
}

/**
 * Extracts all statically-known i18n keys from a TypeScript source string.
 * Matches .t('key'), .t("key"), shared tool-helper calls such as
 * tr(i18n, 'key', 'fallback'), local string constants passed to either form,
 * and literal tool titleKey assignments. Short titleKeys resolve through the
 * toolNames namespace. Other dynamic arguments and template literals are
 * skipped.
 *
 * @param {string} source - File contents as a string
 * @returns {Set<string>} Set of key strings found
 */
export function extractKeysFromSource(source) {
  const keys = new Set();
  const addQualifiedKey = (key) => {
    if (key.includes('.') && !key.endsWith('.')) {
      keys.add(key);
    }
  };

  /**
   * Resolve the string initializer for the lexical symbol referenced by a
   * translation call. The type checker keeps shadowed declarations distinct
   * and the AST excludes commented-out code.
   *
   * @param {import('typescript').Identifier} identifier
   * @param {import('typescript').TypeChecker} checker
   * @returns {string | undefined}
   */
  const resolveLocalStringConstant = (identifier, checker) => {
    const symbol = checker.getSymbolAtLocation(identifier);
    const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);

    if (
      declaration === undefined ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      (declaration.parent.flags & ts.NodeFlags.Const) === 0
    ) {
      return undefined;
    }

    let initializer = declaration.initializer;

    while (
      initializer !== undefined &&
      (ts.isAsExpression(initializer) ||
        ts.isSatisfiesExpression(initializer) ||
        ts.isTypeAssertionExpression(initializer) ||
        ts.isParenthesizedExpression(initializer))
    ) {
      initializer = initializer.expression;
    }

    return initializer !== undefined && ts.isStringLiteral(initializer)
      ? initializer.text
      : undefined;
  };

  const fileName = 'translation-source.ts';
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const compilerHost = {
    getSourceFile: (name) => (name === fileName ? sourceFile : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    fileExists: (name) => name === fileName,
    readFile: (name) => (name === fileName ? source : undefined),
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const program = ts.createProgram(
    [fileName],
    {
      noLib: true,
      noResolve: true,
      target: ts.ScriptTarget.Latest,
    },
    compilerHost
  );
  const checker = program.getTypeChecker();
  const toolHelperSymbols = new Set();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== './i18n' ||
      statement.importClause?.namedBindings === undefined ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }

    for (const specifier of statement.importClause.namedBindings.elements) {
      if ((specifier.propertyName ?? specifier.name).text === 'tr') {
        const symbol = checker.getSymbolAtLocation(specifier.name);

        if (symbol !== undefined) toolHelperSymbols.add(symbol);
      }
    }
  }

  const visitTranslationCalls = (node) => {
    if (ts.isCallExpression(node)) {
      const isMethodCall =
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 't';
      const isToolHelperCall =
        ts.isIdentifier(node.expression) &&
        toolHelperSymbols.has(checker.getSymbolAtLocation(node.expression));
      const argument = isMethodCall
        ? node.arguments[0]
        : isToolHelperCall
          ? node.arguments[1]
          : undefined;
      const key =
        argument !== undefined && ts.isStringLiteral(argument)
          ? argument.text
          : argument !== undefined && ts.isIdentifier(argument)
            ? resolveLocalStringConstant(argument, checker)
            : undefined;

      if (key !== undefined) {
        addQualifiedKey(key);
      }
    }

    ts.forEachChild(node, visitTranslationCalls);
  };

  visitTranslationCalls(sourceFile);

  let match;

  // Built-in tools declare translation keys either as a static class property
  // or as a toolbox object property. A short key is defined by the runtime
  // contract to resolve as toolNames.<key>.
  const titleKeyPattern = /\btitleKey\s*(?:=|:)\s*(['"])([^'"]+)\1/g;

  while ((match = titleKeyPattern.exec(source)) !== null) {
    const key = match[2];
    const qualifiedKey = key.includes('.') ? key : `toolNames.${key}`;

    addQualifiedKey(qualifiedKey);
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
 * Phase 3: Verifies that all static i18n keys used in source code exist in en/messages.json.
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

  const availableLocales = getAvailableLocales();
  const localeFiles = new Map(
    availableLocales.map((locale) => [locale, loadTranslationFile(locale)])
  );
  const sourceTranslation = localeFiles.get(SOURCE_LOCALE).translation;
  const sourceKeys = extractKeys(sourceTranslation);

  console.log(`${colors.dim}Found ${sourceKeys.size} keys in source${colors.reset}\n`);

  // --- Phase 1: locale completeness ---

  const locales = availableLocales.filter((locale) => locale !== SOURCE_LOCALE);

  let hasErrors = false;
  let hasWarnings = false;

  for (const locale of locales) {
    const translation = localeFiles.get(locale).translation;
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

  // --- Phase 2: locale integrity ---

  console.log(`${colors.dim}${'─'.repeat(60)}${colors.reset}\n`);
  console.log(`${colors.dim}Checking locale integrity...${colors.reset}\n`);

  let integrityErrors = false;

  for (const locale of availableLocales) {
    const { raw, translation, invalidRoot } = localeFiles.get(locale);
    const duplicateKeys = findDuplicateJsonKeys(raw);
    const integrityIssues = findLocaleIntegrityIssues(sourceTranslation, translation, {
      boundaryWhitespaceExceptions: getBoundaryWhitespaceExceptions(locale),
    });

    if (invalidRoot) {
      integrityErrors = true;
      console.log(
        `${colors.red}✗${colors.reset} ${locale}:<root>: invalid-root`
      );
    }

    for (const key of duplicateKeys) {
      integrityErrors = true;
      console.log(
        `${colors.red}✗${colors.reset} ${locale}:${key}: duplicate-json-key`
      );
    }

    for (const issue of integrityIssues) {
      integrityErrors = true;
      console.log(
        `${colors.red}✗${colors.reset} ${locale}:${issue.key}: ${issue.kind}`
      );
    }
  }

  if (integrityErrors) {
    console.log(
      `\n${colors.red}Locale integrity check failed.${colors.reset} Fix the reported locale values.\n`
    );
    hasErrors = true;
  } else {
    console.log(`${colors.green}Locale integrity check passed!${colors.reset}\n`);
  }

  // --- Phase 3: source key coverage ---

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

  // --- Phase 4: encoding quality ---

  console.log(`${colors.dim}${'─'.repeat(60)}${colors.reset}\n`);
  console.log(`${colors.dim}Checking encoding quality...${colors.reset}\n`);

  let encodingErrors = false;
  let untranslatedWarnings = false;

  for (const locale of locales) {
    const translation = localeFiles.get(locale).translation;

    // Check for double-encoded values
    const doubleEncoded = detectDoubleEncoding(translation);
    if (doubleEncoded.length > 0) {
      encodingErrors = true;
      console.log(
        `${colors.red}✗${colors.reset} ${locale}: ${doubleEncoded.length} double-encoded value${doubleEncoded.length === 1 ? '' : 's'}`
      );
      for (const issue of doubleEncoded) {
        console.log(`  ${colors.red}-${colors.reset} ${issue.key}: "${issue.value}" → should be "${issue.corrected}"`);
      }
    }

    // Check for untranslated values (identical to English)
    const untranslated = findUntranslatedKeys(sourceTranslation, translation);
    if (untranslated.length > 0) {
      untranslatedWarnings = true;
      console.log(
        `${colors.yellow}⚠${colors.reset} ${locale}: ${untranslated.length} untranslated value${untranslated.length === 1 ? '' : 's'} (identical to English)`
      );
    }
  }

  if (encodingErrors) {
    console.log(
      `\n${colors.red}Encoding quality check failed.${colors.reset} Fix double-encoded values.\n`
    );
    hasErrors = true;
  } else if (untranslatedWarnings) {
    console.log(
      `\n${colors.yellow}Encoding quality check passed with warnings.${colors.reset} Consider translating values identical to English.\n`
    );
  } else {
    console.log(`${colors.green}Encoding quality check passed!${colors.reset}\n`);
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

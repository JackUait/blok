#!/usr/bin/env node

/**
 * EditorJS to Blok Codemod
 *
 * This script automates the migration from EditorJS to Blok.
 * It transforms imports, class names, selectors, data attributes, and text references.
 *
 * Usage:
 *   npx -p @jackuait/blok migrate-from-editorjs [path] [options]
 *
 * Options:
 *   --dry-run    Show changes without modifying files
 *   --verbose    Show detailed output
 *   --help       Show help
 *
 * Examples:
 *   npx -p @jackuait/blok migrate-from-editorjs ./src
 *   npx -p @jackuait/blok migrate-from-editorjs ./src --dry-run
 *   npx -p @jackuait/blok migrate-from-editorjs .
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// Configuration
// ============================================================================

const FILE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.html', '.css', '.scss', '.less'];

// ============================================================================
// i18n Transformation Utilities
// ============================================================================

/**
 * EditorJS to Blok key mappings for keys that changed.
 * These are applied after flattening to convert EditorJS keys to Blok equivalents.
 *
 * EditorJS keys reference: https://editorjs.io/i18n/
 * Blok keys reference: src/components/i18n/locales/en/messages.json
 */
const I18N_KEY_MAPPINGS = {
  // UI keys that changed
  'ui.blockTunes.toggler.Click to tune': 'blockSettings.clickToOpenMenu',
  'ui.blockTunes.toggler.or drag to move': 'blockSettings.dragToMove',
  'ui.toolbar.toolbox.Add': 'toolbox.addBelow',
  'ui.inlineToolbar.converter.Convert to': 'popover.convertTo',
  'ui.popover.Filter': 'popover.search',

  // Tool names that changed (EditorJS uses different casing/wording)
  'toolNames.Ordered List': 'toolNames.numberedList',
  'toolNames.Unordered List': 'toolNames.bulletedList',

  // Tools messages that changed
  'tools.stub.The block can not be displayed correctly': 'tools.stub.blockCannotBeDisplayed',
  'tools.stub.The block can not be displayed correctly.': 'tools.stub.blockCannotBeDisplayed',

  // Block tunes that changed in Blok
  'blockTunes.delete.Delete': 'blockSettings.delete',

  // Block tunes that are removed in Blok (moveUp/moveDown replaced with drag)
  // These are mapped to null to indicate they should be removed
  'blockTunes.moveUp.Move up': null,
  'blockTunes.moveDown.Move down': null,
};

/**
 * Namespace mappings from old verbose prefixes to new simplified prefixes.
 * Applied after camelCase normalization.
 */
const NAMESPACE_MAPPINGS = {
  'ui.blockTunes.toggler': 'blockSettings',
  'ui.toolbar.toolbox': 'toolbox',
  'ui.popover': 'popover',
  'blockTunes': 'blockSettings',
};

/**
 * Converts an EditorJS-style key (with English text) to Blok-style (camelCase).
 * Blok uses camelCase for the final segment of translation keys.
 * Also applies namespace simplification for known verbose prefixes.
 * Example: 'ui.popover.Nothing found' → 'popover.nothingFound'
 * Example: 'toolNames.Text' → 'toolNames.text'
 * @param {string} key - The dot-notation key with English text
 * @returns {string} The normalized key with camelCase final segment
 */
function normalizeKey(key) {
  const parts = key.split('.');
  const lastPart = parts[parts.length - 1];

  // Convert "Nothing found" → "nothingFound", "Text" → "text"
  const words = lastPart.split(/\s+/);
  const camelCase = words
    .map((word, i) => {
      if (i === 0) {
        // First word is lowercase
        return word.toLowerCase();
      }
      // Subsequent words have first letter capitalized
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join('');

  parts[parts.length - 1] = camelCase;
  let normalizedKey = parts.join('.');

  // Apply namespace mappings (longest prefix first for correct matching)
  const sortedPrefixes = Object.keys(NAMESPACE_MAPPINGS).sort((a, b) => b.length - a.length);
  for (const oldPrefix of sortedPrefixes) {
    if (normalizedKey.startsWith(oldPrefix + '.')) {
      normalizedKey = NAMESPACE_MAPPINGS[oldPrefix] + normalizedKey.slice(oldPrefix.length);
      break;
    }
  }

  return normalizedKey;
}

/**
 * Flattens a nested i18n dictionary object to Blok's flat dot-notation format.
 * @param {Object} obj - The nested dictionary object
 * @param {string} prefix - Current key prefix (for recursion)
 * @returns {Object} Flattened dictionary with dot-notation keys
 */
function flattenI18nDictionary(obj, prefix = '') {
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenI18nDictionary(value, newKey));
    } else {
      // Check explicit mappings first, otherwise normalize to camelCase
      let finalKey;
      if (newKey in I18N_KEY_MAPPINGS) {
        finalKey = I18N_KEY_MAPPINGS[newKey];
      } else {
        finalKey = normalizeKey(newKey);
      }

      // Skip keys that are mapped to null (removed in Blok)
      if (finalKey === null) {
        continue;
      }

      result[finalKey] = value;
    }
  }

  return result;
}

/**
 * Parses a JavaScript object literal string into an actual object.
 * Handles simple object literals with string values.
 * @param {string} str - The object literal string
 * @returns {Object|null} Parsed object or null if parsing fails
 */
function parseObjectLiteral(str) {
  try {
    // Convert single quotes to double quotes for JSON compatibility
    // Handle unquoted keys by quoting them
    let jsonStr = str
      // Replace single quotes with double quotes
      .replace(/'/g, '"')
      // Handle unquoted keys (identifier followed by colon)
      .replace(/(\s*)(\w+)(\s*:\s*)/g, '$1"$2"$3')
      // Remove trailing commas before closing braces/brackets
      .replace(/,(\s*[}\]])/g, '$1');

    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Converts a flattened dictionary object to a formatted JavaScript object string.
 * @param {Object} obj - The flattened dictionary
 * @param {string} indent - The indentation string
 * @returns {string} Formatted object string
 */
function objectToString(obj, indent = '      ') {
  const entries = Object.entries(obj);
  if (entries.length === 0) {
    return '{}';
  }

  const lines = entries.map(([key, value]) => {
    const escapedValue = typeof value === 'string' ? value.replace(/"/g, '\\"') : value;
    return `${indent}"${key}": "${escapedValue}"`;
  });

  return '{\n' + lines.join(',\n') + '\n' + indent.slice(2) + '}';
}

/**
 * Finds matching brace for nested object parsing.
 * @param {string} str - The string to search
 * @param {number} startIndex - Starting position (should be at opening brace)
 * @returns {number} Index of matching closing brace, or -1 if not found
 */
function findMatchingBrace(str, startIndex) {
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = startIndex; i < str.length; i++) {
    const char = str[i];
    const prevChar = i > 0 ? str[i - 1] : '';

    // Handle string detection
    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }

    if (inString) continue;

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Transforms EditorJS nested i18n messages to Blok flat format.
 * @param {string} content - The file content
 * @returns {{result: string, changed: boolean}} Transformed content and change flag
 */
function transformI18nConfig(content) {
  // Pattern to find i18n: { messages: { ... } } or i18n: { messages: { ... }, ... }
  const i18nStartPattern = /i18n\s*:\s*\{\s*messages\s*:\s*\{/g;
  let match;
  let result = content;
  let changed = false;
  let offset = 0;

  // Reset lastIndex for the regex
  i18nStartPattern.lastIndex = 0;

  while ((match = i18nStartPattern.exec(content)) !== null) {
    const messagesStart = match.index + match[0].length - 1; // Position of opening brace of messages
    const messagesEnd = findMatchingBrace(content, messagesStart);

    if (messagesEnd === -1) continue;

    const messagesStr = content.substring(messagesStart, messagesEnd + 1);

    // Skip if it contains functions or arrow functions (dynamic content)
    if (messagesStr.includes('function') || messagesStr.includes('=>')) {
      continue;
    }

    // Try to parse the messages object
    const messagesObj = parseObjectLiteral(messagesStr);
    if (!messagesObj) continue;

    // Flatten the dictionary
    const flattened = flattenI18nDictionary(messagesObj);

    // Detect indentation from the original content
    const lineStart = content.lastIndexOf('\n', match.index) + 1;
    const lineContent = content.substring(lineStart, match.index);
    const baseIndent = lineContent.match(/^\s*/)?.[0] || '';
    const messagesIndent = baseIndent + '    ';

    // Convert to string with proper formatting
    const flattenedStr = objectToString(flattened, messagesIndent + '  ');

    // Replace in result (accounting for previous replacements)
    const adjustedStart = messagesStart + offset;
    const adjustedEnd = messagesEnd + 1 + offset;
    result = result.substring(0, adjustedStart) + flattenedStr + result.substring(adjustedEnd);

    // Update offset for next iteration
    offset += flattenedStr.length - (messagesEnd + 1 - messagesStart);
    changed = true;
  }

  return { result, changed };
}

/**
 * Removes i18n messages from config to use Blok's built-in library translations.
 * Preserves other i18n properties like locale and direction.
 * @param {string} content - The file content
 * @returns {{result: string, changed: boolean}} Transformed content and change flag
 */
function removeI18nMessages(content) {
  // Pattern to find i18n config with messages property
  const i18nStartPattern = /i18n\s*:\s*\{/g;
  let match;
  let result = content;
  let changed = false;
  let offset = 0;

  // Reset lastIndex for the regex
  i18nStartPattern.lastIndex = 0;

  while ((match = i18nStartPattern.exec(content)) !== null) {
    const i18nStart = match.index + match[0].length - 1; // Position of opening brace
    const i18nEnd = findMatchingBrace(content, i18nStart);

    if (i18nEnd === -1) continue;

    const i18nContent = content.substring(i18nStart, i18nEnd + 1);

    // Check if this i18n config has a messages property
    if (!i18nContent.includes('messages')) {
      continue;
    }

    // Find the messages property and remove it
    // Handle: messages: { ... }, or messages: { ... } (with or without trailing comma)
    const messagesPattern = /,?\s*messages\s*:\s*\{/;
    const messagesMatch = i18nContent.match(messagesPattern);

    if (!messagesMatch) continue;

    const messagesStartInContent = i18nContent.indexOf(messagesMatch[0]);
    const messagesObjStart = i18nContent.indexOf('{', messagesStartInContent);
    const messagesObjEnd = findMatchingBrace(i18nContent, messagesObjStart);

    if (messagesObjEnd === -1) continue;

    // Determine what to remove (including trailing comma if present)
    let removeStart = messagesStartInContent;
    let removeEnd = messagesObjEnd + 1;

    // Check for trailing comma after messages object
    const afterMessages = i18nContent.substring(removeEnd);
    const trailingCommaMatch = afterMessages.match(/^\s*,/);
    if (trailingCommaMatch) {
      removeEnd += trailingCommaMatch[0].length;
    }

    // If messages started with a comma (not first property), include it in removal
    // Otherwise, we need to handle the case where it's the first property
    const beforeMessages = i18nContent.substring(0, messagesStartInContent);
    if (!messagesMatch[0].startsWith(',') && beforeMessages.trim() === '{') {
      // messages is first property, remove trailing comma if any
    }

    // Build the new i18n content without messages
    let newI18nContent = i18nContent.substring(0, removeStart) + i18nContent.substring(removeEnd);

    // Clean up: remove leading comma if messages was removed and left one
    newI18nContent = newI18nContent.replace(/\{\s*,/, '{');

    // Clean up: remove trailing comma before closing brace
    newI18nContent = newI18nContent.replace(/,\s*\}/, ' }');

    // Clean up empty i18n config: { } -> remove or simplify
    const isEmptyI18n = newI18nContent.replace(/\s/g, '') === '{}';

    if (isEmptyI18n) {
      // Replace with empty object or keep minimal
      newI18nContent = '{}';
    }

    // Replace in result (accounting for previous replacements)
    const adjustedI18nStart = i18nStart + offset;
    const adjustedI18nEnd = i18nEnd + 1 + offset;
    result = result.substring(0, adjustedI18nStart) + newI18nContent + result.substring(adjustedI18nEnd);

    // Update offset for next iteration
    offset += newI18nContent.length - (i18nEnd + 1 - i18nStart);
    changed = true;
  }

  return { result, changed };
}

// Import transformations
const IMPORT_TRANSFORMS = [
  // EditorJS subpath imports (e.g., @editorjs/editorjs/types -> @jackuait/blok/types)
  {
    pattern: /from\s+['"]@editorjs\/editorjs\/([^'"]+)['"]/g,
    replacement: "from '@jackuait/blok/$1'",
  },
  {
    pattern: /require\s*\(\s*['"]@editorjs\/editorjs\/([^'"]+)['"]\s*\)/g,
    replacement: "require('@jackuait/blok/$1')",
  },
  // Combined default + named imports: import EditorJS, { EditorConfig } from '@editorjs/editorjs'
  // → import { Blok, EditorConfig } from '@jackuait/blok' (EditorConfig → BlokConfig handled by TYPE_TRANSFORMS)
  // IMPORTANT: Must come before regular default import patterns to avoid partial matching
  {
    pattern: /import\s+EditorJS\s*,\s*\{\s*([^}]+?)\s*\}\s*from\s+['"]@editorjs\/editorjs['"]/g,
    replacement: "import { Blok, $1 } from '@jackuait/blok'",
    note: 'Converted combined default + named import',
  },
  // Aliased combined: import Editor, { EditorConfig } from '@editorjs/editorjs'
  {
    pattern: /import\s+(\w+)\s*,\s*\{\s*([^}]+?)\s*\}\s*from\s+['"]@editorjs\/editorjs['"]/g,
    replacement: "import { Blok as $1, $2 } from '@jackuait/blok'",
    note: 'Converted aliased combined default + named import',
  },
  // Main EditorJS default import -> Blok named import
  // e.g., import EditorJS from '@editorjs/editorjs' -> import { Blok } from '@jackuait/blok'
  {
    pattern: /import\s+EditorJS\s+from\s+['"]@editorjs\/editorjs['"]/g,
    replacement: "import { Blok } from '@jackuait/blok'",
    note: 'Converted default import to named import',
  },
  // EditorJS default import with alias -> Blok named import with alias
  // e.g., import Editor from '@editorjs/editorjs' -> import { Blok as Editor } from '@jackuait/blok'
  {
    pattern: /import\s+(\w+)\s+from\s+['"]@editorjs\/editorjs['"]/g,
    replacement: "import { Blok as $1 } from '@jackuait/blok'",
    note: 'Converted default import to named import with alias',
  },
  // Destructured require with default: const { default: EditorJS } = require(...)
  // IMPORTANT: Must come before generic require pattern to avoid partial matching
  {
    pattern: /const\s+\{\s*default\s*:\s*(\w+)\s*\}\s*=\s*require\s*\(\s*['"]@editorjs\/editorjs['"]\s*\)/g,
    replacement: "const { Blok: $1 } = require('@jackuait/blok')",
    note: 'Converted destructured default require to named require',
  },
  {
    pattern: /require\s*\(\s*['"]@editorjs\/editorjs['"]\s*\)/g,
    replacement: "require('@jackuait/blok').Blok",
  },
  // Namespace import: import * as EditorJS from '@editorjs/editorjs'
  // → convert to named import (namespace pattern no longer needed with named exports)
  {
    pattern: /import\s+\*\s+as\s+(\w+)\s+from\s+['"]@editorjs\/editorjs['"]/g,
    replacement: "import { Blok as $1 } from '@jackuait/blok'",
    note: 'Converted namespace import to named import (namespace no longer needed)',
  },
  // Dynamic import with .then chaining that expects default (must come before generic dynamic import)
  {
    pattern: /import\s*\(\s*['"]@editorjs\/editorjs['"]\s*\)\s*\.then\s*\(\s*(\w+)\s*=>\s*\1\.default\s*\)/g,
    replacement: "import('@jackuait/blok').then($1 => $1.Blok)",
    note: 'Converted dynamic import .then(m => m.default) pattern',
  },
  // Dynamic import with destructuring: const { default: Editor } = await import('@editorjs/editorjs')
  // IMPORTANT: Must come before generic dynamic import to avoid partial matching
  {
    pattern: /\{\s*default\s*:\s*(\w+)\s*\}\s*=\s*await\s+import\s*\(\s*['"]@editorjs\/editorjs['"]\s*\)/g,
    replacement: "{ Blok: $1 } = await import('@jackuait/blok')",
    note: 'Converted destructured dynamic import',
  },
  // Dynamic import: import('@editorjs/editorjs')
  {
    pattern: /import\s*\(\s*['"]@editorjs\/editorjs['"]\s*\)/g,
    replacement: "import('@jackuait/blok').then(m => ({ default: m.Blok }))",
    note: 'Converted dynamic import (wraps named export as default for compatibility)',
  },
  // Type-only default import: import type EditorJS from '@editorjs/editorjs'
  {
    pattern: /import\s+type\s+(\w+)\s+from\s+['"]@editorjs\/editorjs['"]/g,
    replacement: "import type { Blok as $1 } from '@jackuait/blok'",
    note: 'Converted type-only default import to named import',
  },
  // Re-export default as named: export { default as Editor } from '@editorjs/editorjs'
  {
    pattern: /export\s+\{\s*default\s+as\s+(\w+)\s*\}\s*from\s+['"]@editorjs\/editorjs['"]/g,
    replacement: "export { Blok as $1 } from '@jackuait/blok'",
    note: 'Converted default re-export to named export',
  },
  // Re-export default: export { default } from '@editorjs/editorjs'
  {
    pattern: /export\s+\{\s*default\s*\}\s*from\s+['"]@editorjs\/editorjs['"]/g,
    replacement: "export { Blok } from '@jackuait/blok'",
    note: 'Converted default re-export',
  },
  // Header tool (now bundled) - import directly from @jackuait/blok
  {
    pattern: /import\s+Header\s+from\s+['"]@editorjs\/header['"];?\n?/g,
    replacement: "import { Header } from '@jackuait/blok';\n",
    note: 'Header tool is now bundled with Blok',
  },
  {
    pattern: /import\s+(\w+)\s+from\s+['"]@editorjs\/header['"];?\n?/g,
    replacement: "import { Header as $1 } from '@jackuait/blok';\n",
    note: 'Header tool is now bundled with Blok (aliased)',
  },
  // Paragraph tool (now bundled) - import directly from @jackuait/blok
  {
    pattern: /import\s+Paragraph\s+from\s+['"]@editorjs\/paragraph['"];?\n?/g,
    replacement: "import { Paragraph } from '@jackuait/blok';\n",
    note: 'Paragraph tool is now bundled with Blok',
  },
  {
    pattern: /import\s+(\w+)\s+from\s+['"]@editorjs\/paragraph['"];?\n?/g,
    replacement: "import { Paragraph as $1 } from '@jackuait/blok';\n",
    note: 'Paragraph tool is now bundled with Blok (aliased)',
  },
  // List tool (now bundled) - import directly from @jackuait/blok
  {
    pattern: /import\s+List\s+from\s+['"]@editorjs\/list['"];?\n?/g,
    replacement: "import { List } from '@jackuait/blok';\n",
    note: 'List tool is now bundled with Blok',
  },
  {
    pattern: /import\s+(\w+)\s+from\s+['"]@editorjs\/list['"];?\n?/g,
    replacement: "import { List as $1 } from '@jackuait/blok';\n",
    note: 'List tool is now bundled with Blok (aliased)',
  },
  // Tool require statements (CommonJS)
  // Header require: const Header = require('@editorjs/header')
  {
    pattern: /const\s+Header\s*=\s*require\s*\(\s*['"]@editorjs\/header['"]\s*\)/g,
    replacement: "const { Header } = require('@jackuait/blok')",
    note: 'Header tool is now bundled with Blok',
  },
  {
    pattern: /const\s+(\w+)\s*=\s*require\s*\(\s*['"]@editorjs\/header['"]\s*\)/g,
    replacement: "const { Header: $1 } = require('@jackuait/blok')",
    note: 'Header tool is now bundled with Blok (aliased)',
  },
  // Paragraph require
  {
    pattern: /const\s+Paragraph\s*=\s*require\s*\(\s*['"]@editorjs\/paragraph['"]\s*\)/g,
    replacement: "const { Paragraph } = require('@jackuait/blok')",
    note: 'Paragraph tool is now bundled with Blok',
  },
  {
    pattern: /const\s+(\w+)\s*=\s*require\s*\(\s*['"]@editorjs\/paragraph['"]\s*\)/g,
    replacement: "const { Paragraph: $1 } = require('@jackuait/blok')",
    note: 'Paragraph tool is now bundled with Blok (aliased)',
  },
  // List require
  {
    pattern: /const\s+List\s*=\s*require\s*\(\s*['"]@editorjs\/list['"]\s*\)/g,
    replacement: "const { List } = require('@jackuait/blok')",
    note: 'List tool is now bundled with Blok',
  },
  {
    pattern: /const\s+(\w+)\s*=\s*require\s*\(\s*['"]@editorjs\/list['"]\s*\)/g,
    replacement: "const { List: $1 } = require('@jackuait/blok')",
    note: 'List tool is now bundled with Blok (aliased)',
  },
];

// Type import transformations (order matters - more specific patterns first)
const TYPE_TRANSFORMS = [
  { pattern: /EditorJS\.EditorConfig/g, replacement: 'BlokConfig' },
  { pattern: /EditorConfig/g, replacement: 'BlokConfig' },
];

// Class name transformations
const CLASS_NAME_TRANSFORMS = [
  // Constructor
  { pattern: /new\s+EditorJS\s*\(/g, replacement: 'new Blok(' },
  // Type annotations
  { pattern: /:\s*EditorJS(?![a-zA-Z])/g, replacement: ': Blok' },
  // Generic type parameters
  { pattern: /<EditorJS>/g, replacement: '<Blok>' },
];

// CSS class transformations
// Handles both with dot (.ce-block) and without dot (ce-block) patterns
const CSS_CLASS_TRANSFORMS = [
  // Editor wrapper classes (codex-editor)
  { pattern: /\.codex-editor__redactor(?![\w-])/g, replacement: '[data-blok-redactor]' },
  { pattern: /\.codex-editor--narrow(?![\w-])/g, replacement: '[data-blok-narrow="true"]' },
  { pattern: /\.codex-editor--rtl(?![\w-])/g, replacement: '[data-blok-rtl="true"]' },
  { pattern: /\.codex-editor(?![\w-])/g, replacement: '[data-blok-editor]' },
  // Without dot prefix (for string literals, classList operations)
  { pattern: /(['"`])codex-editor__redactor(['"`])/g, replacement: '$1data-blok-redactor$2' },
  { pattern: /(['"`])codex-editor--narrow(['"`])/g, replacement: '$1data-blok-narrow$2' },
  { pattern: /(['"`])codex-editor--rtl(['"`])/g, replacement: '$1data-blok-rtl$2' },
  { pattern: /(['"`])codex-editor(['"`])/g, replacement: '$1data-blok-editor$2' },

  // Block classes (ce-block)
  { pattern: /\.ce-block--selected(?![\w-])/g, replacement: '[data-blok-selected="true"]' },
  { pattern: /\.ce-block--stretched(?![\w-])/g, replacement: '[data-blok-stretched="true"]' },
  { pattern: /\.ce-block--focused(?![\w-])/g, replacement: '[data-blok-focused="true"]' },
  { pattern: /\.ce-block__content(?![\w-])/g, replacement: '[data-blok-element-content]' },
  { pattern: /\.ce-block(?![\w-])/g, replacement: '[data-blok-element]' },
  // Without dot prefix
  { pattern: /(['"`])ce-block--selected(['"`])/g, replacement: '$1data-blok-selected$2' },
  { pattern: /(['"`])ce-block--stretched(['"`])/g, replacement: '$1data-blok-stretched$2' },
  { pattern: /(['"`])ce-block--focused(['"`])/g, replacement: '$1data-blok-focused$2' },
  { pattern: /(['"`])ce-block__content(['"`])/g, replacement: '$1data-blok-element-content$2' },
  { pattern: /(['"`])ce-block(['"`])/g, replacement: '$1data-blok-element$2' },

  // Toolbar classes (ce-toolbar)
  { pattern: /\.ce-toolbar__plus(?![\w-])/g, replacement: '[data-blok-testid="plus-button"]' },
  { pattern: /\.ce-toolbar__settings-btn(?![\w-])/g, replacement: '[data-blok-settings-toggler]' },
  { pattern: /\.ce-toolbar__actions(?![\w-])/g, replacement: '[data-blok-testid="toolbar-actions"]' },
  { pattern: /\.ce-toolbar(?![\w-])/g, replacement: '[data-blok-toolbar]' },
  // Without dot prefix
  { pattern: /(['"`])ce-toolbar__plus(['"`])/g, replacement: '$1data-blok-testid="plus-button"$2' },
  { pattern: /(['"`])ce-toolbar__settings-btn(['"`])/g, replacement: '$1data-blok-settings-toggler$2' },
  { pattern: /(['"`])ce-toolbar__actions(['"`])/g, replacement: '$1data-blok-testid="toolbar-actions"$2' },
  { pattern: /(['"`])ce-toolbar(['"`])/g, replacement: '$1data-blok-toolbar$2' },

  // Inline toolbar classes (ce-inline-toolbar, ce-inline-tool)
  { pattern: /\.ce-inline-tool--link(?![\w-])/g, replacement: '[data-blok-testid="inline-tool-link"]' },
  { pattern: /\.ce-inline-tool--bold(?![\w-])/g, replacement: '[data-blok-testid="inline-tool-bold"]' },
  { pattern: /\.ce-inline-tool--italic(?![\w-])/g, replacement: '[data-blok-testid="inline-tool-italic"]' },
  { pattern: /\.ce-inline-tool(?![\w-])/g, replacement: '[data-blok-testid="inline-tool"]' },
  { pattern: /\.ce-inline-toolbar(?![\w-])/g, replacement: '[data-blok-testid="inline-toolbar"]' },
  // Without dot prefix
  { pattern: /(['"`])ce-inline-tool--link(['"`])/g, replacement: '$1data-blok-testid="inline-tool-link"$2' },
  { pattern: /(['"`])ce-inline-tool--bold(['"`])/g, replacement: '$1data-blok-testid="inline-tool-bold"$2' },
  { pattern: /(['"`])ce-inline-tool--italic(['"`])/g, replacement: '$1data-blok-testid="inline-tool-italic"$2' },
  { pattern: /(['"`])ce-inline-tool(['"`])/g, replacement: '$1data-blok-testid="inline-tool"$2' },
  { pattern: /(['"`])ce-inline-toolbar(['"`])/g, replacement: '$1data-blok-testid="inline-toolbar"$2' },

  // Popover classes (ce-popover)
  { pattern: /\.ce-popover--opened(?![\w-])/g, replacement: '[data-blok-popover-opened="true"]' },
  { pattern: /\.ce-popover__container(?![\w-])/g, replacement: '[data-blok-popover-container]' },
  { pattern: /\.ce-popover-item--focused(?![\w-])/g, replacement: '[data-blok-focused="true"]' },
  { pattern: /\.ce-popover-item(?![\w-])/g, replacement: '[data-blok-testid="popover-item"]' },
  { pattern: /\.ce-popover(?![\w-])/g, replacement: '[data-blok-popover]' },
  // Without dot prefix
  { pattern: /(['"`])ce-popover--opened(['"`])/g, replacement: '$1data-blok-popover-opened$2' },
  { pattern: /(['"`])ce-popover__container(['"`])/g, replacement: '$1data-blok-popover-container$2' },
  { pattern: /(['"`])ce-popover-item--focused(['"`])/g, replacement: '$1data-blok-focused$2' },
  { pattern: /(['"`])ce-popover-item(['"`])/g, replacement: '$1data-blok-testid="popover-item"$2' },
  { pattern: /(['"`])ce-popover(['"`])/g, replacement: '$1data-blok-popover$2' },

  // Tool-specific classes (ce-paragraph, ce-header)
  { pattern: /\.ce-paragraph(?![\w-])/g, replacement: '[data-blok-tool="paragraph"]' },
  { pattern: /\.ce-header(?![\w-])/g, replacement: '[data-blok-tool="header"]' },
  // Without dot prefix
  { pattern: /(['"`])ce-paragraph(['"`])/g, replacement: '$1data-blok-tool="paragraph"$2' },
  { pattern: /(['"`])ce-header(['"`])/g, replacement: '$1data-blok-tool="header"$2' },

  // Conversion toolbar
  { pattern: /\.ce-conversion-toolbar(?![\w-])/g, replacement: '[data-blok-testid="conversion-toolbar"]' },
  { pattern: /\.ce-conversion-tool(?![\w-])/g, replacement: '[data-blok-testid="conversion-tool"]' },
  { pattern: /(['"`])ce-conversion-toolbar(['"`])/g, replacement: '$1data-blok-testid="conversion-toolbar"$2' },
  { pattern: /(['"`])ce-conversion-tool(['"`])/g, replacement: '$1data-blok-testid="conversion-tool"$2' },

  // Settings and tune classes
  { pattern: /\.ce-settings(?![\w-])/g, replacement: '[data-blok-testid="block-settings"]' },
  { pattern: /\.ce-tune(?![\w-])/g, replacement: '[data-blok-testid="block-tune"]' },
  { pattern: /(['"`])ce-settings(['"`])/g, replacement: '$1data-blok-testid="block-settings"$2' },
  { pattern: /(['"`])ce-tune(['"`])/g, replacement: '$1data-blok-testid="block-tune"$2' },

  // Stub block
  { pattern: /\.ce-stub(?![\w-])/g, replacement: '[data-blok-stub]' },
  { pattern: /(['"`])ce-stub(['"`])/g, replacement: '$1data-blok-stub$2' },

  // Drag and drop
  { pattern: /\.ce-drag-handle(?![\w-])/g, replacement: '[data-blok-drag-handle]' },
  { pattern: /(['"`])ce-drag-handle(['"`])/g, replacement: '$1data-blok-drag-handle$2' },

  // Additional state classes
  { pattern: /\.ce-ragged-right(?![\w-])/g, replacement: '[data-blok-ragged-right="true"]' },
  { pattern: /(['"`])ce-ragged-right(['"`])/g, replacement: '$1data-blok-ragged-right$2' },

  // Popover item states and icons
  { pattern: /\.ce-popover-item--confirmation(?![\w-])/g, replacement: '[data-blok-popover-item-confirmation="true"]' },
  { pattern: /\.ce-popover-item__icon(?![\w-])/g, replacement: '[data-blok-testid="popover-item-icon"]' },
  { pattern: /\.ce-popover-item__icon--tool(?![\w-])/g, replacement: '[data-blok-testid="popover-item-icon-tool"]' },
  { pattern: /(['"`])ce-popover-item--confirmation(['"`])/g, replacement: '$1data-blok-popover-item-confirmation$2' },
  { pattern: /(['"`])ce-popover-item__icon(['"`])/g, replacement: '$1data-blok-testid="popover-item-icon"$2' },
  { pattern: /(['"`])ce-popover-item__icon--tool(['"`])/g, replacement: '$1data-blok-testid="popover-item-icon-tool"$2' },

  // Toolbox classes (ce-toolbox)
  { pattern: /\.ce-toolbox--opened(?![\w-])/g, replacement: '[data-blok-toolbox-opened="true"]' },
  { pattern: /\.ce-toolbox(?![\w-])/g, replacement: '[data-blok-toolbox]' },
  { pattern: /(['"`])ce-toolbox--opened(['"`])/g, replacement: '$1data-blok-toolbox-opened$2' },
  { pattern: /(['"`])ce-toolbox(['"`])/g, replacement: '$1data-blok-toolbox$2' },

  // CDX list classes (cdx-list)
  { pattern: /\.cdx-list__item(?![\w-])/g, replacement: '[data-blok-list-item]' },
  { pattern: /\.cdx-list--ordered(?![\w-])/g, replacement: '[data-blok-list="ordered"]' },
  { pattern: /\.cdx-list--unordered(?![\w-])/g, replacement: '[data-blok-list="unordered"]' },
  { pattern: /\.cdx-list(?![\w-])/g, replacement: '[data-blok-list]' },
  { pattern: /(['"`])cdx-list__item(['"`])/g, replacement: '$1data-blok-list-item$2' },
  { pattern: /(['"`])cdx-list--ordered(['"`])/g, replacement: '$1data-blok-list="ordered"$2' },
  { pattern: /(['"`])cdx-list--unordered(['"`])/g, replacement: '$1data-blok-list="unordered"$2' },
  { pattern: /(['"`])cdx-list(['"`])/g, replacement: '$1data-blok-list$2' },

  // Without dot prefix
  { pattern: /(['"`])tc-popover__item-icon(['"`])/g, replacement: '$1data-blok-testid="table-popover-item-icon"$2' },
  { pattern: /(['"`])tc-popover(['"`])/g, replacement: '$1data-blok-testid="table-popover"$2' },
  { pattern: /(['"`])tc-toolbox__toggler(['"`])/g, replacement: '$1data-blok-testid="table-toolbox-toggler"$2' },
  { pattern: /(['"`])tc-toolbox(['"`])/g, replacement: '$1data-blok-testid="table-toolbox"$2' },
  { pattern: /(['"`])tc-add-row(['"`])/g, replacement: '$1data-blok-testid="table-add-row"$2' },
  { pattern: /(['"`])tc-add-column(['"`])/g, replacement: '$1data-blok-testid="table-add-column"$2' },
  { pattern: /(['"`])tc-table(['"`])/g, replacement: '$1data-blok-testid="table"$2' },
  { pattern: /(['"`])tc-row(['"`])/g, replacement: '$1data-blok-testid="table-row"$2' },
  { pattern: /(['"`])tc-cell(['"`])/g, replacement: '$1data-blok-testid="table-cell"$2' },

  // CDX generic utility classes
  { pattern: /\.cdx-button(?![\w-])/g, replacement: '[data-blok-button]' },
  { pattern: /\.cdx-input(?![\w-])/g, replacement: '[data-blok-input]' },
  { pattern: /\.cdx-loader(?![\w-])/g, replacement: '[data-blok-loader]' },
  { pattern: /\.cdx-search-field(?![\w-])/g, replacement: '[data-blok-search-field]' },
  { pattern: /(['"`])cdx-button(['"`])/g, replacement: '$1data-blok-button$2' },
  { pattern: /(['"`])cdx-input(['"`])/g, replacement: '$1data-blok-input$2' },
  { pattern: /(['"`])cdx-loader(['"`])/g, replacement: '$1data-blok-loader$2' },
  { pattern: /(['"`])cdx-search-field(['"`])/g, replacement: '$1data-blok-search-field$2' },
];

// Data attribute transformations
const DATA_ATTRIBUTE_TRANSFORMS = [
  // Core data attributes
  { pattern: /data-id(?=["'\]=\s\]])/g, replacement: 'data-blok-id' },
  { pattern: /data-item-name/g, replacement: 'data-blok-item-name' },
  { pattern: /data-empty/g, replacement: 'data-blok-empty' },
  // Cypress/test selectors
  { pattern: /\[data-cy=["']?editorjs["']?\]/g, replacement: '[data-blok-testid="blok-editor"]' },
  { pattern: /data-cy=["']?editorjs["']?/g, replacement: 'data-blok-testid="blok-editor"' },
];

// Selector transformations for JavaScript/TypeScript query strings
const SELECTOR_TRANSFORMS = [
  // querySelector patterns
  { pattern: /\[data-id=/g, replacement: '[data-blok-id=' },
  { pattern: /\[data-item-name=/g, replacement: '[data-blok-item-name=' },
  { pattern: /\[data-empty\]/g, replacement: '[data-blok-empty]' },
  { pattern: /\[data-empty=/g, replacement: '[data-blok-empty=' },
];

// Default holder transformation
const HOLDER_TRANSFORMS = [
  // HTML id attribute
  { pattern: /id=["']editorjs["']/g, replacement: 'id="blok"' },
  // JavaScript string literals for holder
  { pattern: /holder:\s*['"]editorjs['"]/g, replacement: "holder: 'blok'" },
  { pattern: /getElementById\s*\(\s*['"]editorjs['"]\s*\)/g, replacement: "getElementById('blok')" },
];

// Bundled tools - these are now in a separate entry point (@jackuait/blok/tools)
const BUNDLED_TOOLS = ['Header', 'Paragraph', 'List'];

// Inline tools - also in the tools entry point
const INLINE_TOOLS = ['Bold', 'Italic', 'Link', 'Convert'];

// All tools that should be imported from @jackuait/blok/tools
const ALL_TOOLS = [...BUNDLED_TOOLS, ...INLINE_TOOLS];

// Tool configuration transformations
// Note: With named exports, tools are imported directly (e.g., { Header } from '@jackuait/blok/tools')
// so the tool class references don't need the Blok. prefix anymore
const TOOL_CONFIG_TRANSFORMS = [
  // Convert old Blok.Header style to direct Header reference (for existing Blok users upgrading)
  // Block tools
  { pattern: /class:\s*Blok\.Header(?!Config)/g, replacement: 'class: Header' },
  { pattern: /class:\s*Blok\.Paragraph(?!Config)/g, replacement: 'class: Paragraph' },
  { pattern: /class:\s*Blok\.List(?!Config|Item)/g, replacement: 'class: List' },
  { pattern: /(\bheader\s*:\s*)Blok\.Header(?!Config)(?=\s*[,}\n])/g, replacement: '$1Header' },
  { pattern: /(\bparagraph\s*:\s*)Blok\.Paragraph(?!Config)(?=\s*[,}\n])/g, replacement: '$1Paragraph' },
  { pattern: /(\blist\s*:\s*)Blok\.List(?!Config|Item)(?=\s*[,}\n])/g, replacement: '$1List' },
  // Inline tools
  { pattern: /class:\s*Blok\.Bold(?!Config)/g, replacement: 'class: Bold' },
  { pattern: /class:\s*Blok\.Italic(?!Config)/g, replacement: 'class: Italic' },
  { pattern: /class:\s*Blok\.Link(?!Config)/g, replacement: 'class: Link' },
  { pattern: /class:\s*Blok\.Convert(?!Config)/g, replacement: 'class: Convert' },
  { pattern: /(\bbold\s*:\s*)Blok\.Bold(?!Config)(?=\s*[,}\n])/g, replacement: '$1Bold' },
  { pattern: /(\bitalic\s*:\s*)Blok\.Italic(?!Config)(?=\s*[,}\n])/g, replacement: '$1Italic' },
  { pattern: /(\blink\s*:\s*)Blok\.Link(?!Config)(?=\s*[,}\n])/g, replacement: '$1Link' },
  { pattern: /(\bconvert(?:To)?\s*:\s*)Blok\.Convert(?!Config)(?=\s*[,}\n])/g, replacement: '$1Convert' },
];

// ============================================================================
// Blok Modular Import Transformations (Strategy 5)
// ============================================================================

/**
 * Transforms for migrating old Blok imports to the new modular structure.
 * After Strategy 3/4, tools are in a separate entry point (@jackuait/blok/tools).
 *
 * Detects and transforms patterns like:
 *   import { Blok, Header, Paragraph } from '@jackuait/blok'
 * To:
 *   import { Blok } from '@jackuait/blok';
 *   import { Header, Paragraph } from '@jackuait/blok/tools';
 */
const BLOK_MODULAR_IMPORT_TRANSFORMS = [
  // Transform tool imports from old @jackuait/blok to @jackuait/blok/tools
  // These patterns match tools being imported from the main entry point
  // The actual splitting is done in splitBlokImports() function below
];

/**
 * Splits a combined @jackuait/blok import that contains both core exports and tools
 * into separate imports from the correct entry points.
 *
 * @param {string} content - The file content
 * @returns {{result: string, changed: boolean}} Transformed content and change flag
 */
function splitBlokImports(content) {
  // Pattern to find @jackuait/blok named imports
  const blokImportPattern = /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]@jackuait\/blok['"];?/g;
  let result = content;
  let changed = false;

  // Collect all matches first to avoid regex state issues
  const matches = [];
  let match;
  while ((match = blokImportPattern.exec(content)) !== null) {
    matches.push({
      fullMatch: match[0],
      imports: match[1],
      index: match.index,
    });
  }

  // Process matches in reverse order to preserve indices
  for (let i = matches.length - 1; i >= 0; i--) {
    const { fullMatch, imports } = matches[i];

    // Parse the imports
    const importList = imports.split(',').map(s => s.trim()).filter(s => s.length > 0);

    // Separate core imports from tool imports
    const coreImports = [];
    const toolImports = [];

    for (const imp of importList) {
      // Handle aliased imports: "Header as MyHeader"
      const importName = imp.split(/\s+as\s+/)[0].trim();

      if (ALL_TOOLS.includes(importName)) {
        toolImports.push(imp);
      } else {
        coreImports.push(imp);
      }
    }

    // Only transform if there are tool imports mixed with core imports
    // or if there are only tool imports (they should come from /tools)
    if (toolImports.length > 0) {
      let newImports = '';

      if (coreImports.length > 0) {
        newImports += `import { ${coreImports.join(', ')} } from '@jackuait/blok';\n`;
      }

      if (toolImports.length > 0) {
        newImports += `import { ${toolImports.join(', ')} } from '@jackuait/blok/tools';`;
      }

      // Preserve trailing newline if original had one
      if (!fullMatch.endsWith(';')) {
        newImports = newImports.replace(/;$/, '');
      }

      result = result.replace(fullMatch, newImports);
      changed = true;
    }
  }

  return { result, changed };
}

// Text transformations for "EditorJS" string references
const TEXT_TRANSFORMS = [
  // Replace exact "EditorJS" text (preserves case-sensitive matching)
  { pattern: /EditorJS(?![a-zA-Z])/g, replacement: 'Blok' },
  // Replace #editorjs with #blok (e.g., in CSS ID selectors or anchor links)
  { pattern: /#editorjs(?![a-zA-Z0-9_-])/g, replacement: '#blok' },
];

// ============================================================================
// Utility Functions
// ============================================================================

function log(message, verbose = false) {
  if (verbose || !global.isVerbose) {
    console.log(message);
  }
}

function logVerbose(message) {
  if (global.isVerbose) {
    console.log(`  ${message}`);
  }
}

function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);

    // Skip node_modules, dist, and hidden directories
    if (file === 'node_modules' || file === 'dist' || file === 'build' || file.startsWith('.')) {
      return;
    }

    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      const ext = path.extname(file).toLowerCase();
      if (FILE_EXTENSIONS.includes(ext)) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

function applyTransforms(content, transforms, fileName) {
  let result = content;
  const changes = [];

  transforms.forEach(({ pattern, replacement, note }) => {
    const matches = result.match(pattern);
    if (matches) {
      changes.push({
        pattern: pattern.toString(),
        count: matches.length,
        note,
      });
      result = result.replace(pattern, replacement);
    }
  });

  return { result, changes };
}

/**
 * Ensures that bundled tools (Header, Paragraph, List) are properly imported when used.
 * Since Blok now uses named exports, tools are imported directly.
 *
 * @deprecated Use ensureToolsImport instead, which imports from @jackuait/blok/tools
 *
 * Handles the following scenarios:
 * 1. Tool used without import -> adds `import { Header, Paragraph, List } from '@jackuait/blok'`
 * 2. Existing @jackuait/blok import without tools -> adds tools to named imports
 */
function ensureBlokImport(content) {
  // Check which bundled tools are used in the content
  const usedTools = BUNDLED_TOOLS.filter(tool => {
    // Match tool usage in class: Tool or tool: Tool patterns, or direct Tool references
    const toolPattern = new RegExp(`\\b${tool}\\b`, 'g');
    return toolPattern.test(content);
  });

  if (usedTools.length === 0) {
    return { result: content, changed: false };
  }

  // Check for existing @jackuait/blok import
  const namedImportPattern = /import\s*\{([^}]+)\}\s*from\s*['"]@jackuait\/blok['"];?/;
  const namedMatch = content.match(namedImportPattern);

  let result = content;

  if (namedMatch) {
    // Check which tools are missing from the import
    const existingImports = namedMatch[1];
    const missingTools = usedTools.filter(tool => {
      const toolPattern = new RegExp(`\\b${tool}\\b`);
      return !toolPattern.test(existingImports);
    });

    if (missingTools.length > 0) {
      // Add missing tools to existing import
      const newImports = `${missingTools.join(', ')}, ${existingImports.trim()}`;
      result = content.replace(
        namedImportPattern,
        `import { ${newImports} } from '@jackuait/blok';`
      );
      return { result, changed: true };
    }
    return { result: content, changed: false };
  }

  // No @jackuait/blok import at all -> add new import
  const importStatements = content.match(/^import\s+.+from\s+['"][^'"]+['"];?\s*$/gm);
  const newImport = `import { ${usedTools.join(', ')} } from '@jackuait/blok';`;

  if (importStatements && importStatements.length > 0) {
    const lastImport = importStatements[importStatements.length - 1];
    const lastImportIndex = content.lastIndexOf(lastImport);
    const insertPosition = lastImportIndex + lastImport.length;
    result =
      content.slice(0, insertPosition) +
      '\n' + newImport +
      content.slice(insertPosition);
  } else {
    // No imports found, add at the very beginning (after shebang if present)
    const shebangMatch = content.match(/^#!.*\n/);
    if (shebangMatch) {
      result = shebangMatch[0] + newImport + '\n' + content.slice(shebangMatch[0].length);
    } else {
      result = newImport + '\n' + content;
    }
  }

  return { result, changed: true };
}

/**
 * Ensures that tools are properly imported from @jackuait/blok/tools when used.
 * This is the modern approach after Strategy 3/4 where tools are in a separate entry point.
 *
 * Handles the following scenarios:
 * 1. Tool used without import -> adds `import { Header, ... } from '@jackuait/blok/tools'`
 * 2. Existing @jackuait/blok/tools import without tools -> adds tools to named imports
 */
function ensureToolsImport(content) {
  // Check which tools are used in the content
  const usedTools = ALL_TOOLS.filter(tool => {
    // Match tool usage in class: Tool or tool: Tool patterns, or direct Tool references
    const toolPattern = new RegExp(`\\b${tool}\\b`, 'g');
    return toolPattern.test(content);
  });

  if (usedTools.length === 0) {
    return { result: content, changed: false };
  }

  // Check for existing @jackuait/blok/tools import
  const toolsImportPattern = /import\s*\{([^}]+)\}\s*from\s*['"]@jackuait\/blok\/tools['"];?/;
  const toolsMatch = content.match(toolsImportPattern);

  // Also check for @jackuait/blok import (legacy, will be split later)
  const mainImportPattern = /import\s*\{([^}]+)\}\s*from\s*['"]@jackuait\/blok['"];?/;
  const mainMatch = content.match(mainImportPattern);

  let result = content;

  // Check if tools are already imported from /tools
  if (toolsMatch) {
    const existingToolsImports = toolsMatch[1];
    const missingTools = usedTools.filter(tool => {
      const toolPattern = new RegExp(`\\b${tool}\\b`);
      return !toolPattern.test(existingToolsImports);
    });

    if (missingTools.length > 0) {
      // Add missing tools to existing /tools import
      const newImports = `${existingToolsImports.trim()}, ${missingTools.join(', ')}`;
      result = content.replace(
        toolsImportPattern,
        `import { ${newImports} } from '@jackuait/blok/tools';`
      );
      return { result, changed: true };
    }
    return { result: content, changed: false };
  }

  // Check if tools are in the main import (will be split later by splitBlokImports)
  if (mainMatch) {
    const existingMainImports = mainMatch[1];
    const toolsInMain = usedTools.filter(tool => {
      const toolPattern = new RegExp(`\\b${tool}\\b`);
      return toolPattern.test(existingMainImports);
    });

    // If all tools are already in main import, don't add duplicate
    // They'll be moved by splitBlokImports
    if (toolsInMain.length === usedTools.length) {
      return { result: content, changed: false };
    }

    // Some tools missing from both imports - add them to main (will be split later)
    const missingTools = usedTools.filter(tool => {
      const toolPattern = new RegExp(`\\b${tool}\\b`);
      return !toolPattern.test(existingMainImports);
    });

    if (missingTools.length > 0) {
      const newImports = `${missingTools.join(', ')}, ${existingMainImports.trim()}`;
      result = content.replace(
        mainImportPattern,
        `import { ${newImports} } from '@jackuait/blok';`
      );
      return { result, changed: true };
    }
    return { result: content, changed: false };
  }

  // No @jackuait/blok or @jackuait/blok/tools import -> add new /tools import
  const importStatements = content.match(/^import\s+.+from\s+['"][^'"]+['"];?\s*$/gm);
  const newImport = `import { ${usedTools.join(', ')} } from '@jackuait/blok/tools';`;

  if (importStatements && importStatements.length > 0) {
    const lastImport = importStatements[importStatements.length - 1];
    const lastImportIndex = content.lastIndexOf(lastImport);
    const insertPosition = lastImportIndex + lastImport.length;
    result =
      content.slice(0, insertPosition) +
      '\n' + newImport +
      content.slice(insertPosition);
  } else {
    // No imports found, add at the very beginning (after shebang if present)
    const shebangMatch = content.match(/^#!.*\n/);
    if (shebangMatch) {
      result = shebangMatch[0] + newImport + '\n' + content.slice(shebangMatch[0].length);
    } else {
      result = newImport + '\n' + content;
    }
  }

  return { result, changed: true };
}

function transformFile(filePath, dryRun = false, useLibraryI18n = false) {
  const content = fs.readFileSync(filePath, 'utf8');
  let transformed = content;
  const allChanges = [];

  const ext = path.extname(filePath).toLowerCase();
  const isStyleFile = ['.css', '.scss', '.less'].includes(ext);
  const isHtmlFile = ext === '.html';
  const isJsFile = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte'].includes(ext);

  // Apply import transforms (JS/TS only)
  if (isJsFile) {
    const { result, changes } = applyTransforms(transformed, IMPORT_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'imports' })));
  }

  // Apply type transforms (JS/TS only)
  if (isJsFile) {
    const { result, changes } = applyTransforms(transformed, TYPE_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'types' })));
  }

  // Apply class name transforms (JS/TS only)
  if (isJsFile) {
    const { result, changes } = applyTransforms(transformed, CLASS_NAME_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'class-names' })));
  }

  // Apply CSS class transforms (all files)
  {
    const { result, changes } = applyTransforms(transformed, CSS_CLASS_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'css-classes' })));
  }

  // Apply data attribute transforms (JS/TS/HTML)
  if (isJsFile || isHtmlFile) {
    const { result, changes } = applyTransforms(transformed, DATA_ATTRIBUTE_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'data-attributes' })));
  }

  // Apply selector transforms (JS/TS)
  if (isJsFile) {
    const { result, changes } = applyTransforms(transformed, SELECTOR_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'selectors' })));
  }

  // Apply holder transforms (JS/TS/HTML)
  if (isJsFile || isHtmlFile) {
    const { result, changes } = applyTransforms(transformed, HOLDER_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'holder' })));
  }

  // Apply tool config transforms (JS/TS only)
  if (isJsFile) {
    const { result, changes } = applyTransforms(transformed, TOOL_CONFIG_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'tool-config' })));
  }

  // Ensure tools are imported if bundled tools are used (JS/TS only)
  if (isJsFile) {
    const { result, changed } = ensureToolsImport(transformed);
    if (changed) {
      transformed = result;
      allChanges.push({ category: 'imports', pattern: 'ensureToolsImport', count: 1, note: 'Added tools import from @jackuait/blok/tools' });
    }
  }

  // Split combined @jackuait/blok imports into core and tools (JS/TS only)
  if (isJsFile) {
    const { result, changed } = splitBlokImports(transformed);
    if (changed) {
      transformed = result;
      allChanges.push({ category: 'imports', pattern: 'splitBlokImports', count: 1, note: 'Split tools into separate @jackuait/blok/tools import' });
    }
  }

  // Apply text transforms (JS/TS/HTML) - replace "EditorJS" with "Blok"
  if (isJsFile || isHtmlFile) {
    const { result, changes } = applyTransforms(transformed, TEXT_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'text' })));
  }

  // Apply i18n transforms (JS/TS only)
  if (isJsFile) {
    if (useLibraryI18n) {
      // Remove custom messages to use Blok's built-in translations
      const { result, changed } = removeI18nMessages(transformed);
      if (changed) {
        transformed = result;
        allChanges.push({ category: 'i18n', pattern: 'removeI18nMessages', count: 1, note: 'Removed custom i18n messages to use library translations' });
      }
    } else {
      // Flatten nested messages to dot-notation
      const { result, changed } = transformI18nConfig(transformed);
      if (changed) {
        transformed = result;
        allChanges.push({ category: 'i18n', pattern: 'flattenI18nMessages', count: 1, note: 'Flattened nested i18n messages to dot-notation' });
      }
    }
  }

  const hasChanges = transformed !== content;

  if (hasChanges && !dryRun) {
    fs.writeFileSync(filePath, transformed, 'utf8');
  }

  return {
    filePath,
    hasChanges,
    changes: allChanges,
  };
}

function updatePackageJson(packageJsonPath, dryRun = false) {
  if (!fs.existsSync(packageJsonPath)) {
    return { hasChanges: false, changes: [] };
  }

  const content = fs.readFileSync(packageJsonPath, 'utf8');
  const pkg = JSON.parse(content);
  const changes = [];

  // Track dependencies to remove
  const depsToRemove = ['@editorjs/editorjs', '@editorjs/header', '@editorjs/paragraph', '@editorjs/list'];
  const devDepsToRemove = [...depsToRemove];

  // Check and update dependencies
  if (pkg.dependencies) {
    depsToRemove.forEach((dep) => {
      if (pkg.dependencies[dep]) {
        changes.push({ action: 'remove', type: 'dependencies', package: dep });
        delete pkg.dependencies[dep];
      }
    });

    // Add @jackuait/blok if not present
    if (!pkg.dependencies['@jackuait/blok']) {
      changes.push({ action: 'add', type: 'dependencies', package: '@jackuait/blok' });
      pkg.dependencies['@jackuait/blok'] = 'latest';
    }
  }

  // Check and update devDependencies
  if (pkg.devDependencies) {
    devDepsToRemove.forEach((dep) => {
      if (pkg.devDependencies[dep]) {
        changes.push({ action: 'remove', type: 'devDependencies', package: dep });
        delete pkg.devDependencies[dep];
      }
    });
  }

  const hasChanges = changes.length > 0;

  if (hasChanges && !dryRun) {
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  return { hasChanges, changes };
}

// ============================================================================
// Main Execution
// ============================================================================

function printHelp() {
  console.log(`
EditorJS to Blok Codemod

Usage:
  npx -p @jackuait/blok migrate-from-editorjs [path] [options]

Arguments:
  path          Directory or file to transform (default: current directory)

Options:
  --dry-run           Show changes without modifying files
  --verbose           Show detailed output for each file
  --use-library-i18n  Remove custom i18n messages and use Blok's built-in translations
  --help              Show this help message

Examples:
  npx -p @jackuait/blok migrate-from-editorjs ./src
  npx -p @jackuait/blok migrate-from-editorjs ./src --dry-run
  npx -p @jackuait/blok migrate-from-editorjs . --verbose

What this codemod does:

  EditorJS Migration:
  • Transforms EditorJS imports to Blok named imports:
    - import EditorJS from '@editorjs/editorjs' → import { Blok } from '@jackuait/blok'
    - import Editor from '@editorjs/editorjs' → import { Blok as Editor } from '@jackuait/blok'
  • Updates bundled tool imports (Header, Paragraph, List):
    - import Header from '@editorjs/header' → import { Header } from '@jackuait/blok/tools'
    - import List from '@editorjs/list' → import { List } from '@jackuait/blok/tools'
  • Updates type names (EditorConfig → BlokConfig)
  • Replaces 'new EditorJS()' with 'new Blok()'
  • Converts CSS class selectors to data attributes:
    - .codex-editor* → [data-blok-editor], [data-blok-redactor], etc.
    - .ce-block* → [data-blok-element], [data-blok-selected], etc.
    - .ce-toolbar* → [data-blok-toolbar], [data-blok-settings-toggler], etc.
    - .ce-toolbox* → [data-blok-toolbox], [data-blok-toolbox-opened], etc.
    - .ce-inline-toolbar, .ce-inline-tool* → [data-blok-testid="inline-*"]
    - .ce-popover* → [data-blok-popover], [data-blok-popover-opened], [data-blok-popover-container], etc.
    - .ce-popover-item* → [data-blok-testid="popover-item*"], [data-blok-popover-item-confirmation], etc.
    - .ce-paragraph, .ce-header → [data-blok-tool="paragraph|header"]
    - .cdx-list* → [data-blok-list], [data-blok-list-item], etc.
    - .cdx-button, .cdx-input, .cdx-loader → [data-blok-button], etc.
    - .tc-* (table tool) → [data-blok-testid="table-*"]
  • Updates data attributes (data-id → data-blok-id)
  • Changes default holder from 'editorjs' to 'blok'
  • Updates package.json dependencies
  • Transforms nested i18n messages to flat dot-notation format with camelCase keys:
    - { ui: { toolbar: { Add: "..." } } } → { "ui.toolbar.add": "..." }
    - { toolNames: { "Nothing found": "..." } } → { "toolNames.nothingFound": "..." }
  • Maps changed i18n keys to their Blok equivalents (camelCase):
    - "Click to tune" → "clickToOpenMenu"
    - "or drag to move" → "dragToMove"
    - "Add" (toolbar) → "clickToAddBelow"
    - "Filter" (popover) → "search"
    - "Ordered List" → "numberedList"
    - "Unordered List" → "bulletedList"
  • Removes obsolete keys (moveUp/moveDown replaced with drag)

  Old Blok → Modular Blok Migration:
  • Splits combined imports into core and tools:
    - import { Blok, Header } from '@jackuait/blok'
    → import { Blok } from '@jackuait/blok';
      import { Header } from '@jackuait/blok/tools';
  • Transforms static property access to direct references:
    - Blok.Header → Header (with import added)
    - Blok.Paragraph → Paragraph
    - Blok.List → List
    - Blok.Bold, Blok.Italic, Blok.Link, Blok.Convert → Bold, Italic, Link, Convert
  • Ensures tools are imported from @jackuait/blok/tools when used

Note: After running, you may need to manually:
  • Update any custom tool implementations
  • Review and test the changes
  • Run 'npm install' or 'yarn' to update dependencies
`);
}

function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const useLibraryI18n = args.includes('--use-library-i18n');
  const help = args.includes('--help') || args.includes('-h');

  global.isVerbose = verbose;

  if (help) {
    printHelp();
    process.exit(0);
  }

  // Get target path
  const targetPath = args.find((arg) => !arg.startsWith('--')) || '.';
  const absolutePath = path.resolve(targetPath);

  if (!fs.existsSync(absolutePath)) {
    console.error(`Error: Path does not exist: ${absolutePath}`);
    process.exit(1);
  }

  console.log('\n🔄 EditorJS to Blok Migration\n');
  console.log(`📁 Target: ${absolutePath}`);
  console.log(`🔍 Mode: ${dryRun ? 'Dry run (no changes will be made)' : 'Live'}\n`);

  const stats = {
    filesScanned: 0,
    filesModified: 0,
    totalChanges: 0,
  };

  // Get all files to process
  let files = [];
  if (fs.statSync(absolutePath).isDirectory()) {
    files = getAllFiles(absolutePath);
  } else {
    files = [absolutePath];
  }

  stats.filesScanned = files.length;

  console.log(`📝 Scanning ${files.length} files...\n`);

  // Process each file
  files.forEach((filePath) => {
    const result = transformFile(filePath, dryRun, useLibraryI18n);

    if (result.hasChanges) {
      stats.filesModified++;
      stats.totalChanges += result.changes.length;

      const relativePath = path.relative(absolutePath, filePath);
      console.log(`✏️  ${relativePath}`);

      if (verbose) {
        result.changes.forEach((change) => {
          console.log(`    - [${change.category}] ${change.count} occurrence(s)`);
          if (change.note) {
            console.log(`      Note: ${change.note}`);
          }
        });
      }
    }
  });

  // Process package.json
  const packageJsonPath = path.join(
    fs.statSync(absolutePath).isDirectory() ? absolutePath : path.dirname(absolutePath),
    'package.json'
  );

  const pkgResult = updatePackageJson(packageJsonPath, dryRun);
  if (pkgResult.hasChanges) {
    console.log(`\n📦 package.json updates:`);
    pkgResult.changes.forEach((change) => {
      const symbol = change.action === 'add' ? '+' : '-';
      console.log(`    ${symbol} ${change.package} (${change.type})`);
    });
  }

  // Print summary
  console.log('\n' + '─'.repeat(50));
  console.log('\n📊 Summary:\n');
  console.log(`   Files scanned:  ${stats.filesScanned}`);
  console.log(`   Files modified: ${stats.filesModified}`);
  console.log(`   Total changes:  ${stats.totalChanges}`);

  if (dryRun) {
    console.log('\n⚠️  Dry run complete. No files were modified.');
    console.log('   Run without --dry-run to apply changes.\n');
  } else {
    console.log('\n✅ Migration complete!\n');
    console.log('📋 Next steps:');
    console.log('   1. Run `npm install` or `yarn` to update dependencies');
    console.log('   2. Review the changes in your codebase');
    console.log('   3. Test your application thoroughly');
    console.log('   4. Check MIGRATION.md for any manual updates needed\n');
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

// Export for testing
module.exports = {
  transformFile,
  updatePackageJson,
  applyTransforms,
  ensureBlokImport,
  ensureToolsImport,
  splitBlokImports,
  normalizeKey,
  flattenI18nDictionary,
  transformI18nConfig,
  removeI18nMessages,
  parseObjectLiteral,
  findMatchingBrace,
  objectToString,
  I18N_KEY_MAPPINGS,
  BUNDLED_TOOLS,
  INLINE_TOOLS,
  ALL_TOOLS,
  IMPORT_TRANSFORMS,
  TYPE_TRANSFORMS,
  CLASS_NAME_TRANSFORMS,
  CSS_CLASS_TRANSFORMS,
  DATA_ATTRIBUTE_TRANSFORMS,
  SELECTOR_TRANSFORMS,
  HOLDER_TRANSFORMS,
  TOOL_CONFIG_TRANSFORMS,
  TEXT_TRANSFORMS,
};

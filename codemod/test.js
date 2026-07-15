/**
 * Tests for the EditorJS to Blok codemod
 */

const {
  applyTransforms,
  updatePackageJson,
  ensureBlokImport,
  ensureToolsImport,
  splitBlokImports,
  normalizeKey,
  flattenI18nDictionary,
  transformI18nConfig,
  removeI18nMessages,
  I18N_KEY_MAPPINGS,
  BUNDLED_TOOLS,
  INLINE_TOOLS,
  ALL_TOOLS,
  IMPORT_TRANSFORMS,
  SCOPE_RENAME_TRANSFORMS,
  TYPE_TRANSFORMS,
  CLASS_NAME_TRANSFORMS,
  CSS_CLASS_TRANSFORMS,
  DATA_ATTRIBUTE_TRANSFORMS,
  SELECTOR_TRANSFORMS,
  HOLDER_TRANSFORMS,
  TOOL_CONFIG_TRANSFORMS,
  BLOCK_TYPE_TRANSFORMS,
  applyBlockTypeTransforms,
  renameEditorJsIdentifiers,
  transformFile,
} = require('./migrate-editorjs-to-blok');

const fs = require('fs');
const os = require('os');
const nodePath = require('path');

// Test helper
function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.message}`);
    process.exitCode = 1;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

function assert(condition, message = 'assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

// ============================================================================
// Import Tests
// ============================================================================

console.log('\n📦 Import Transformations\n');

test('transforms @editorjs/editorjs default import to named import', () => {
  const input = `import EditorJS from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok } from '@blok/core';`);
});

test('transforms @editorjs/editorjs aliased default import', () => {
  const input = `import Editor from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok as Editor } from '@blok/core';`);
});

test('transforms require statement', () => {
  const input = `const EditorJS = require('@editorjs/editorjs');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const EditorJS = require('@blok/core').Blok;`);
});

test('transforms namespace import to named import', () => {
  const input = `import * as EditorJS from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok as EditorJS } from '@blok/core';`);
});

test('transforms destructured default require', () => {
  const input = `const { default: EditorJS } = require('@editorjs/editorjs');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { Blok: EditorJS } = require('@blok/core');`);
});

test('transforms dynamic import', () => {
  const input = `const Editor = await import('@editorjs/editorjs');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const Editor = await import('@blok/core').then(m => ({ default: m.Blok }));`);
});

test('transforms dynamic import with .then(m => m.default) pattern', () => {
  const input = `import('@editorjs/editorjs').then(m => m.default);`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import('@blok/core').then(m => m.Blok);`);
});

test('transforms type-only default import', () => {
  const input = `import type EditorJS from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import type { Blok as EditorJS } from '@blok/core';`);
});

test('transforms @editorjs/header import to named import', () => {
  const input = `import Header from '@editorjs/header';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Header } from '@blok/core';\n`);
});

test('transforms @editorjs/paragraph import to named import', () => {
  const input = `import Paragraph from '@editorjs/paragraph';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Paragraph } from '@blok/core';\n`);
});

test('transforms @editorjs/list import to named import', () => {
  const input = `import List from '@editorjs/list';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { List } from '@blok/core';\n`);
});

// Combined default + named import tests
test('transforms combined default + named import', () => {
  const input = `import EditorJS, { EditorConfig } from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok, EditorConfig } from '@blok/core';`);
});

test('transforms aliased combined default + named import', () => {
  const input = `import Editor, { EditorConfig } from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok as Editor, EditorConfig } from '@blok/core';`);
});

// Re-export tests
test('transforms default re-export as named', () => {
  const input = `export { default as Editor } from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `export { Blok as Editor } from '@blok/core';`);
});

test('transforms default re-export', () => {
  const input = `export { default } from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `export { Blok } from '@blok/core';`);
});

// Dynamic import with destructuring
test('transforms destructured dynamic import', () => {
  const input = `const { default: Editor } = await import('@editorjs/editorjs');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { Blok: Editor } = await import('@blok/core');`);
});

// Tool require statements
test('transforms Header require statement', () => {
  const input = `const Header = require('@editorjs/header');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { Header } = require('@blok/core');`);
});

test('transforms aliased Header require statement', () => {
  const input = `const MyHeader = require('@editorjs/header');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { Header: MyHeader } = require('@blok/core');`);
});

test('transforms Paragraph require statement', () => {
  const input = `const Paragraph = require('@editorjs/paragraph');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { Paragraph } = require('@blok/core');`);
});

test('transforms List require statement', () => {
  const input = `const List = require('@editorjs/list');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { List } = require('@blok/core');`);
});

// ============================================================================
// Type Tests
// ============================================================================

console.log('\n🔤 Type Transformations\n');

test('transforms EditorConfig type', () => {
  const input = `const config: EditorConfig = {};`;
  const { result } = applyTransforms(input, TYPE_TRANSFORMS);
  assertEqual(result, `const config: BlokConfig = {};`);
});

test('transforms EditorJS.EditorConfig type', () => {
  const input = `const config: EditorJS.EditorConfig = {};`;
  const { result } = applyTransforms(input, TYPE_TRANSFORMS);
  assertEqual(result, `const config: BlokConfig = {};`);
});

// ============================================================================
// Class Name Tests
// ============================================================================

console.log('\n📝 Class Name Transformations\n');

test('transforms new EditorJS() constructor', () => {
  const input = `const editor = new EditorJS({ holder: 'editor' });`;
  const { result } = applyTransforms(input, CLASS_NAME_TRANSFORMS);
  assertEqual(result, `const editor = new Blok({ holder: 'editor' });`);
});

test('transforms EditorJS type annotation', () => {
  const input = `let editor: EditorJS;`;
  const { result } = applyTransforms(input, CLASS_NAME_TRANSFORMS);
  assertEqual(result, `let editor: Blok;`);
});

test('transforms generic type parameter', () => {
  const input = `const ref = useRef<EditorJS>(null);`;
  const { result } = applyTransforms(input, CLASS_NAME_TRANSFORMS);
  assertEqual(result, `const ref = useRef<Blok>(null);`);
});

// ============================================================================
// CSS Class Tests
// ============================================================================

console.log('\n🎨 CSS Class Transformations\n');

test('transforms .codex-editor class', () => {
  const input = `.codex-editor { color: red; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-editor] { color: red; }`);
});

test('transforms .codex-editor__redactor class', () => {
  const input = `.codex-editor__redactor { padding: 20px; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-redactor] { padding: 20px; }`);
});

test('transforms .ce-block class', () => {
  const input = `.ce-block { margin: 10px; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-element] { margin: 10px; }`);
});

test('transforms .ce-block--selected class', () => {
  const input = `.ce-block--selected { background: blue; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-selected="true"] { background: blue; }`);
});

test('transforms .ce-toolbar class', () => {
  const input = `document.querySelector('.ce-toolbar')`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `document.querySelector('[data-blok-toolbar]')`);
});

test('transforms .ce-inline-toolbar class', () => {
  const input = `.ce-inline-toolbar { display: flex; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-testid="inline-toolbar"] { display: flex; }`);
});

test('transforms .ce-paragraph class', () => {
  const input = `.ce-paragraph { line-height: 1.6; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-tool="paragraph"] { line-height: 1.6; }`);
});

test('transforms .ce-header class', () => {
  const input = `.ce-header { font-weight: bold; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-tool="header"] { font-weight: bold; }`);
});

test('transforms .ce-inline-tool--link class', () => {
  const input = `.ce-inline-tool--link { color: blue; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-testid="inline-tool-link"] { color: blue; }`);
});

test('transforms .ce-inline-tool--bold class', () => {
  const input = `.ce-inline-tool--bold { font-weight: bold; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-testid="inline-tool-bold"] { font-weight: bold; }`);
});

test('transforms .ce-inline-tool--italic class', () => {
  const input = `.ce-inline-tool--italic { font-style: italic; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-testid="inline-tool-italic"] { font-style: italic; }`);
});

test('transforms .ce-popover class', () => {
  const input = `.ce-popover { position: absolute; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-popover] { position: absolute; }`);
});

test('transforms .ce-popover--opened class', () => {
  const input = `.ce-popover--opened { display: block; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-popover-opened="true"] { display: block; }`);
});

test('transforms .ce-popover__container class', () => {
  const input = `.ce-popover__container { overflow: hidden; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-popover-container] { overflow: hidden; }`);
});

test('transforms class names without dot prefix (string literals)', () => {
  const input = `element.classList.add('ce-block');`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `element.classList.add('data-blok-element');`);
});

test('transforms codex-editor in string literals', () => {
  const input = `const wrapper = document.querySelector("codex-editor");`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `const wrapper = document.querySelector("data-blok-editor");`);
});

// ============================================================================
// Data Attribute Tests
// ============================================================================

console.log('\n🏷️  Data Attribute Transformations\n');

test('transforms data-id attribute', () => {
  const input = `<div data-id="abc123">`;
  const { result } = applyTransforms(input, DATA_ATTRIBUTE_TRANSFORMS);
  assertEqual(result, `<div data-blok-id="abc123">`);
});

test('transforms data-item-name attribute', () => {
  const input = `<button data-item-name="bold">`;
  const { result } = applyTransforms(input, DATA_ATTRIBUTE_TRANSFORMS);
  assertEqual(result, `<button data-blok-item-name="bold">`);
});

test('transforms data-empty attribute', () => {
  const input = `<div data-empty="true">`;
  const { result } = applyTransforms(input, DATA_ATTRIBUTE_TRANSFORMS);
  assertEqual(result, `<div data-blok-empty="true">`);
});

test('transforms data-cy=editorjs selector', () => {
  const input = `[data-cy="editorjs"]`;
  const { result } = applyTransforms(input, DATA_ATTRIBUTE_TRANSFORMS);
  assertEqual(result, `[data-blok-testid="blok-editor"]`);
});

// ============================================================================
// Selector Tests
// ============================================================================

console.log('\n🔍 Selector Transformations\n');

test('transforms [data-id=] selector', () => {
  const input = `document.querySelector('[data-id="123"]')`;
  const { result } = applyTransforms(input, SELECTOR_TRANSFORMS);
  assertEqual(result, `document.querySelector('[data-blok-id="123"]')`);
});

test('transforms [data-item-name=] selector', () => {
  const input = `page.locator('[data-item-name="delete"]')`;
  const { result } = applyTransforms(input, SELECTOR_TRANSFORMS);
  assertEqual(result, `page.locator('[data-blok-item-name="delete"]')`);
});

// ============================================================================
// Holder Tests
// ============================================================================

console.log('\n🏠 Holder Transformations\n');

test('transforms id="editorjs" in HTML', () => {
  const input = `<div id="editorjs"></div>`;
  const { result } = applyTransforms(input, HOLDER_TRANSFORMS);
  assertEqual(result, `<div id="blok"></div>`);
});

test('transforms holder config option', () => {
  const input = `{ holder: 'editorjs' }`;
  const { result } = applyTransforms(input, HOLDER_TRANSFORMS);
  assertEqual(result, `{ holder: 'blok' }`);
});

test('transforms getElementById call', () => {
  const input = `document.getElementById('editorjs')`;
  const { result } = applyTransforms(input, HOLDER_TRANSFORMS);
  assertEqual(result, `document.getElementById('blok')`);
});

// ============================================================================
// Tool Config Tests
// ============================================================================

console.log('\n🔧 Tool Config Transformations\n');

test('transforms class: Blok.Header to class: Header', () => {
  const input = `{ class: Blok.Header, config: {} }`;
  const { result } = applyTransforms(input, TOOL_CONFIG_TRANSFORMS);
  assertEqual(result, `{ class: Header, config: {} }`);
});

test('transforms class: Blok.Paragraph to class: Paragraph', () => {
  const input = `{ class: Blok.Paragraph, config: {} }`;
  const { result } = applyTransforms(input, TOOL_CONFIG_TRANSFORMS);
  assertEqual(result, `{ class: Paragraph, config: {} }`);
});

test('transforms standalone Blok.Paragraph reference', () => {
  const input = `tools: { paragraph: Blok.Paragraph, header: Blok.Header }`;
  const { result } = applyTransforms(input, TOOL_CONFIG_TRANSFORMS);
  assertEqual(result, `tools: { paragraph: Paragraph, header: Header }`);
});

test('transforms class: Blok.List to class: List', () => {
  const input = `{ class: Blok.List, config: {} }`;
  const { result } = applyTransforms(input, TOOL_CONFIG_TRANSFORMS);
  assertEqual(result, `{ class: List, config: {} }`);
});

test('transforms standalone Blok.List reference', () => {
  const input = `tools: { list: Blok.List }`;
  const { result } = applyTransforms(input, TOOL_CONFIG_TRANSFORMS);
  assertEqual(result, `tools: { list: List }`);
});

test('does not transform ListConfig or ListItem', () => {
  const input = `import { ListConfig, ListItem } from './types';`;
  const { result } = applyTransforms(input, TOOL_CONFIG_TRANSFORMS);
  assertEqual(result, `import { ListConfig, ListItem } from './types';`);
});

// ============================================================================
// Integration Tests
// ============================================================================

console.log('\n🔗 Integration Tests\n');

test('transforms complete EditorJS setup', () => {
  const input = `
import EditorJS from '@editorjs/editorjs';
import Header from '@editorjs/header';

const editor = new EditorJS({
  holder: 'editorjs',
  tools: {
    header: {
      class: Header,
    },
  },
});
`;

  let result = input;
  result = applyTransforms(result, IMPORT_TRANSFORMS).result;
  result = applyTransforms(result, CLASS_NAME_TRANSFORMS).result;
  result = applyTransforms(result, HOLDER_TRANSFORMS).result;
  result = applyTransforms(result, TOOL_CONFIG_TRANSFORMS).result;

  // Check key transformations
  if (!result.includes("from '@blok/core'")) {
    throw new Error('Import not transformed');
  }
  if (!result.includes('new Blok(')) {
    throw new Error('Constructor not transformed');
  }
  if (!result.includes("holder: 'blok'")) {
    throw new Error('Holder not transformed');
  }
  // Header is imported as named import, class: Header stays as-is (not Blok.Header anymore)
  if (!result.includes('class: Header')) {
    throw new Error('Tool class should remain Header (named import)');
  }
});

test('does not transform unrelated EditorJS-like strings', () => {
  const input = `const myEditorJSConfig = {};`;
  const { result } = applyTransforms(input, CLASS_NAME_TRANSFORMS);
  // Should not transform variable names containing EditorJS
  assertEqual(result, input);
});

// ============================================================================
// Ensure Blok Import Tests
// ============================================================================

console.log('\n📥 Ensure Blok Import\n');

test('adds Header import when Header is used with no existing import', () => {
  const input = `const editor = new Blok({
  tools: { header: Header }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("import { Header } from '@blok/core';"), true, 'Should add Header import');
});

test('adds tool imports after existing imports', () => {
  const input = `import React from 'react';
import { useState } from 'react';

const editor = new Blok({
  tools: { header: Header }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should indicate change');
  // Check that import is added after existing imports
  const headerImportIndex = result.indexOf("import { Header } from '@blok/core';");
  const lastReactImportIndex = result.indexOf("import { useState } from 'react';");
  assertEqual(headerImportIndex > lastReactImportIndex, true, 'Header import should be after existing imports');
});

test('adds missing tools to existing @blok/core import', () => {
  const input = `import { Blok } from '@blok/core';

const editor = new Blok({
  tools: { header: Header }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes('Header, Blok'), true, 'Should add Header to existing import');
});

test('adds multiple missing tools to existing import', () => {
  const input = `import { Blok } from '@blok/core';

const editor = new Blok({
  tools: { header: Header, paragraph: Paragraph }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes('Header'), true, 'Should include Header');
  assertEqual(result.includes('Paragraph'), true, 'Should include Paragraph');
});

test('does not modify when tools are already imported', () => {
  const input = `import { Blok, Header } from '@blok/core';

const editor = new Blok({
  tools: { header: Header }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, false, 'Should not indicate change');
  assertEqual(result, input, 'Content should be unchanged');
});

test('does not modify when no bundled tools are used', () => {
  const input = `import { Blok } from '@blok/core';

const editor = new Blok({});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, false, 'Should not indicate change when no tools used');
  assertEqual(result, input, 'Content should be unchanged');
});

test('detects Paragraph usage', () => {
  const input = `const editor = new Blok({
  tools: { paragraph: Paragraph }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should detect Paragraph');
  assertEqual(result.includes("import { Paragraph } from '@blok/core';"), true, 'Should add Paragraph import');
});

test('detects List usage', () => {
  const input = `const editor = new Blok({
  tools: { list: List }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should detect List');
  assertEqual(result.includes("import { List } from '@blok/core';"), true, 'Should add List import');
});

test('handles multiple tool usage', () => {
  const input = `const editor = new Blok({
  tools: {
    header: Header,
    paragraph: Paragraph
  }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should detect multiple tools');
  assertEqual(result.includes('Header'), true, 'Should add Header import');
  assertEqual(result.includes('Paragraph'), true, 'Should add Paragraph import');
});

test('full migration adds imports for bundled tools', () => {
  // This simulates a complete migration from EditorJS with bundled tools
  const input = `import EditorJS from '@editorjs/editorjs';
import Header from '@editorjs/header';
import Paragraph from '@editorjs/paragraph';

const editor = new EditorJS({
  holder: 'editorjs',
  tools: {
    header: {
      class: Header,
    },
    paragraph: {
      class: Paragraph,
    },
  },
});`;

  let result = input;
  result = applyTransforms(result, IMPORT_TRANSFORMS).result;
  result = applyTransforms(result, CLASS_NAME_TRANSFORMS).result;
  result = applyTransforms(result, HOLDER_TRANSFORMS).result;
  result = applyTransforms(result, TOOL_CONFIG_TRANSFORMS).result;
  result = ensureBlokImport(result).result;

  // After transformation, should have @blok/core imports
  assertEqual(result.includes("from '@blok/core'"), true, 'Should have @blok/core import');
  // With named exports, tools are imported directly, not as Blok.Header
  assertEqual(result.includes('class: Header'), true, 'Should use Header (named import)');
  assertEqual(result.includes('class: Paragraph'), true, 'Should use Paragraph (named import)');
});

// ============================================================================
// i18n Transformation Tests
// ============================================================================

console.log('\n🌐 i18n Transformations\n');

test('flattenI18nDictionary flattens simple nested object', () => {
  const input = {
    ui: {
      toolbar: {
        toolbox: {
          Add: 'Добавить'
        }
      }
    }
  };
  const result = flattenI18nDictionary(input);
  // 'ui.toolbar.toolbox.Add' is mapped to 'toolbox.addBelow' by I18N_KEY_MAPPINGS
  assertEqual(result['toolbox.addBelow'], 'Добавить');
});

test('flattenI18nDictionary flattens deeply nested object', () => {
  const input = {
    ui: {
      blockTunes: {
        toggler: {
          'Drag to move': 'Перетащите'
        }
      }
    }
  };
  const result = flattenI18nDictionary(input);
  // Keys are normalized to camelCase and mapped to simplified keys
  assertEqual(result['blockSettings.dragToMove'], 'Перетащите');
});

test('flattenI18nDictionary handles multiple namespaces', () => {
  const input = {
    toolNames: {
      Text: 'Текст',
      Bold: 'Жирный'
    },
    tools: {
      link: {
        'Add a link': 'Добавить ссылку'
      }
    }
  };
  const result = flattenI18nDictionary(input);
  // Keys are normalized to camelCase
  assertEqual(result['toolNames.text'], 'Текст');
  assertEqual(result['toolNames.bold'], 'Жирный');
  assertEqual(result['tools.link.addALink'], 'Добавить ссылку');
});

test('flattenI18nDictionary applies key mappings', () => {
  const input = {
    ui: {
      blockTunes: {
        toggler: {
          'Click to tune': 'Нажмите для настройки'
        }
      }
    }
  };
  const result = flattenI18nDictionary(input);
  // 'Click to tune' should be mapped to 'blockSettings.clickToOpenMenu'
  assertEqual(result['blockSettings.clickToOpenMenu'], 'Нажмите для настройки');
  assertEqual(result['ui.blockTunes.toggler.Click to tune'], undefined);
});

test('flattenI18nDictionary handles empty object', () => {
  const result = flattenI18nDictionary({});
  assertEqual(Object.keys(result).length, 0);
});

test('transformI18nConfig transforms nested i18n config in JS', () => {
  const input = `const editor = new Blok({
  i18n: {
    messages: {
      toolNames: {
        Text: "Текст",
        Bold: "Жирный"
      }
    }
  }
});`;
  const { result, changed } = transformI18nConfig(input);
  assertEqual(changed, true, 'Should indicate change');
  // Keys are normalized to camelCase
  assertEqual(result.includes('"toolNames.text": "Текст"'), true, 'Should have flattened toolNames.text');
  assertEqual(result.includes('"toolNames.bold": "Жирный"'), true, 'Should have flattened toolNames.bold');
});

test('transformI18nConfig transforms deeply nested messages', () => {
  const input = `const config = {
  i18n: {
    messages: {
      ui: {
        popover: {
          Search: "Поиск",
          "Nothing found": "Ничего не найдено"
        }
      }
    }
  }
};`;
  const { result, changed } = transformI18nConfig(input);
  assertEqual(changed, true, 'Should indicate change');
  // Keys are normalized to camelCase and mapped to simplified keys
  assertEqual(result.includes('"popover.search": "Поиск"'), true, 'Should have flattened popover.search');
  assertEqual(result.includes('"popover.nothingFound": "Ничего не найдено"'), true, 'Should have flattened popover.nothingFound');
});

test('transformI18nConfig does not change content without i18n config', () => {
  const input = `const editor = new Blok({
  holder: 'blok',
  tools: {}
});`;
  const { result, changed } = transformI18nConfig(input);
  assertEqual(changed, false, 'Should not indicate change');
  assertEqual(result, input, 'Content should be unchanged');
});

test('transformI18nConfig skips dynamic content with functions', () => {
  const input = `const editor = new Blok({
  i18n: {
    messages: {
      toolNames: {
        Text: () => getTranslation('text')
      }
    }
  }
});`;
  const { result, changed } = transformI18nConfig(input);
  assertEqual(changed, false, 'Should not transform dynamic content');
  assertEqual(result, input, 'Content should be unchanged');
});

test('transformI18nConfig handles single quotes', () => {
  const input = `const editor = new Blok({
  i18n: {
    messages: {
      toolNames: {
        Text: 'Текст'
      }
    }
  }
});`;
  const { result, changed } = transformI18nConfig(input);
  assertEqual(changed, true, 'Should indicate change');
  // Keys are normalized to camelCase
  assertEqual(result.includes('"toolNames.text": "Текст"'), true, 'Should have flattened key with value');
});

test('I18N_KEY_MAPPINGS contains expected mappings', () => {
  // UI key mappings (values use simplified key format)
  assertEqual(I18N_KEY_MAPPINGS['ui.blockTunes.toggler.Click to tune'], 'blockSettings.clickToOpenMenu');
  assertEqual(I18N_KEY_MAPPINGS['ui.blockTunes.toggler.or drag to move'], 'blockSettings.dragToMove');
  assertEqual(I18N_KEY_MAPPINGS['ui.toolbar.toolbox.Add'], 'toolbox.addBelow');
  assertEqual(I18N_KEY_MAPPINGS['ui.inlineToolbar.converter.Convert to'], 'popover.convertTo');
  assertEqual(I18N_KEY_MAPPINGS['ui.popover.Filter'], 'popover.search');

  // Tool names mappings (values are now camelCase)
  assertEqual(I18N_KEY_MAPPINGS['toolNames.Ordered List'], 'toolNames.numberedList');
  assertEqual(I18N_KEY_MAPPINGS['toolNames.Unordered List'], 'toolNames.bulletedList');

  // Tools messages mappings (values are now camelCase)
  assertEqual(I18N_KEY_MAPPINGS['tools.stub.The block can not be displayed correctly'], 'tools.stub.blockCannotBeDisplayed');

  // Block tunes mappings
  assertEqual(I18N_KEY_MAPPINGS['blockTunes.delete.Delete'], 'blockSettings.delete');

  // Removed keys (mapped to null)
  assertEqual(I18N_KEY_MAPPINGS['blockTunes.moveUp.Move up'], null);
  assertEqual(I18N_KEY_MAPPINGS['blockTunes.moveDown.Move down'], null);
});

test('flattenI18nDictionary applies tool name mappings', () => {
  const input = {
    toolNames: {
      'Ordered List': 'Нумерованный список',
      'Unordered List': 'Маркированный список',
    },
  };
  const result = flattenI18nDictionary(input);
  // Keys are mapped and normalized to camelCase
  assertEqual(result['toolNames.numberedList'], 'Нумерованный список');
  assertEqual(result['toolNames.bulletedList'], 'Маркированный список');
  assertEqual(result['toolNames.Ordered List'], undefined);
  assertEqual(result['toolNames.Unordered List'], undefined);
});

test('flattenI18nDictionary applies Filter to Search mapping', () => {
  const input = {
    ui: {
      popover: {
        Filter: 'Фильтр',
        'Nothing found': 'Ничего не найдено',
      },
    },
  };
  const result = flattenI18nDictionary(input);
  // Keys are mapped to simplified keys
  assertEqual(result['popover.search'], 'Фильтр');
  assertEqual(result['popover.nothingFound'], 'Ничего не найдено');
  assertEqual(result['ui.popover.Filter'], undefined);
});

test('flattenI18nDictionary removes moveUp/moveDown keys', () => {
  const input = {
    blockTunes: {
      delete: {
        Delete: 'Удалить',
      },
      moveUp: {
        'Move up': 'Переместить вверх',
      },
      moveDown: {
        'Move down': 'Переместить вниз',
      },
    },
  };
  const result = flattenI18nDictionary(input);
  // Keys are mapped to simplified keys, moveUp/moveDown are removed
  assertEqual(result['blockSettings.delete'], 'Удалить');
  assertEqual(result['blockTunes.moveUp.Move up'], undefined);
  assertEqual(result['blockTunes.moveDown.Move down'], undefined);
});

test('flattenI18nDictionary applies stub message mapping', () => {
  const input = {
    tools: {
      stub: {
        'The block can not be displayed correctly': 'Блок не может быть отображен',
      },
    },
  };
  const result = flattenI18nDictionary(input);
  // Key is mapped and normalized to camelCase
  assertEqual(result['tools.stub.blockCannotBeDisplayed'], 'Блок не может быть отображен');
  assertEqual(result['tools.stub.The block can not be displayed correctly'], undefined);
});

console.log('\n🔤 normalizeKey\n');

test('normalizeKey converts single word to lowercase', () => {
  assertEqual(normalizeKey('toolNames.Text'), 'toolNames.text');
  assertEqual(normalizeKey('toolNames.Bold'), 'toolNames.bold');
});

test('normalizeKey converts multi-word keys to camelCase', () => {
  assertEqual(normalizeKey('popover.Nothing found'), 'popover.nothingFound');
  assertEqual(normalizeKey('toolbox.Click to add below'), 'toolbox.clickToAddBelow');
});

test('normalizeKey handles keys with multiple spaces', () => {
  assertEqual(normalizeKey('tools.stub.The block can not be displayed'), 'tools.stub.theBlockCanNotBeDisplayed');
});

test('normalizeKey preserves namespace segments', () => {
  assertEqual(normalizeKey('blockSettings.Drag to move'), 'blockSettings.dragToMove');
});

console.log('\n🗑️  removeI18nMessages (--use-library-i18n)\n');

test('removeI18nMessages removes messages property from i18n config', () => {
  const input = `const editor = new Blok({
  i18n: {
    messages: {
      toolNames: {
        Text: "Текст"
      }
    }
  }
});`;
  const { result, changed } = removeI18nMessages(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes('messages'), false, 'Should not contain messages property');
  assertEqual(result.includes('i18n: {}'), true, 'Should have empty i18n config');
});

test('removeI18nMessages preserves locale property', () => {
  const input = `const editor = new Blok({
  i18n: {
    messages: {
      toolNames: { Text: "Текст" }
    },
    locale: 'ru'
  }
});`;
  const { result, changed } = removeI18nMessages(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes('messages'), false, 'Should not contain messages property');
  assertEqual(result.includes("locale: 'ru'"), true, 'Should preserve locale property');
});

test('removeI18nMessages preserves direction property', () => {
  const input = `const editor = new Blok({
  i18n: {
    direction: 'rtl',
    messages: {
      toolNames: { Text: "نص" }
    }
  }
});`;
  const { result, changed } = removeI18nMessages(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes('messages'), false, 'Should not contain messages property');
  assertEqual(result.includes("direction: 'rtl'"), true, 'Should preserve direction property');
});

test('removeI18nMessages does not change content without messages', () => {
  const input = `const editor = new Blok({
  i18n: {
    locale: 'ru'
  }
});`;
  const { result, changed } = removeI18nMessages(input);
  assertEqual(changed, false, 'Should not indicate change');
  assertEqual(result, input, 'Content should be unchanged');
});

test('removeI18nMessages does not change content without i18n', () => {
  const input = `const editor = new Blok({
  holder: 'blok',
  tools: {}
});`;
  const { result, changed } = removeI18nMessages(input);
  assertEqual(changed, false, 'Should not indicate change');
  assertEqual(result, input, 'Content should be unchanged');
});

// ============================================================================
// Blok Default Import → Named Import Tests
// ============================================================================

console.log('\n🔄 Blok Default Import → Named Import Transformations\n');

test('transforms Blok default import to named import', () => {
  const input = `import Blok from '@blok/core';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok } from '@blok/core';`);
});

test('transforms aliased Blok default import to named import with alias', () => {
  const input = `import Editor from '@blok/core';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok as Editor } from '@blok/core';`);
});

test('transforms combined Blok default + named import', () => {
  const input = `import Blok, { BlokConfig } from '@blok/core';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok, BlokConfig } from '@blok/core';`);
});

test('transforms aliased combined Blok default + named import', () => {
  const input = `import Editor, { BlokConfig } from '@blok/core';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok as Editor, BlokConfig } from '@blok/core';`);
});

test('transforms type-only Blok default import', () => {
  const input = `import type Blok from '@blok/core';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import type { Blok } from '@blok/core';`);
});

test('transforms type-only aliased Blok default import', () => {
  const input = `import type Editor from '@blok/core';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import type { Blok as Editor } from '@blok/core';`);
});

test('transforms namespace import from @blok/core', () => {
  const input = `import * as Blok from '@blok/core';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok } from '@blok/core';`);
});

test('transforms aliased namespace import from @blok/core', () => {
  const input = `import * as Editor from '@blok/core';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok as Editor } from '@blok/core';`);
});

test('transforms destructured dynamic import from @blok/core', () => {
  const input = `const { default: Editor } = await import('@blok/core');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { Blok: Editor } = await import('@blok/core');`);
});

test('transforms require().default from @blok/core', () => {
  const input = `const Blok = require('@blok/core').default;`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const Blok = require('@blok/core').Blok;`);
});

test('transforms destructured require default from @blok/core', () => {
  const input = `const { default: Editor } = require('@blok/core');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { Blok: Editor } = require('@blok/core');`);
});

test('transforms re-export default as named from @blok/core', () => {
  const input = `export { default as Editor } from '@blok/core';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `export { Blok as Editor } from '@blok/core';`);
});

test('transforms re-export default from @blok/core', () => {
  const input = `export { default } from '@blok/core';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `export { Blok } from '@blok/core';`);
});

test('does not transform subpath imports from @blok/core/tools', () => {
  const input = `import Header from '@blok/core/tools';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  // Should not match because of the /tools path
  assertEqual(result, input);
});

test('does not transform named imports from @blok/core', () => {
  const input = `import { Blok, BlokConfig } from '@blok/core';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  // Named imports should not be transformed by the default import transforms
  assertEqual(result, input);
});

// ============================================================================
// Modular Import Tests (Strategy 5)
// ============================================================================

console.log('\n📦 Modular Import Transformations (Strategy 5)\n');

test('ALL_TOOLS contains block and inline tools', () => {
  assertEqual(ALL_TOOLS.includes('Header'), true, 'Should include Header');
  assertEqual(ALL_TOOLS.includes('Paragraph'), true, 'Should include Paragraph');
  assertEqual(ALL_TOOLS.includes('List'), true, 'Should include List');
  assertEqual(ALL_TOOLS.includes('Bold'), true, 'Should include Bold');
  assertEqual(ALL_TOOLS.includes('Italic'), true, 'Should include Italic');
  assertEqual(ALL_TOOLS.includes('Link'), true, 'Should include Link');
  assertEqual(ALL_TOOLS.includes('Convert'), true, 'Should include Convert');
});

test('splitBlokImports splits combined import with Blok and Header', () => {
  const input = `import { Blok, Header } from '@blok/core';`;
  const { result, changed } = splitBlokImports(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("from '@blok/core';"), true, 'Should have core import');
  assertEqual(result.includes("from '@blok/core/tools';"), true, 'Should have tools import');
  assertEqual(result.includes('Blok'), true, 'Should include Blok');
  assertEqual(result.includes('Header'), true, 'Should include Header');
});

test('splitBlokImports splits combined import with multiple tools', () => {
  const input = `import { Blok, Header, Paragraph, Bold } from '@blok/core';`;
  const { result, changed } = splitBlokImports(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("import { Blok } from '@blok/core';"), true, 'Should have core-only import');
  assertEqual(result.includes("import { Header, Paragraph, Bold } from '@blok/core/tools';"), true, 'Should have tools import');
});

test('splitBlokImports handles tools-only import', () => {
  const input = `import { Header, Paragraph } from '@blok/core';`;
  const { result, changed } = splitBlokImports(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("import { Header, Paragraph } from '@blok/core/tools';"), true, 'Should move to tools');
  assertEqual(result.includes("from '@blok/core';") && !result.includes("/tools"), false, 'Should not have empty core import');
});

test('splitBlokImports does not change core-only import', () => {
  const input = `import { Blok, BlokConfig } from '@blok/core';`;
  const { result, changed } = splitBlokImports(input);
  assertEqual(changed, false, 'Should not indicate change');
  assertEqual(result, input, 'Content should be unchanged');
});

test('splitBlokImports handles aliased imports', () => {
  const input = `import { Blok, Header as MyHeader } from '@blok/core';`;
  const { result, changed } = splitBlokImports(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("import { Blok } from '@blok/core';"), true, 'Should have core import');
  assertEqual(result.includes("Header as MyHeader"), true, 'Should preserve alias');
  assertEqual(result.includes("@blok/core/tools"), true, 'Should have tools import');
});

test('ensureToolsImport adds tools import when no import exists', () => {
  const input = `const editor = new Blok({
  tools: { header: Header }
});`;
  const { result, changed } = ensureToolsImport(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("from '@blok/core/tools';"), true, 'Should add tools import');
});

test('ensureToolsImport adds to existing /tools import', () => {
  const input = `import { Header } from '@blok/core/tools';

const editor = new Blok({
  tools: { header: Header, paragraph: Paragraph }
});`;
  const { result, changed } = ensureToolsImport(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes('Paragraph'), true, 'Should add Paragraph');
  assertEqual(result.includes("from '@blok/core/tools';"), true, 'Should use tools path');
});

test('ensureToolsImport does not duplicate when tools are in main import', () => {
  const input = `import { Blok, Header } from '@blok/core';

const editor = new Blok({
  tools: { header: Header }
});`;
  const { result, changed } = ensureToolsImport(input);
  // Tools are in main import, will be moved by splitBlokImports later
  assertEqual(changed, false, 'Should not add duplicate');
});

test('ensureToolsImport detects inline tools', () => {
  const input = `const editor = new Blok({
  tools: { bold: Bold, italic: Italic }
});`;
  const { result, changed } = ensureToolsImport(input);
  assertEqual(changed, true, 'Should detect inline tools');
  assertEqual(result.includes('Bold'), true, 'Should add Bold');
  assertEqual(result.includes('Italic'), true, 'Should add Italic');
  assertEqual(result.includes("from '@blok/core/tools';"), true, 'Should use tools path');
});

test('transforms Blok.Bold to Bold', () => {
  const input = `{ class: Blok.Bold, config: {} }`;
  const { result } = applyTransforms(input, TOOL_CONFIG_TRANSFORMS);
  assertEqual(result, `{ class: Bold, config: {} }`);
});

test('transforms Blok.Italic to Italic', () => {
  const input = `{ class: Blok.Italic, config: {} }`;
  const { result } = applyTransforms(input, TOOL_CONFIG_TRANSFORMS);
  assertEqual(result, `{ class: Italic, config: {} }`);
});

test('transforms Blok.Link to Link', () => {
  const input = `{ class: Blok.Link, config: {} }`;
  const { result } = applyTransforms(input, TOOL_CONFIG_TRANSFORMS);
  assertEqual(result, `{ class: Link, config: {} }`);
});

test('transforms Blok.Convert to Convert', () => {
  const input = `{ class: Blok.Convert, config: {} }`;
  const { result } = applyTransforms(input, TOOL_CONFIG_TRANSFORMS);
  assertEqual(result, `{ class: Convert, config: {} }`);
});

test('transforms standalone inline tool references', () => {
  const input = `tools: { bold: Blok.Bold, italic: Blok.Italic }`;
  const { result } = applyTransforms(input, TOOL_CONFIG_TRANSFORMS);
  assertEqual(result, `tools: { bold: Bold, italic: Italic }`);
});

test('full modular migration: old Blok import to new structure', () => {
  const input = `import { Blok, Header, Paragraph, Bold, Italic } from '@blok/core';

const editor = new Blok({
  holder: 'blok',
  tools: {
    header: { class: Header },
    paragraph: { class: Paragraph },
  },
  inlineTools: {
    bold: { class: Bold },
    italic: { class: Italic },
  },
});`;

  // Apply splitBlokImports
  const { result: splitResult, changed } = splitBlokImports(input);

  assertEqual(changed, true, 'Should split imports');
  assertEqual(splitResult.includes("import { Blok } from '@blok/core';"), true, 'Should have core import');
  assertEqual(splitResult.includes("import { Header, Paragraph, Bold, Italic } from '@blok/core/tools';"), true, 'Should have tools import');
});

// ============================================================================
// Block Type Transforms (Saved Data Migration)
// ============================================================================

console.log('\n📄 Block Type Transforms (Saved Data)\n');

test('renames delimiter block type to divider in JSON data', () => {
  const input = JSON.stringify({
    blocks: [
      { type: 'delimiter', data: {} },
      { type: 'paragraph', data: { text: 'hello' } },
    ]
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].type, 'divider');
  assertEqual(parsed.blocks[1].type, 'paragraph'); // unchanged
});

test('handles delimiter in compact JSON', () => {
  const input = '{"type":"delimiter","data":{}}';
  const result = applyBlockTypeTransforms(input);
  assertEqual(result.includes('"type":"divider"') || result.includes('"type": "divider"'), true, 'Should contain divider type');
  assertEqual(result.includes('delimiter'), false, 'Should not contain delimiter');
});

test('does not modify non-matching block types', () => {
  const input = JSON.stringify({ blocks: [{ type: 'paragraph', data: { text: 'test' } }] }, null, 2);
  const result = applyBlockTypeTransforms(input);
  assertEqual(result, input);
});

test('exports BLOCK_TYPE_TRANSFORMS constant', () => {
  assertEqual(typeof BLOCK_TYPE_TRANSFORMS, 'object');
  assertEqual(BLOCK_TYPE_TRANSFORMS.delimiter, 'divider');
});

test('migrates legacy image { data: { file: { url } } } to { data: { url } }', () => {
  const input = JSON.stringify({
    blocks: [
      { type: 'image', data: { file: { url: 'x.png' }, caption: 'c' } },
    ],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].type, 'image');
  assertEqual(parsed.blocks[0].data.url, 'x.png');
  assertEqual(parsed.blocks[0].data.caption, 'c');
  assertEqual(parsed.blocks[0].data.file, undefined, 'file wrapper must be dropped');
});

test('maps legacy image flags (withBorder, withBackground, stretched) to new image shape', () => {
  const input = JSON.stringify({
    blocks: [
      {
        type: 'image',
        data: {
          file: { url: 'x.png' },
          caption: 'c',
          withBorder: true,
          withBackground: false,
          stretched: true,
        },
      },
    ],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].data.url, 'x.png');
  assertEqual(parsed.blocks[0].data.caption, 'c');
  assertEqual(parsed.blocks[0].data.frame, 'border');
  assertEqual(parsed.blocks[0].data.size, 'full');
  assertEqual(parsed.blocks[0].data.withBorder, undefined, 'withBorder must be dropped');
  assertEqual(parsed.blocks[0].data.withBackground, undefined, 'withBackground must be dropped');
  assertEqual(parsed.blocks[0].data.stretched, undefined, 'stretched must be dropped');
  assertEqual(parsed.blocks[0].data.file, undefined, 'file wrapper must be dropped');
});

test('drops withBorder: false without adding frame', () => {
  const input = JSON.stringify({
    blocks: [{ type: 'image', data: { file: { url: 'u' }, withBorder: false } }],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].data.url, 'u');
  assertEqual(parsed.blocks[0].data.frame, undefined, 'no frame on withBorder: false');
  assertEqual(parsed.blocks[0].data.withBorder, undefined, 'withBorder must be dropped');
});

test('drops withBackground: true without any Blok equivalent', () => {
  const input = JSON.stringify({
    blocks: [{ type: 'image', data: { file: { url: 'u' }, withBackground: true } }],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].data.url, 'u');
  assertEqual(parsed.blocks[0].data.withBackground, undefined, 'withBackground must be dropped');
});

test('does not invent a size when stretched is absent (matches runtime)', () => {
  // Parity with the runtime: only `stretched: true` maps to `size: 'full'`.
  // A plain legacy image gets NO size — the codemod must not invent one the
  // runtime auto-migration would never add (the old codemod-only divergence).
  const input = JSON.stringify({
    blocks: [{ type: 'image', data: { file: { url: 'u' }, caption: 'c' } }],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].data.url, 'u');
  assertEqual(parsed.blocks[0].data.size, undefined, 'no size is invented when stretched is absent');
});

test('does not invent a size for stretched: false (matches runtime); drops stretched', () => {
  const input = JSON.stringify({
    blocks: [{ type: 'image', data: { file: { url: 'u' }, stretched: false } }],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].data.url, 'u');
  assertEqual(parsed.blocks[0].data.size, undefined, 'stretched:false adds no size');
  assertEqual(parsed.blocks[0].data.stretched, undefined, 'stretched must be dropped');
});

test('preserves explicit size in legacy image data', () => {
  const input = JSON.stringify({
    blocks: [{ type: 'image', data: { file: { url: 'u' }, size: 'medium' } }],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].data.url, 'u');
  assertEqual(parsed.blocks[0].data.size, 'medium', 'explicit size wins over default');
});

test('passes unknown legacy image fields through (future-proof)', () => {
  const input = JSON.stringify({
    blocks: [{ type: 'image', data: { file: { url: 'u' }, customField: 'x' } }],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].data.url, 'u');
  assertEqual(parsed.blocks[0].data.customField, 'x');
});

test('leaves already-migrated image blocks unchanged', () => {
  const input = JSON.stringify({
    blocks: [
      { type: 'image', data: { url: 'x.png', caption: 'c' } },
    ],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].data.url, 'x.png');
  assertEqual(parsed.blocks[0].data.caption, 'c');
});

test('maps @editorjs/simple-image (flat url + flags) to new image shape', () => {
  const input = JSON.stringify({
    blocks: [
      {
        type: 'image',
        data: {
          url: 'simple.png',
          caption: 'c',
          withBorder: true,
          withBackground: true,
          stretched: true,
        },
      },
    ],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].data.url, 'simple.png', 'flat url preserved');
  assertEqual(parsed.blocks[0].data.caption, 'c');
  assertEqual(parsed.blocks[0].data.frame, 'border', 'withBorder -> frame');
  assertEqual(parsed.blocks[0].data.size, 'full', 'stretched -> size full');
  assertEqual(parsed.blocks[0].data.withBorder, undefined, 'withBorder dropped');
  assertEqual(parsed.blocks[0].data.withBackground, undefined, 'withBackground dropped');
  assertEqual(parsed.blocks[0].data.stretched, undefined, 'stretched dropped');
});

// ============================================================================
// Block Data Migration - linkTool → bookmark
// ============================================================================

test('migrates full linkTool to bookmark with all meta fields', () => {
  const input = JSON.stringify({
    blocks: [
      {
        id: 'b1',
        type: 'linkTool',
        data: {
          link: 'https://example.com',
          meta: {
            title: 'Example',
            description: 'A site',
            image: { url: 'https://example.com/og.png' },
            favicon: 'https://example.com/favicon.ico',
            domain: 'example.com',
          },
        },
      },
    ],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  const block = parsed.blocks[0];
  assertEqual(block.id, 'b1', 'block id preserved');
  assertEqual(block.type, 'bookmark');
  assertEqual(block.data.url, 'https://example.com');
  assertEqual(block.data.title, 'Example');
  assertEqual(block.data.description, 'A site');
  assertEqual(block.data.image, 'https://example.com/og.png', 'image object flattened to url string');
  assertEqual(block.data.favicon, 'https://example.com/favicon.ico');
  assertEqual(block.data.domain, 'example.com');
  assertEqual(block.data.link, undefined, 'link key must be dropped');
  assertEqual(block.data.meta, undefined, 'meta wrapper must be dropped');
});

test('migrates linkTool with string image (not object)', () => {
  const input = JSON.stringify({
    blocks: [
      {
        type: 'linkTool',
        data: { link: 'https://x.io', meta: { image: 'https://x.io/p.png' } },
      },
    ],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].type, 'bookmark');
  assertEqual(parsed.blocks[0].data.url, 'https://x.io');
  assertEqual(parsed.blocks[0].data.image, 'https://x.io/p.png', 'string image passed through');
});

test('drops meta.site_name and unknown meta fields silently', () => {
  const input = JSON.stringify({
    blocks: [
      {
        type: 'linkTool',
        data: {
          link: 'https://x.io',
          meta: { title: 'T', site_name: 'X', somethingElse: 'y' },
        },
      },
    ],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].type, 'bookmark');
  assertEqual(parsed.blocks[0].data.title, 'T');
  assertEqual(parsed.blocks[0].data.site_name, undefined, 'site_name must be dropped');
  assertEqual(parsed.blocks[0].data.somethingElse, undefined, 'unknown meta field must be dropped');
});

test('migrates linkTool with no meta to bookmark with only url', () => {
  const input = JSON.stringify({
    blocks: [
      { type: 'linkTool', data: { link: 'https://only.url' } },
    ],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].type, 'bookmark');
  assertEqual(parsed.blocks[0].data.url, 'https://only.url');
  assertEqual(parsed.blocks[0].data.title, undefined, 'no title when no meta');
  assertEqual(parsed.blocks[0].data.image, undefined, 'no image when no meta');
});

test('drops meta.image when it is an object without a url', () => {
  const input = JSON.stringify({
    blocks: [
      { type: 'linkTool', data: { link: 'https://x.io', meta: { image: {} } } },
    ],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.blocks[0].type, 'bookmark');
  assertEqual(parsed.blocks[0].data.image, undefined, 'image dropped when no url string');
});

console.log('\n☑️  Checklist Block Expansion (Saved Data)\n');

test('expands checklist block into N flat list blocks with style checklist', () => {
  const input = JSON.stringify({
    blocks: [
      {
        type: 'checklist',
        data: {
          items: [
            { text: 'Buy milk', checked: true },
            { text: 'Walk dog', checked: false },
          ],
        },
      },
    ],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);

  assertEqual(parsed.blocks.length, 2, '2 items expand to 2 list blocks');

  assertEqual(parsed.blocks[0].type, 'list');
  assertEqual(parsed.blocks[0].data.text, 'Buy milk');
  assertEqual(parsed.blocks[0].data.checked, true, 'checked state preserved');
  assertEqual(parsed.blocks[0].data.style, 'checklist', 'style is checklist');
  assertEqual(typeof parsed.blocks[0].id, 'string', 'each list block has an id');
  assertEqual(parsed.blocks[0].id.length, 10, 'id is nanoid-compatible 10 chars');

  assertEqual(parsed.blocks[1].type, 'list');
  assertEqual(parsed.blocks[1].data.text, 'Walk dog');
  assertEqual(parsed.blocks[1].data.checked, false, 'unchecked state preserved');
  assertEqual(parsed.blocks[1].data.style, 'checklist', 'style is checklist');

  assertEqual(parsed.blocks[0].id !== parsed.blocks[1].id, true, 'each block gets a unique id');
});

test('expands empty checklist to zero list blocks without crashing', () => {
  const input = JSON.stringify({
    blocks: [
      { type: 'checklist', data: { items: [] } },
      { type: 'paragraph', data: { text: 'after' } },
    ],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);

  assertEqual(parsed.blocks.length, 1, 'empty checklist produces zero list blocks');
  assertEqual(parsed.blocks[0].type, 'paragraph', 'surrounding blocks are untouched');
  assertEqual(parsed.blocks[0].data.text, 'after');
});

test('preserves checklist block tunes on each expanded list block', () => {
  const input = JSON.stringify({
    blocks: [
      {
        type: 'checklist',
        tunes: { anchor: 'a1' },
        data: { items: [{ text: 'one', checked: false }] },
      },
    ],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);

  assertEqual(parsed.blocks.length, 1);
  assertEqual(parsed.blocks[0].type, 'list');
  assertEqual(parsed.blocks[0].data.text, 'one');
  assertEqual(parsed.blocks[0].tunes.anchor, 'a1', 'tunes carried onto expanded block');
});

test('does not modify documents without checklist blocks', () => {
  const input = JSON.stringify({
    blocks: [{ type: 'paragraph', data: { text: 'hello' } }],
  }, null, 2);
  const result = applyBlockTypeTransforms(input);
  const parsed = JSON.parse(result);

  assertEqual(parsed.blocks.length, 1, 'no extra blocks added');
  assertEqual(parsed.blocks[0].type, 'paragraph', 'paragraph passes through');
  assertEqual(parsed.blocks[0].data.text, 'hello');
});

console.log('\n🧱  Raw / Warning / Attaches / Table Mapping (Saved Data)\n');

test('maps raw block to a code block, preserving html as code text', () => {
  const input = JSON.stringify({
    blocks: [{ id: 'raw-1', type: 'raw', data: { html: '<div class="legacy">hi</div>' } }],
  }, null, 2);
  const parsed = JSON.parse(applyBlockTypeTransforms(input));

  assertEqual(parsed.blocks.length, 1);
  assertEqual(parsed.blocks[0].type, 'code', 'raw becomes code');
  assertEqual(parsed.blocks[0].data.code, '<div class="legacy">hi</div>', 'html preserved as code');
  assertEqual(parsed.blocks[0].id, 'raw-1', 'id preserved');
});

test('maps attaches block to a bookmark with url + title; file metadata dropped', () => {
  const input = JSON.stringify({
    blocks: [{
      id: 'att-1',
      type: 'attaches',
      data: { file: { url: 'https://x.com/r.pdf', name: 'r', size: 1024, extension: 'pdf' }, title: 'Report' },
    }],
  }, null, 2);
  const parsed = JSON.parse(applyBlockTypeTransforms(input));

  assertEqual(parsed.blocks[0].type, 'bookmark', 'attaches becomes bookmark');
  assertEqual(parsed.blocks[0].data.url, 'https://x.com/r.pdf', 'url mapped from file.url');
  assertEqual(parsed.blocks[0].data.title, 'Report', 'title preserved');
  assertEqual(parsed.blocks[0].data.size, undefined, 'file size dropped');
  assertEqual(parsed.blocks[0].data.extension, undefined, 'file extension dropped');
});

test('expands warning block into callout + title/message child paragraphs', () => {
  const input = JSON.stringify({
    blocks: [{ id: 'warn-1', type: 'warning', data: { title: 'Note', message: 'Be careful' } }],
  }, null, 2);
  const parsed = JSON.parse(applyBlockTypeTransforms(input));

  assertEqual(parsed.blocks.length, 3, 'callout + 2 child paragraphs');
  assertEqual(parsed.blocks[0].type, 'callout', 'warning becomes callout');
  assertEqual(parsed.blocks[0].id, 'warn-1', 'callout keeps warning id');
  assertEqual(parsed.blocks[0].data.emoji, '⚠️', 'warning emoji');
  assertEqual(parsed.blocks[0].data.backgroundColor, 'orange', 'orange background');
  assertEqual(parsed.blocks[1].type, 'paragraph', 'title child paragraph');
  assertEqual(parsed.blocks[1].data.text, 'Note');
  assertEqual(parsed.blocks[1].parent, 'warn-1', 'child parented to callout');
  assertEqual(parsed.blocks[2].data.text, 'Be careful', 'message child paragraph');
  assertEqual(parsed.blocks[0].content[0], parsed.blocks[1].id, 'callout references title child');
  assertEqual(parsed.blocks[0].content[1], parsed.blocks[2].id, 'callout references message child');
});

test('expands string-cell table into Blok cell-block-refs + child paragraphs', () => {
  const input = JSON.stringify({
    blocks: [{
      id: 'table-1',
      type: 'table',
      data: { withHeadings: true, content: [['Name', 'Age'], ['Alice', '30']] },
    }],
  }, null, 2);
  const parsed = JSON.parse(applyBlockTypeTransforms(input));

  const table = parsed.blocks.find((b) => b.type === 'table');
  const children = parsed.blocks.filter((b) => b.type === 'paragraph' && b.parent === 'table-1');

  assertEqual(table.data.withHeadings, true, 'withHeadings preserved');
  assertEqual(Array.isArray(table.data.content[0][0].blocks), true, 'cell is a block-ref');
  assertEqual(table.data.content[0][0].blocks.length, 1, 'non-empty cell references one child');
  assertEqual(children.length, 4, 'one child paragraph per non-empty cell');
  const texts = children.map((b) => b.data.text).sort();

  assertEqual(JSON.stringify(texts), JSON.stringify(['30', 'Age', 'Alice', 'Name']), 'cell texts carried into children');
});

test('emits empty table cells as { blocks: [] } with no child paragraph', () => {
  const input = JSON.stringify({
    blocks: [{ id: 'table-2', type: 'table', data: { withHeadings: false, content: [['A', '']] } }],
  }, null, 2);
  const parsed = JSON.parse(applyBlockTypeTransforms(input));

  const table = parsed.blocks.find((b) => b.type === 'table');
  const children = parsed.blocks.filter((b) => b.type === 'paragraph' && b.parent === 'table-2');

  assertEqual(JSON.stringify(table.data.content[0][1].blocks), '[]', 'empty cell is { blocks: [] }');
  assertEqual(children.length, 1, 'only the non-empty cell gets a child');
});

test('leaves an already-Blok-native table (block-ref cells) untouched', () => {
  const input = JSON.stringify({
    blocks: [{ id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['x'] }]] } }],
  }, null, 2);
  const parsed = JSON.parse(applyBlockTypeTransforms(input));

  assertEqual(parsed.blocks.length, 1, 'no child paragraphs minted for native table');
  assertEqual(parsed.blocks[0].data.content[0][0].blocks[0], 'x', 'existing block-ref preserved');
});

// ============================================================================
// AST-guided identifier renaming (does not touch comments / strings / unrelated identifiers)
// ============================================================================

console.log('\n🌳 AST-guided identifier renaming\n');

test('does NOT rewrite EditorJS inside a line comment', () => {
  const { result } = renameEditorJsIdentifiers(`// EditorJS was our previous editor\nconst x = 1;`, { filePath: 'a.ts' });
  assertEqual(result, `// EditorJS was our previous editor\nconst x = 1;`, 'comment must be untouched');
});

test('does NOT rewrite EditorJS inside a string literal', () => {
  const { result } = renameEditorJsIdentifiers(`const msg = "Migrated from EditorJS to our new stack";`, { filePath: 'a.ts' });
  assertEqual(result, `const msg = "Migrated from EditorJS to our new stack";`, 'string prose must be untouched');
});

test('does NOT rename an unrelated identifier that merely contains EditorConfig', () => {
  const { result } = renameEditorJsIdentifiers(`class MyEditorConfigLoader {}`, { filePath: 'a.ts' });
  assertEqual(result, `class MyEditorConfigLoader {}`, 'substring match must not fire');
});

test('renames the EditorJS constructor identifier: new EditorJS( -> new Blok(', () => {
  const { result } = renameEditorJsIdentifiers(`const e = new EditorJS({ holder: 'app' });`, { filePath: 'a.ts' });
  assertEqual(result, `const e = new Blok({ holder: 'app' });`);
});

test('renames an EditorJS type annotation: : EditorJS -> : Blok', () => {
  const { result } = renameEditorJsIdentifiers(`let e: EditorJS;`, { filePath: 'a.ts' });
  assertEqual(result, `let e: Blok;`);
});

test('renames the EditorConfig type reference -> BlokConfig', () => {
  const { result } = renameEditorJsIdentifiers(`const c: EditorConfig = {};`, { filePath: 'a.ts' });
  assertEqual(result, `const c: BlokConfig = {};`);
});

test('collapses the qualified name EditorJS.EditorConfig -> BlokConfig', () => {
  const { result } = renameEditorJsIdentifiers(`const c: EditorJS.EditorConfig = {};`, { filePath: 'a.ts' });
  assertEqual(result, `const c: BlokConfig = {};`);
});

test('reports it used the AST path when a parser is resolvable', () => {
  const { usedAst } = renameEditorJsIdentifiers(`const e = new EditorJS();`, { filePath: 'a.ts' });
  assertEqual(usedAst, true, 'a resolvable parser should drive the AST path');
});

test('renames only inside the <script> block of a .vue file, not the template', () => {
  const input = `<template>\n  <div>EditorJS docs</div>\n</template>\n<script lang="ts">\nconst e = new EditorJS();\nlet c: EditorConfig;\n</script>\n`;
  const { result } = renameEditorJsIdentifiers(input, { filePath: 'App.vue' });
  assert(result.includes('<div>EditorJS docs</div>'), 'template text left untouched');
  assert(result.includes('const e = new Blok();'), 'script constructor migrated');
  assert(/:\s*BlokConfig/.test(result), 'script type migrated');
});

// ============================================================================
// End-to-end transformFile: real code migrates, comments/strings/unrelated stay
// ============================================================================

console.log('\n🔁 transformFile end-to-end (AST-guided)\n');

test('transformFile migrates real EditorJS code but leaves comments, strings, and unrelated identifiers intact', () => {
  // NOTE: this covers the JS/TS identifier + text passes only. The CSS-class
  // pass (CSS_CLASS_TRANSFORMS) is still regex-based and out of this increment's
  // scope, so class names in comments/strings are intentionally not asserted.
  const input = [
    `// We migrated away from EditorJS last year — that whole era is behind us.`,
    `import EditorJS from '@editorjs/editorjs';`,
    `class MyEditorConfigLoader {}`,
    `const label = "Powered by EditorJS";`,
    `const editor = new EditorJS({ holder: 'app' });`,
    `let cfg: EditorConfig;`,
    ``,
  ].join('\n');

  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'blok-codemod-'));
  const file = nodePath.join(dir, 'sample.ts');
  fs.writeFileSync(file, input, 'utf8');

  try {
    transformFile(file, false, false);
    const out = fs.readFileSync(file, 'utf8');

    // Preserved (would have been mangled by the old regex identifier/text passes):
    assert(out.includes('// We migrated away from EditorJS last year'), 'comment text preserved');
    assert(out.includes('class MyEditorConfigLoader'), 'unrelated identifier preserved');
    assert(out.includes('"Powered by EditorJS"'), 'string prose preserved');

    // Migrated (real code):
    assert(out.includes('new Blok({'), 'constructor migrated to Blok');
    assert(/:\s*BlokConfig/.test(out), 'EditorConfig type migrated to BlokConfig');
    assert(!/from ['"]@editorjs\/editorjs['"]/.test(out), 'editorjs import rewritten');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Scope rename (legacy personal scope → @blok/*)
// ============================================================================

console.log('\n🏷️  Scope Rename (legacy scope → @blok/*)\n');

const LEGACY = ['@jack', 'uait'].join('');

test('renames the bare core specifier', () => {
  const input = `import { Blok } from '${LEGACY}/blok';`;
  const { result } = applyTransforms(input, SCOPE_RENAME_TRANSFORMS);
  assertEqual(result, `import { Blok } from '@blok/core';`);
});

test('renames adapter subpaths to standalone packages', () => {
  const input = [
    `import { useBlok } from '${LEGACY}/blok/react';`,
    `import { BlokEditor } from '${LEGACY}/blok/vue';`,
    `import { provideBlok } from '${LEGACY}/blok/angular';`,
  ].join('\n');
  const { result } = applyTransforms(input, SCOPE_RENAME_TRANSFORMS);
  assertEqual(result, [
    `import { useBlok } from '@blok/react';`,
    `import { BlokEditor } from '@blok/vue';`,
    `import { provideBlok } from '@blok/angular';`,
  ].join('\n'));
});

test('keeps non-adapter subpaths under the core', () => {
  const input = `import { Table } from '${LEGACY}/blok/tools';\nimport '${LEGACY}/blok/full';`;
  const { result } = applyTransforms(input, SCOPE_RENAME_TRANSFORMS);
  assertEqual(result, `import { Table } from '@blok/core/tools';\nimport '@blok/core/full';`);
});

test('renames the angular APF and cli package names', () => {
  const input = `import { BlokContent } from '${LEGACY}/blok-angular';\n// npx ${LEGACY}/blok-cli --convert-html`;
  const { result } = applyTransforms(input, SCOPE_RENAME_TRANSFORMS);
  assert(result.includes(`from '@blok/angular';`), 'angular package renamed');
  assert(result.includes('npx @blok/cli'), 'cli package renamed');
});

test('updatePackageJson migrates legacy-scope dependency keys, preserving ranges', () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'blok-scope-rename-'));
  const pkgPath = nodePath.join(dir, 'package.json');
  try {
    fs.writeFileSync(pkgPath, JSON.stringify({
      dependencies: { [`${LEGACY}/blok`]: '^1.1.0' },
      devDependencies: { [`${LEGACY}/blok-cli`]: '~1.0.2' },
    }, null, 2));
    updatePackageJson(pkgPath, false);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assertEqual(pkg.dependencies['@blok/core'], '^1.1.0');
    assertEqual(pkg.dependencies[`${LEGACY}/blok`], undefined);
    assertEqual(pkg.devDependencies['@blok/cli'], '~1.0.2');
    assertEqual(pkg.devDependencies[`${LEGACY}/blok-cli`], undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '─'.repeat(50));
console.log('\n✨ All tests completed!\n');

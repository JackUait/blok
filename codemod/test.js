/**
 * Tests for the EditorJS to Blok codemod
 */

const {
  applyTransforms,
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
  TYPE_TRANSFORMS,
  CLASS_NAME_TRANSFORMS,
  CSS_CLASS_TRANSFORMS,
  DATA_ATTRIBUTE_TRANSFORMS,
  SELECTOR_TRANSFORMS,
  HOLDER_TRANSFORMS,
  TOOL_CONFIG_TRANSFORMS,
} = require('./migrate-editorjs-to-blok');

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

// ============================================================================
// Import Tests
// ============================================================================

console.log('\n📦 Import Transformations\n');

test('transforms @editorjs/editorjs default import to named import', () => {
  const input = `import EditorJS from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok } from '@jackuait/blok';`);
});

test('transforms @editorjs/editorjs aliased default import', () => {
  const input = `import Editor from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok as Editor } from '@jackuait/blok';`);
});

test('transforms require statement', () => {
  const input = `const EditorJS = require('@editorjs/editorjs');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const EditorJS = require('@jackuait/blok').Blok;`);
});

test('transforms namespace import to named import', () => {
  const input = `import * as EditorJS from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok as EditorJS } from '@jackuait/blok';`);
});

test('transforms destructured default require', () => {
  const input = `const { default: EditorJS } = require('@editorjs/editorjs');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { Blok: EditorJS } = require('@jackuait/blok');`);
});

test('transforms dynamic import', () => {
  const input = `const Editor = await import('@editorjs/editorjs');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const Editor = await import('@jackuait/blok').then(m => ({ default: m.Blok }));`);
});

test('transforms dynamic import with .then(m => m.default) pattern', () => {
  const input = `import('@editorjs/editorjs').then(m => m.default);`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import('@jackuait/blok').then(m => m.Blok);`);
});

test('transforms type-only default import', () => {
  const input = `import type EditorJS from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import type { Blok as EditorJS } from '@jackuait/blok';`);
});

test('transforms @editorjs/header import to named import', () => {
  const input = `import Header from '@editorjs/header';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Header } from '@jackuait/blok';\n`);
});

test('transforms @editorjs/paragraph import to named import', () => {
  const input = `import Paragraph from '@editorjs/paragraph';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Paragraph } from '@jackuait/blok';\n`);
});

test('transforms @editorjs/list import to named import', () => {
  const input = `import List from '@editorjs/list';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { List } from '@jackuait/blok';\n`);
});

// Combined default + named import tests
test('transforms combined default + named import', () => {
  const input = `import EditorJS, { EditorConfig } from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok, EditorConfig } from '@jackuait/blok';`);
});

test('transforms aliased combined default + named import', () => {
  const input = `import Editor, { EditorConfig } from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok as Editor, EditorConfig } from '@jackuait/blok';`);
});

// Re-export tests
test('transforms default re-export as named', () => {
  const input = `export { default as Editor } from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `export { Blok as Editor } from '@jackuait/blok';`);
});

test('transforms default re-export', () => {
  const input = `export { default } from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `export { Blok } from '@jackuait/blok';`);
});

// Dynamic import with destructuring
test('transforms destructured dynamic import', () => {
  const input = `const { default: Editor } = await import('@editorjs/editorjs');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { Blok: Editor } = await import('@jackuait/blok');`);
});

// Tool require statements
test('transforms Header require statement', () => {
  const input = `const Header = require('@editorjs/header');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { Header } = require('@jackuait/blok');`);
});

test('transforms aliased Header require statement', () => {
  const input = `const MyHeader = require('@editorjs/header');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { Header: MyHeader } = require('@jackuait/blok');`);
});

test('transforms Paragraph require statement', () => {
  const input = `const Paragraph = require('@editorjs/paragraph');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { Paragraph } = require('@jackuait/blok');`);
});

test('transforms List require statement', () => {
  const input = `const List = require('@editorjs/list');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { List } = require('@jackuait/blok');`);
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

test('transforms .codex-editor--narrow modifier', () => {
  const input = `.codex-editor--narrow { width: 100%; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-narrow="true"] { width: 100%; }`);
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
  if (!result.includes("from '@jackuait/blok'")) {
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
  assertEqual(result.includes("import { Header } from '@jackuait/blok';"), true, 'Should add Header import');
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
  const headerImportIndex = result.indexOf("import { Header } from '@jackuait/blok';");
  const lastReactImportIndex = result.indexOf("import { useState } from 'react';");
  assertEqual(headerImportIndex > lastReactImportIndex, true, 'Header import should be after existing imports');
});

test('adds missing tools to existing @jackuait/blok import', () => {
  const input = `import { Blok } from '@jackuait/blok';

const editor = new Blok({
  tools: { header: Header }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes('Header, Blok'), true, 'Should add Header to existing import');
});

test('adds multiple missing tools to existing import', () => {
  const input = `import { Blok } from '@jackuait/blok';

const editor = new Blok({
  tools: { header: Header, paragraph: Paragraph }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes('Header'), true, 'Should include Header');
  assertEqual(result.includes('Paragraph'), true, 'Should include Paragraph');
});

test('does not modify when tools are already imported', () => {
  const input = `import { Blok, Header } from '@jackuait/blok';

const editor = new Blok({
  tools: { header: Header }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, false, 'Should not indicate change');
  assertEqual(result, input, 'Content should be unchanged');
});

test('does not modify when no bundled tools are used', () => {
  const input = `import { Blok } from '@jackuait/blok';

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
  assertEqual(result.includes("import { Paragraph } from '@jackuait/blok';"), true, 'Should add Paragraph import');
});

test('detects List usage', () => {
  const input = `const editor = new Blok({
  tools: { list: List }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should detect List');
  assertEqual(result.includes("import { List } from '@jackuait/blok';"), true, 'Should add List import');
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

  // After transformation, should have @jackuait/blok imports
  assertEqual(result.includes("from '@jackuait/blok'"), true, 'Should have @jackuait/blok import');
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
  const input = `import Blok from '@jackuait/blok';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok } from '@jackuait/blok';`);
});

test('transforms aliased Blok default import to named import with alias', () => {
  const input = `import Editor from '@jackuait/blok';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok as Editor } from '@jackuait/blok';`);
});

test('transforms combined Blok default + named import', () => {
  const input = `import Blok, { BlokConfig } from '@jackuait/blok';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok, BlokConfig } from '@jackuait/blok';`);
});

test('transforms aliased combined Blok default + named import', () => {
  const input = `import Editor, { BlokConfig } from '@jackuait/blok';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok as Editor, BlokConfig } from '@jackuait/blok';`);
});

test('transforms type-only Blok default import', () => {
  const input = `import type Blok from '@jackuait/blok';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import type { Blok } from '@jackuait/blok';`);
});

test('transforms type-only aliased Blok default import', () => {
  const input = `import type Editor from '@jackuait/blok';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import type { Blok as Editor } from '@jackuait/blok';`);
});

test('transforms namespace import from @jackuait/blok', () => {
  const input = `import * as Blok from '@jackuait/blok';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok } from '@jackuait/blok';`);
});

test('transforms aliased namespace import from @jackuait/blok', () => {
  const input = `import * as Editor from '@jackuait/blok';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import { Blok as Editor } from '@jackuait/blok';`);
});

test('transforms destructured dynamic import from @jackuait/blok', () => {
  const input = `const { default: Editor } = await import('@jackuait/blok');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { Blok: Editor } = await import('@jackuait/blok');`);
});

test('transforms require().default from @jackuait/blok', () => {
  const input = `const Blok = require('@jackuait/blok').default;`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const Blok = require('@jackuait/blok').Blok;`);
});

test('transforms destructured require default from @jackuait/blok', () => {
  const input = `const { default: Editor } = require('@jackuait/blok');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const { Blok: Editor } = require('@jackuait/blok');`);
});

test('transforms re-export default as named from @jackuait/blok', () => {
  const input = `export { default as Editor } from '@jackuait/blok';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `export { Blok as Editor } from '@jackuait/blok';`);
});

test('transforms re-export default from @jackuait/blok', () => {
  const input = `export { default } from '@jackuait/blok';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `export { Blok } from '@jackuait/blok';`);
});

test('does not transform subpath imports from @jackuait/blok/tools', () => {
  const input = `import Header from '@jackuait/blok/tools';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  // Should not match because of the /tools path
  assertEqual(result, input);
});

test('does not transform named imports from @jackuait/blok', () => {
  const input = `import { Blok, BlokConfig } from '@jackuait/blok';`;
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
  const input = `import { Blok, Header } from '@jackuait/blok';`;
  const { result, changed } = splitBlokImports(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("from '@jackuait/blok';"), true, 'Should have core import');
  assertEqual(result.includes("from '@jackuait/blok/tools';"), true, 'Should have tools import');
  assertEqual(result.includes('Blok'), true, 'Should include Blok');
  assertEqual(result.includes('Header'), true, 'Should include Header');
});

test('splitBlokImports splits combined import with multiple tools', () => {
  const input = `import { Blok, Header, Paragraph, Bold } from '@jackuait/blok';`;
  const { result, changed } = splitBlokImports(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("import { Blok } from '@jackuait/blok';"), true, 'Should have core-only import');
  assertEqual(result.includes("import { Header, Paragraph, Bold } from '@jackuait/blok/tools';"), true, 'Should have tools import');
});

test('splitBlokImports handles tools-only import', () => {
  const input = `import { Header, Paragraph } from '@jackuait/blok';`;
  const { result, changed } = splitBlokImports(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("import { Header, Paragraph } from '@jackuait/blok/tools';"), true, 'Should move to tools');
  assertEqual(result.includes("from '@jackuait/blok';") && !result.includes("/tools"), false, 'Should not have empty core import');
});

test('splitBlokImports does not change core-only import', () => {
  const input = `import { Blok, BlokConfig } from '@jackuait/blok';`;
  const { result, changed } = splitBlokImports(input);
  assertEqual(changed, false, 'Should not indicate change');
  assertEqual(result, input, 'Content should be unchanged');
});

test('splitBlokImports handles aliased imports', () => {
  const input = `import { Blok, Header as MyHeader } from '@jackuait/blok';`;
  const { result, changed } = splitBlokImports(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("import { Blok } from '@jackuait/blok';"), true, 'Should have core import');
  assertEqual(result.includes("Header as MyHeader"), true, 'Should preserve alias');
  assertEqual(result.includes("@jackuait/blok/tools"), true, 'Should have tools import');
});

test('ensureToolsImport adds tools import when no import exists', () => {
  const input = `const editor = new Blok({
  tools: { header: Header }
});`;
  const { result, changed } = ensureToolsImport(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("from '@jackuait/blok/tools';"), true, 'Should add tools import');
});

test('ensureToolsImport adds to existing /tools import', () => {
  const input = `import { Header } from '@jackuait/blok/tools';

const editor = new Blok({
  tools: { header: Header, paragraph: Paragraph }
});`;
  const { result, changed } = ensureToolsImport(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes('Paragraph'), true, 'Should add Paragraph');
  assertEqual(result.includes("from '@jackuait/blok/tools';"), true, 'Should use tools path');
});

test('ensureToolsImport does not duplicate when tools are in main import', () => {
  const input = `import { Blok, Header } from '@jackuait/blok';

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
  assertEqual(result.includes("from '@jackuait/blok/tools';"), true, 'Should use tools path');
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
  const input = `import { Blok, Header, Paragraph, Bold, Italic } from '@jackuait/blok';

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
  assertEqual(splitResult.includes("import { Blok } from '@jackuait/blok';"), true, 'Should have core import');
  assertEqual(splitResult.includes("import { Header, Paragraph, Bold, Italic } from '@jackuait/blok/tools';"), true, 'Should have tools import');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '─'.repeat(50));
console.log('\n✨ All tests completed!\n');

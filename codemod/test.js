/**
 * Tests for the EditorJS to Blok codemod
 */

const {
  applyTransforms,
  ensureBlokImport,
  normalizeKey,
  flattenI18nDictionary,
  transformI18nConfig,
  removeI18nMessages,
  I18N_KEY_MAPPINGS,
  BUNDLED_TOOLS,
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

test('transforms @editorjs/editorjs import', () => {
  const input = `import EditorJS from '@editorjs/editorjs';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `import EditorJS from '@jackuait/blok';`);
});

test('transforms require statement', () => {
  const input = `const EditorJS = require('@editorjs/editorjs');`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `const EditorJS = require('@jackuait/blok');`);
});

test('transforms @editorjs/header import', () => {
  const input = `import Header from '@editorjs/header';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `// Header is now bundled with Blok: use Blok.Header\n`);
});

test('transforms @editorjs/paragraph import', () => {
  const input = `import Paragraph from '@editorjs/paragraph';`;
  const { result } = applyTransforms(input, IMPORT_TRANSFORMS);
  assertEqual(result, `// Paragraph is now bundled with Blok: use Blok.Paragraph\n`);
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
  assertEqual(result, `[data-blok-popover][data-blok-opened="true"] { display: block; }`);
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

test('transforms class: Header to class: Blok.Header', () => {
  const input = `{ class: Header, config: {} }`;
  const { result } = applyTransforms(input, TOOL_CONFIG_TRANSFORMS);
  assertEqual(result, `{ class: Blok.Header, config: {} }`);
});

test('transforms class: Paragraph to class: Blok.Paragraph', () => {
  const input = `{ class: Paragraph, config: {} }`;
  const { result } = applyTransforms(input, TOOL_CONFIG_TRANSFORMS);
  assertEqual(result, `{ class: Blok.Paragraph, config: {} }`);
});

test('transforms standalone paragraph: Paragraph reference', () => {
  const input = `tools: { paragraph: Paragraph, header: Header }`;
  const { result } = applyTransforms(input, TOOL_CONFIG_TRANSFORMS);
  assertEqual(result, `tools: { paragraph: Blok.Paragraph, header: Blok.Header }`);
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
  if (!result.includes('class: Blok.Header')) {
    throw new Error('Tool class not transformed');
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

test('adds Blok import when using Blok.Header with no existing import', () => {
  const input = `const editor = new Blok({
  tools: { header: Blok.Header }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("import Blok from '@jackuait/blok';"), true, 'Should add Blok import');
});

test('adds Blok import after existing imports', () => {
  const input = `import React from 'react';
import { useState } from 'react';

const editor = new Blok({
  tools: { header: Blok.Header }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should indicate change');
  // Check that Blok import is added after existing imports
  const blokImportIndex = result.indexOf("import Blok from '@jackuait/blok';");
  const lastReactImportIndex = result.indexOf("import { useState } from 'react';");
  assertEqual(blokImportIndex > lastReactImportIndex, true, 'Blok import should be after existing imports');
});

test('adds Blok to named-only import from @jackuait/blok', () => {
  const input = `import { BlokConfig } from '@jackuait/blok';

const config: BlokConfig = {
  tools: { header: Blok.Header }
};`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("import Blok, { BlokConfig } from '@jackuait/blok';"), true, 'Should add Blok default import');
});

test('adds Blok to named imports when default import has different name', () => {
  const input = `import Editor, { BlokConfig } from '@jackuait/blok';

const config: BlokConfig = {
  tools: { header: Blok.Header }
};`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("import Editor, { Blok, BlokConfig } from '@jackuait/blok';"), true, 'Should add Blok to named imports');
});

test('adds Blok as named import when default import has different name (no existing named imports)', () => {
  const input = `import Editor from '@jackuait/blok';

const editor = new Editor({
  tools: { header: Blok.Header }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should indicate change');
  assertEqual(result.includes("import Editor, { Blok } from '@jackuait/blok';"), true, 'Should add Blok as named import');
});

test('does not modify when Blok is already default imported', () => {
  const input = `import Blok from '@jackuait/blok';

const editor = new Blok({
  tools: { header: Blok.Header }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, false, 'Should not indicate change');
  assertEqual(result, input, 'Content should be unchanged');
});

test('does not modify when Blok is already default imported with named imports', () => {
  const input = `import Blok, { BlokConfig } from '@jackuait/blok';

const editor = new Blok({
  tools: { header: Blok.Header }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, false, 'Should not indicate change');
  assertEqual(result, input, 'Content should be unchanged');
});

test('does not modify when no Blok tools are used', () => {
  const input = `import { BlokConfig } from '@jackuait/blok';

const config: BlokConfig = {};`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, false, 'Should not indicate change when no Blok.* tools used');
  assertEqual(result, input, 'Content should be unchanged');
});

test('detects Blok.Paragraph usage', () => {
  const input = `const editor = new Blok({
  tools: { paragraph: Blok.Paragraph }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should detect Blok.Paragraph');
  assertEqual(result.includes("import Blok from '@jackuait/blok';"), true, 'Should add Blok import');
});

test('handles multiple Blok tools usage', () => {
  const input = `const editor = new Blok({
  tools: {
    header: Blok.Header,
    paragraph: Blok.Paragraph
  }
});`;
  const { result, changed } = ensureBlokImport(input);
  assertEqual(changed, true, 'Should detect multiple Blok tools');
  assertEqual(result.includes("import Blok from '@jackuait/blok';"), true, 'Should add Blok import');
});

test('full migration adds Blok import for bundled tools', () => {
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

  // After transformation, should have Blok import (since original EditorJS import becomes @jackuait/blok)
  assertEqual(result.includes("from '@jackuait/blok'"), true, 'Should have @jackuait/blok import');
  assertEqual(result.includes('class: Blok.Header'), true, 'Should use Blok.Header');
  assertEqual(result.includes('class: Blok.Paragraph'), true, 'Should use Blok.Paragraph');
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
  // 'ui.toolbar.toolbox.Add' is mapped to 'ui.toolbar.toolbox.clickToAddBelow' by I18N_KEY_MAPPINGS
  assertEqual(result['ui.toolbar.toolbox.clickToAddBelow'], 'Добавить');
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
  // Keys are normalized to camelCase
  assertEqual(result['ui.blockTunes.toggler.dragToMove'], 'Перетащите');
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
  // 'Click to tune' should be mapped to 'clickToOpenMenu' (camelCase)
  assertEqual(result['ui.blockTunes.toggler.clickToOpenMenu'], 'Нажмите для настройки');
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
  // Keys are normalized to camelCase
  assertEqual(result.includes('"ui.popover.search": "Поиск"'), true, 'Should have flattened ui.popover.search');
  assertEqual(result.includes('"ui.popover.nothingFound": "Ничего не найдено"'), true, 'Should have flattened ui.popover.nothingFound');
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
  // UI key mappings (values are now camelCase)
  assertEqual(I18N_KEY_MAPPINGS['ui.blockTunes.toggler.Click to tune'], 'ui.blockTunes.toggler.clickToOpenMenu');
  assertEqual(I18N_KEY_MAPPINGS['ui.blockTunes.toggler.or drag to move'], 'ui.blockTunes.toggler.dragToMove');
  assertEqual(I18N_KEY_MAPPINGS['ui.toolbar.toolbox.Add'], 'ui.toolbar.toolbox.clickToAddBelow');
  assertEqual(I18N_KEY_MAPPINGS['ui.inlineToolbar.converter.Convert to'], 'ui.popover.convertTo');
  assertEqual(I18N_KEY_MAPPINGS['ui.popover.Filter'], 'ui.popover.search');

  // Tool names mappings (values are now camelCase)
  assertEqual(I18N_KEY_MAPPINGS['toolNames.Ordered List'], 'toolNames.numberedList');
  assertEqual(I18N_KEY_MAPPINGS['toolNames.Unordered List'], 'toolNames.bulletedList');

  // Tools messages mappings (values are now camelCase)
  assertEqual(I18N_KEY_MAPPINGS['tools.stub.The block can not be displayed correctly'], 'tools.stub.blockCannotBeDisplayed');

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
  // Keys are mapped and normalized to camelCase
  assertEqual(result['ui.popover.search'], 'Фильтр');
  assertEqual(result['ui.popover.nothingFound'], 'Ничего не найдено');
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
  // Keys are normalized to camelCase, moveUp/moveDown are removed
  assertEqual(result['blockTunes.delete.delete'], 'Удалить');
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
  assertEqual(normalizeKey('ui.popover.Nothing found'), 'ui.popover.nothingFound');
  assertEqual(normalizeKey('ui.toolbar.toolbox.Click to add below'), 'ui.toolbar.toolbox.clickToAddBelow');
});

test('normalizeKey handles keys with multiple spaces', () => {
  assertEqual(normalizeKey('tools.stub.The block can not be displayed'), 'tools.stub.theBlockCanNotBeDisplayed');
});

test('normalizeKey preserves namespace segments', () => {
  assertEqual(normalizeKey('ui.blockTunes.toggler.Drag to move'), 'ui.blockTunes.toggler.dragToMove');
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
// Summary
// ============================================================================

console.log('\n' + '─'.repeat(50));
console.log('\n✨ All tests completed!\n');

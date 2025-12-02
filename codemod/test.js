/**
 * Tests for the EditorJS to Blok codemod
 */

const {
  applyTransforms,
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
  assertEqual(result, `.blok-editor { color: red; }`);
});

test('transforms .codex-editor--narrow modifier', () => {
  const input = `.codex-editor--narrow { width: 100%; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `.blok-editor--narrow { width: 100%; }`);
});

test('transforms .ce-block class', () => {
  const input = `.ce-block { margin: 10px; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-testid="block-wrapper"] { margin: 10px; }`);
});

test('transforms .ce-block--selected class', () => {
  const input = `.ce-block--selected { background: blue; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-selected="true"] { background: blue; }`);
});

test('transforms .ce-toolbar class', () => {
  const input = `document.querySelector('.ce-toolbar')`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `document.querySelector('[data-blok-testid="toolbar"]')`);
});

test('transforms .ce-inline-toolbar class', () => {
  const input = `.ce-inline-toolbar { display: flex; }`;
  const { result } = applyTransforms(input, CSS_CLASS_TRANSFORMS);
  assertEqual(result, `[data-blok-testid="inline-toolbar"] { display: flex; }`);
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
// Summary
// ============================================================================

console.log('\n' + '─'.repeat(50));
console.log('\n✨ All tests completed!\n');

import type { Framework } from '../../contexts/FrameworkContext';
import type { Snippet } from './framework-snippets';

/**
 * Adapts a single code example to the selected framework so every snippet in
 * the docs follows the framework toggle.
 *
 * Examples fall into three shapes, detected automatically:
 * - **setup**    — constructs the editor (`new Blok({...})`). Regenerated as the
 *   real per-framework mount: `useBlok` + `<BlokContent>` for react/vue, an
 *   `@Component` with `<blok-editor>` for angular.
 * - **api-call** — calls into an existing `editor` instance. The handle is
 *   nullable in the adapters (`useBlok` returns `Blok | null`), so the body is
 *   guarded once rather than optional-chaining every access — otherwise the
 *   call's result is `undefined` and downstream `data.blocks` no longer
 *   type-checks. React narrows with `if (editor) { … }`, vue captures
 *   `editor.value` into a local const first, and angular wraps the body in an
 *   `onReady(editor)` handler. Lifecycle-owned teardown (`destroy()`) is
 *   adapter-managed, so it is replaced with a note instead of a call.
 * - **agnostic** — no editor at all (JSON shapes, types, a tool class). Returned
 *   unchanged for every framework.
 */
export type ExampleKind = 'setup' | 'api-call' | 'agnostic';

export const classifyExample = (code: string): ExampleKind => {
  if (/\bnew Blok\s*\(/.test(code)) {
    return 'setup';
  }
  if (/\beditor\s*[.?]/.test(code)) {
    return 'api-call';
  }
  return 'agnostic';
};

/** Indents every non-blank line of `text` by `spaces`. */
const indent = (text: string, spaces: number): string => {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line === '' ? '' : pad + line))
    .join('\n');
};

/** Returns the `{ … }` literal starting at the first `{` at or after `from`. */
const extractBraceLiteral = (source: string, from: number): string | null => {
  const start = source.indexOf('{', from);
  if (start === -1) {
    return null;
  }
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  return null;
};

// ── api-call ────────────────────────────────────────────────────────────────

const adaptApiCall = (code: string, framework: Framework): Snippet => {
  if (framework === 'vanilla') {
    return { code, language: 'typescript' };
  }

  // `destroy()` is owned by the adapter lifecycle — `useBlok` / the component
  // tears the editor down when it unmounts, so a consumer must never call it.
  // Replace the vanilla teardown example with a framework-appropriate note
  // rather than a rewrite that would destroy a still-mounting editor.
  if (/\beditor\.destroy\s*\(/.test(code)) {
    const note =
      framework === 'angular'
        ? '// The <blok-editor> component destroys the editor for you when Angular\n// destroys the component — never call destroy() yourself.'
        : '// The editor is destroyed for you when the component unmounts —\n// useBlok owns teardown, so you never call destroy() yourself.';
    return { code: note, language: 'typescript' };
  }

  switch (framework) {
    case 'react':
      // `editor` is a `const` (`Blok | null`); narrowing it once persists across
      // the whole block, so the call's result keeps its non-nullable type.
      return { code: `if (editor) {\n${indent(code, 2)}\n}`, language: 'typescript' };
    case 'vue': {
      // Capture the ref's `.value` into a local const so narrowing survives the
      // intervening method calls (property-access narrowing would reset).
      const body = indent(code.replace(/\beditor\./g, 'blok.'), 2);
      return { code: `const blok = editor.value;\nif (blok) {\n${body}\n}`, language: 'typescript' };
    }
    case 'angular': {
      const isAsync = /\bawait\b/.test(code);
      const head = `${isAsync ? 'async ' : ''}onReady(editor: Blok) {`;
      return { code: `${head}\n${indent(code, 2)}\n}`, language: 'typescript' };
    }
    default:
      return { code, language: 'typescript' };
  }
};

// ── setup ───────────────────────────────────────────────────────────────────

interface ParsedSetup {
  leadingComment: string[];
  /** Import lines that are NOT the core `@blok/core` import. */
  toolImports: string[];
  /** Body of `new Blok({ … })` with the `holder` line removed (2-space indent). */
  configWithoutHolder: string;
  /** The `{ … }` literal assigned to the `tools` key, or null when absent. */
  toolsLiteral: string | null;
}

const parseSetup = (code: string): ParsedSetup => {
  const lines = code.split('\n');

  const leadingComment: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith('//')) {
      leadingComment.push(line);
    } else {
      break;
    }
  }

  const toolImports = lines.filter(
    (line) =>
      line.trim().startsWith('import ') && !/from ['"]@blok\/core['"]/.test(line),
  );

  const blokIndex = code.search(/\bnew Blok\s*\(/);
  const configLiteral = extractBraceLiteral(code, blokIndex) ?? '{}';
  const configInner = configLiteral
    .slice(1, -1)
    .replace(/^\n/, '')
    .replace(/\n[ \t]*$/, '');

  const configWithoutHolder = configInner
    .split('\n')
    .filter((line) => !/^\s*holder\s*:/.test(line))
    .join('\n');

  const toolsKeyIndex = configInner.search(/\btools\s*:/);
  const toolsLiteral =
    toolsKeyIndex === -1 ? null : extractBraceLiteral(configInner, toolsKeyIndex);

  return { leadingComment, toolImports, configWithoutHolder, toolsLiteral };
};

const buildReactSetup = (parsed: ParsedSetup): Snippet => {
  const code = [
    ...parsed.leadingComment,
    "import { useBlok, BlokContent } from '@blok/react';",
    ...parsed.toolImports,
    '',
    'export function Editor() {',
    '  const editor = useBlok({',
    indent(parsed.configWithoutHolder, 2),
    '  });',
    '',
    '  return <BlokContent editor={editor} />;',
    '}',
  ].join('\n');
  return { code, language: 'tsx' };
};

const buildVueSetup = (parsed: ParsedSetup): Snippet => {
  const code = [
    '<script setup lang="ts">',
    ...parsed.leadingComment,
    "import { useBlok, BlokContent } from '@blok/vue';",
    ...parsed.toolImports,
    '',
    'const editor = useBlok({',
    parsed.configWithoutHolder,
    '});',
    '</script>',
    '',
    '<template>',
    '  <BlokContent :editor="editor" />',
    '</template>',
  ].join('\n');
  return { code, language: 'vue' };
};

const buildAngularSetup = (parsed: ParsedSetup): Snippet => {
  const hasTools = parsed.toolsLiteral !== null;
  const template = hasTools
    ? '  template: `<blok-editor [tools]="tools" />`,'
    : '  template: `<blok-editor />`,';
  const classBody = hasTools
    ? ['export class EditorComponent {', `  tools = ${parsed.toolsLiteral};`, '}']
    : ['export class EditorComponent {}'];

  const code = [
    ...parsed.leadingComment,
    "import { Component } from '@angular/core';",
    "import { BlokEditorComponent } from '@blok/angular';",
    ...parsed.toolImports,
    '',
    '@Component({',
    "  selector: 'app-editor',",
    '  standalone: true,',
    '  imports: [BlokEditorComponent],',
    template,
    '})',
    ...classBody,
  ].join('\n');
  return { code, language: 'typescript' };
};

const adaptSetup = (code: string, framework: Framework): Snippet => {
  if (framework === 'vanilla') {
    return { code, language: 'typescript' };
  }
  const parsed = parseSetup(code);
  switch (framework) {
    case 'react':
      return buildReactSetup(parsed);
    case 'vue':
      return buildVueSetup(parsed);
    case 'angular':
      return buildAngularSetup(parsed);
    default:
      return { code, language: 'typescript' };
  }
};

// ── dispatcher ────────────────────────────────────────────────────────────────

/**
 * Rewrites `code` for the active `framework`. `baseLanguage` is the language the
 * vanilla / agnostic variant is highlighted with (defaults to TypeScript); the
 * framework variants pick their own language where it differs (tsx, vue).
 */
export const adaptExample = (
  code: string,
  framework: Framework,
  baseLanguage = 'typescript',
): Snippet => {
  const kind = classifyExample(code);

  if (kind === 'agnostic') {
    return { code, language: baseLanguage };
  }
  if (framework === 'vanilla') {
    return { code, language: baseLanguage };
  }
  return kind === 'setup' ? adaptSetup(code, framework) : adaptApiCall(code, framework);
};

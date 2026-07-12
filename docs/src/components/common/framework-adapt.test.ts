import { describe, it, expect } from 'vitest';
import { adaptExample, classifyExample } from './framework-adapt';

describe('classifyExample', () => {
  it('classifies a `new Blok(...)` snippet as setup', () => {
    expect(classifyExample(`const editor = new Blok({ holder: 'editor' });`)).toBe('setup');
  });

  it('classifies a snippet that calls into an existing editor as api-call', () => {
    expect(classifyExample(`editor.blocks.move(0);`)).toBe('api-call');
  });

  it('classifies a snippet with no editor reference as agnostic', () => {
    expect(classifyExample(`interface BlockData { id: string; }`)).toBe('agnostic');
  });

  it('treats an import-only / config-fragment snippet as agnostic', () => {
    expect(classifyExample(`import { Bold } from '@jackuait/blok/tools';`)).toBe('agnostic');
  });
});

describe('adaptExample — api-call', () => {
  const code = '// Move current block to top\neditor.blocks.move(0);';

  it('leaves the vanilla variant untouched', () => {
    expect(adaptExample(code, 'vanilla')).toEqual({ code, language: 'typescript' });
  });

  it('guards the nullable editor handle once for react', () => {
    expect(adaptExample(code, 'react').code).toBe(
      'if (editor) {\n  // Move current block to top\n  editor.blocks.move(0);\n}',
    );
    expect(adaptExample(code, 'react').language).toBe('typescript');
  });

  it('captures the ref value behind a guard for vue', () => {
    expect(adaptExample(code, 'vue').code).toBe(
      'const blok = editor.value;\nif (blok) {\n  // Move current block to top\n  blok.blocks.move(0);\n}',
    );
  });

  it('adapts every editor reference, not just the first', () => {
    const multi = 'editor.focus();\neditor.focus(true);';
    expect(adaptExample(multi, 'react').code).toBe(
      'if (editor) {\n  editor.focus();\n  editor.focus(true);\n}',
    );
    expect(adaptExample(multi, 'vue').code).toBe(
      'const blok = editor.value;\nif (blok) {\n  blok.focus();\n  blok.focus(true);\n}',
    );
  });

  it('keeps the call result non-nullable so downstream access type-checks', () => {
    // The guard narrows `editor`, so `data` stays `OutputData` (not `| undefined`)
    // and `data.blocks` compiles — the reason we guard instead of optional-chaining.
    const result = 'const data = await editor.save();\nconsole.log(data.blocks);';
    expect(adaptExample(result, 'react').code).toBe(
      'if (editor) {\n  const data = await editor.save();\n  console.log(data.blocks);\n}',
    );
    expect(adaptExample(result, 'vue').code).toBe(
      'const blok = editor.value;\nif (blok) {\n  const data = await blok.save();\n  console.log(data.blocks);\n}',
    );
  });

  it('does not touch handles derived from the editor', () => {
    const derived = "const block = editor.blocks.getById('x');\nblock.update();";
    expect(adaptExample(derived, 'react').code).toBe(
      "if (editor) {\n  const block = editor.blocks.getById('x');\n  block.update();\n}",
    );
  });

  it('replaces the adapter-owned destroy() example with a note, not a call', () => {
    const destroy = '// Clean up on component unmount\neditor.destroy();';
    for (const fw of ['react', 'vue', 'angular'] as const) {
      const out = adaptExample(destroy, fw).code;
      // The note is comment-only — no live destroy() call on the editor handle.
      expect(out).not.toMatch(/editor[.?]/);
      expect(out).toContain('never call destroy() yourself');
    }
    expect(adaptExample(destroy, 'angular').code).toContain('<blok-editor>');
    // Vanilla still shows the real teardown call.
    expect(adaptExample(destroy, 'vanilla').code).toBe(destroy);
  });

  it('wraps the body in an onReady handler for angular', () => {
    expect(adaptExample('editor.focus();', 'angular').code).toBe(
      'onReady(editor: Blok) {\n  editor.focus();\n}',
    );
  });

  it('marks the angular onReady handler async when the body awaits', () => {
    expect(adaptExample('const data = await editor.save();', 'angular').code).toBe(
      'async onReady(editor: Blok) {\n  const data = await editor.save();\n}',
    );
  });

  it('does not indent blank lines inside the angular wrapper', () => {
    const body = 'editor.history.undo();\n\neditor.history.redo();';
    expect(adaptExample(body, 'angular').code).toBe(
      'onReady(editor: Blok) {\n  editor.history.undo();\n\n  editor.history.redo();\n}',
    );
  });
});

describe('adaptExample — agnostic', () => {
  const json = '{\n  "type": "paragraph"\n}';

  it('returns identical code for every framework', () => {
    expect(adaptExample(json, 'vanilla', 'json').code).toBe(json);
    expect(adaptExample(json, 'react', 'json').code).toBe(json);
    expect(adaptExample(json, 'vue', 'json').code).toBe(json);
    expect(adaptExample(json, 'angular', 'json').code).toBe(json);
  });

  it('keeps the supplied base language for every framework', () => {
    for (const fw of ['vanilla', 'react', 'vue', 'angular'] as const) {
      expect(adaptExample(json, fw, 'json').language).toBe('json');
    }
  });
});

describe('adaptExample — setup', () => {
  const setup = `import { Blok } from '@jackuait/blok';
import { Paragraph } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    paragraph: {
      class: Paragraph,
      placeholder: 'Start writing…',
    },
  },
});`;

  it('leaves the vanilla variant byte-for-byte unchanged', () => {
    expect(adaptExample(setup, 'vanilla')).toEqual({ code: setup, language: 'typescript' });
  });

  it('builds a react component using the react adapter entry point', () => {
    const { code, language } = adaptExample(setup, 'react');
    expect(language).toBe('tsx');
    expect(code).toContain("import { useBlok, BlokContent } from '@jackuait/blok/react';");
    expect(code).toContain("import { Paragraph } from '@jackuait/blok/tools';");
    expect(code).toContain('const editor = useBlok({');
    expect(code).toContain('<BlokContent editor={editor} />');
    // The adapter manages the mount point, so the `holder` id is dropped.
    expect(code).not.toMatch(/holder:\s*'editor'/);
    // The tool registration is preserved verbatim.
    expect(code).toContain('placeholder:');
    expect(code).toContain('class: Paragraph,');
  });

  it('builds a vue single-file component using the vue adapter', () => {
    const { code, language } = adaptExample(setup, 'vue');
    expect(language).toBe('vue');
    expect(code).toContain('<script setup lang="ts">');
    expect(code).toContain("import { useBlok, BlokContent } from '@jackuait/blok/vue';");
    expect(code).toContain('const editor = useBlok({');
    expect(code).toContain('<BlokContent :editor="editor" />');
    expect(code).not.toMatch(/holder:\s*'editor'/);
  });

  it('builds an angular component, lifting tools to a class field', () => {
    const { code, language } = adaptExample(setup, 'angular');
    expect(language).toBe('typescript');
    expect(code).toContain("import { BlokEditorComponent } from '@jackuait/blok/angular';");
    expect(code).toContain('@Component({');
    expect(code).toContain('[tools]="tools"');
    expect(code).toContain('tools = {');
    expect(code).toContain('class: Paragraph,');
    expect(code).not.toMatch(/holder:\s*'editor'/);
    expect(code).not.toContain('new Blok(');
  });

  it('preserves a leading comment and a tool-only import (no core Blok import)', () => {
    const noCore = `// DatabaseRow is created by the Database tool.
import { Database, DatabaseRow } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    database: { class: Database },
    'database-row': { class: DatabaseRow },
  },
});`;
    const react = adaptExample(noCore, 'react').code;
    expect(react).toContain('// DatabaseRow is created by the Database tool.');
    expect(react).toContain("import { Database, DatabaseRow } from '@jackuait/blok/tools';");
    expect(react).toContain("import { useBlok, BlokContent } from '@jackuait/blok/react';");
    expect(react).toContain("'database-row': { class: DatabaseRow },");
  });

  it('preserves a nested async uploader config verbatim across frameworks', () => {
    const withUploader = `import { Blok } from '@jackuait/blok';
import { File } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    file: {
      class: File,
      config: {
        uploader: {
          async uploadByFile(file) {
            const url = await myUpload(file);
            return { url, fileName: file.name };
          },
        },
      },
    },
  },
});`;
    for (const fw of ['react', 'vue', 'angular'] as const) {
      const out = adaptExample(withUploader, fw).code;
      expect(out).toContain('async uploadByFile(file) {');
      expect(out).toContain('const url = await myUpload(file);');
    }
  });
});

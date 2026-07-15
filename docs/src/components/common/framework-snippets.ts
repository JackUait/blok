import type { Framework } from '../../contexts/FrameworkContext';

/** A single highlighted snippet — the code plus the Shiki language to render it. */
export interface Snippet {
  code: string;
  language: string;
}

/** The two code steps that genuinely differ per framework: mounting and saving. */
export interface QuickStartSnippet {
  /**
   * Markup the page needs *before* `create` runs. Only vanilla sets this:
   * `new Blok({ holder: 'editor' })` mounts into an element that must already
   * exist, or the constructor throws. The framework adapters manage their own
   * mount point (a hook-rendered component), so they have nothing to show here.
   */
  container?: Snippet;
  create: Snippet;
  save: Snippet;
}

/**
 * Per-framework setup snippets, mirroring the real published adapters:
 * - vanilla — `new Blok({ holder, tools })` from the core package
 * - react   — `<BlokEditor tools={…} />`, the recommended all-in-one component
 * - vue     — `<BlokEditor :tools="…" />`, the blessed all-in-one component
 * - angular — `<blok-editor [tools]="tools" />` standalone component
 *
 * Only instantiation and how you reach the live editor change between
 * frameworks; the rest of the API (`save`, `render`, `blocks`, `caret`, …)
 * operates on the same editor instance, so those examples stay framework-neutral.
 */
export const QUICK_START_SNIPPETS: Record<Framework, QuickStartSnippet> = {
  vanilla: {
    // `new Blok({ holder: 'editor' })` looks up this element by id and throws
    // if it isn't there yet, so it has to exist on the page first.
    container: {
      language: 'html',
      code: `<div id="editor"></div>`,
    },
    create: {
      language: 'typescript',
      code: `import { Blok } from '@blok/core';
import { Header, Paragraph, List } from '@blok/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    paragraph: Paragraph,
    header: { class: Header, placeholder: 'Enter a heading' },
    list: List,
  },
});`,
    },
    save: {
      language: 'typescript',
      // `save` (like the rest of the API) is attached once `isReady` resolves,
      // so await it before calling save() right after construction.
      code: `await editor.isReady;

const data = await editor.save();
console.log(data.blocks);`,
    },
  },
  react: {
    create: {
      language: 'tsx',
      // <BlokEditor> is the recommended all-in-one React component: it wires
      // useBlok + BlokContent for you and takes all config as props.
      code: `import { BlokEditor } from '@blok/react';
import { Header, Paragraph, List } from '@blok/core/tools';

export function Editor() {
  return (
    <BlokEditor
      tools={{
        paragraph: Paragraph,
        header: { class: Header, placeholder: 'Enter a heading' },
        list: List,
      }}
    />
  );
}`,
    },
    save: {
      language: 'tsx',
      // onSave is the idiomatic React path: it fires with the latest content
      // on every change, so `data` always mirrors the editor — no manual
      // save() polling needed.
      code: `import { useState } from 'react';
import { BlokEditor } from '@blok/react';
import type { OutputData } from '@blok/core';

export function Editor() {
  // onSave fires with the latest content on every change — no manual save().
  const [data, setData] = useState<OutputData>();

  return (
    <>
      <BlokEditor onSave={setData} />
      <pre>{JSON.stringify(data?.blocks, null, 2)}</pre>
    </>
  );
}`,
    },
  },
  vue: {
    create: {
      language: 'vue',
      // <BlokEditor> is the blessed all-in-one component for embedding Blok in
      // Vue: it wires useBlok + BlokContent and takes config through props/emits.
      code: `<script setup lang="ts">
import { BlokEditor } from '@blok/vue';
import { Header, Paragraph, List } from '@blok/core/tools';

const tools = {
  paragraph: Paragraph,
  header: { class: Header, placeholder: 'Enter a heading' },
  list: List,
};
</script>

<template>
  <BlokEditor :tools="tools" />
</template>`,
    },
    save: {
      language: 'vue',
      // The `save` emit is the idiomatic Vue path: it fires with the latest
      // content on every change, so `data` always mirrors the editor — no
      // manual save() polling needed.
      code: `<script setup lang="ts">
import { ref } from 'vue';
import { BlokEditor } from '@blok/vue';
import type { OutputData } from '@blok/core';

const data = ref<OutputData>();
</script>

<template>
  <!-- @save fires with the latest content — no manual save() call needed. -->
  <BlokEditor @save="(d: OutputData) => (data = d)" />
  <pre>{{ data?.blocks }}</pre>
</template>`,
    },
  },
  angular: {
    create: {
      language: 'typescript',
      code: `import { Component } from '@angular/core';
import { BlokEditorComponent } from '@blok/angular';
import { Header, Paragraph, List } from '@blok/core/tools';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [BlokEditorComponent],
  template: \`<blok-editor [tools]="tools" />\`,
})
export class EditorComponent {
  tools = {
    paragraph: Paragraph,
    header: { class: Header, placeholder: 'Enter a heading' },
    list: List,
  };
}`,
    },
    save: {
      language: 'typescript',
      // The component streams every save through its (save) output.
      code: `import type { OutputData } from '@blok/core';

// template: <blok-editor [tools]="tools" (save)="onSave($event)" />
onSave(data: OutputData) {
  console.log(data.blocks);
}`,
    },
  },
};

/**
 * Per-framework configuration examples for the Configuration page. The core
 * options are identical; the adapters omit `holder` (the mount point is managed
 * for you) and accept config through their hook / component instead.
 */
export const CONFIG_SNIPPETS: Record<Framework, Snippet> = {
  vanilla: {
    language: 'typescript',
    code: `import { Blok, type BlokConfig } from '@blok/core';

const config: BlokConfig = {
  holder: 'editor',
  placeholder: 'Start writing...',
  autofocus: true,
  readOnly: false,
  minHeight: 300,
};

const editor = new Blok(config);`,
  },
  react: {
    language: 'tsx',
    code: `import { BlokEditor } from '@blok/react';

export function Editor() {
  // Config options map straight to props; the mount point is managed for you,
  // so \`holder\` is omitted.
  return (
    <BlokEditor
      placeholder="Start writing..."
      autofocus
      readOnly={false}
    />
  );
}`,
  },
  vue: {
    language: 'vue',
    code: `<script setup lang="ts">
import { BlokEditor } from '@blok/vue';
</script>

<template>
  <!-- Config options map straight to props; \`holder\` is managed for you. -->
  <BlokEditor
    placeholder="Start writing..."
    :autofocus="true"
    :read-only="false"
  />
</template>`,
  },
  angular: {
    language: 'typescript',
    code: `import { Component } from '@angular/core';
import { BlokEditorComponent } from '@blok/angular';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [BlokEditorComponent],
  // Reactive inputs map straight to config options.
  template: \`
    <blok-editor
      placeholder="Start writing..."
      [autofocus]="true"
      [readOnly]="false"
    />
  \`,
})
export class EditorComponent {}`,
  },
};

/**
 * Per-framework snippet for the tutorial's first "mount" step — the bare editor
 * with no tools yet. Curated rather than generated because the vanilla version
 * awaits `editor.isReady`, which each adapter expresses differently (the
 * adapters surface readiness for you, so the explicit await falls away).
 */
export const TUTORIAL_MOUNT_SNIPPETS: Record<Framework, Snippet> = {
  vanilla: {
    language: 'typescript',
    code: `import { Blok } from '@blok/core';

const editor = new Blok({
  holder: 'editor', // the id of a <div> on your page
});

await editor.isReady;`,
  },
  react: {
    language: 'tsx',
    code: `import { BlokEditor } from '@blok/react';

export function Editor() {
  // <BlokEditor> mounts the editor for you — no holder id, and it manages
  // its own readiness lifecycle.
  return <BlokEditor />;
}`,
  },
  vue: {
    language: 'vue',
    code: `<script setup lang="ts">
import { BlokEditor } from '@blok/vue';
</script>

<template>
  <!-- <BlokEditor> mounts the editor for you — no holder id needed. -->
  <BlokEditor />
</template>`,
  },
  angular: {
    language: 'typescript',
    code: `import { Component } from '@angular/core';
import { BlokEditorComponent } from '@blok/angular';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [BlokEditorComponent],
  template: \`<blok-editor />\`,
})
export class EditorComponent {}`,
  },
};

/**
 * Per-framework snippet showing how to obtain the live `editor` instance that
 * the API method examples operate on. The method calls themselves are identical
 * once you hold a reference — only the way you reach it differs:
 * - vanilla — the instance you constructed with `new Blok(...)`
 * - react   — `useBlok()` returns `Blok | null`, so guard with optional chaining
 * - vue     — `useBlok()` returns a `Ref<Blok | null>`, unwrapped via `.value`
 * - angular — the component hands the instance over through its `(ready)` output
 */
export const EDITOR_ACCESS_SNIPPETS: Record<Framework, Snippet> = {
  vanilla: {
    language: 'typescript',
    code: `// You already hold the instance returned by the constructor.
const editor = new Blok({ holder: 'editor' });
await editor.isReady;

// Call any API method on it.
editor.caret.setToLastBlock('end');`,
  },
  react: {
    language: 'tsx',
    code: `// useBlok returns \`Blok | null\` — null until the editor is ready.
const editor = useBlok({ /* config */ });

// Guard the value, then call any API method on it.
editor?.caret.setToLastBlock('end');`,
  },
  vue: {
    language: 'typescript',
    code: `// useBlok returns a \`Ref<Blok | null>\` — null until the editor is ready.
const editor = useBlok({ /* config */ });

// Unwrap with .value, then call any API method on it.
editor.value?.caret.setToLastBlock('end');`,
  },
  angular: {
    language: 'typescript',
    code: `// The component emits the live instance through its (ready) output.
// template: <blok-editor [tools]="tools" (ready)="onReady($event)" />
onReady(editor: Blok) {
  // Call any API method on it.
  editor.caret.setToLastBlock('end');
}`,
  },
};

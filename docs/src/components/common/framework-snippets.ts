import type { Framework } from '../../contexts/FrameworkContext';

/** A single highlighted snippet — the code plus the Shiki language to render it. */
export interface Snippet {
  code: string;
  language: string;
}

/** The two code steps that genuinely differ per framework: mounting and saving. */
export interface QuickStartSnippet {
  create: Snippet;
  save: Snippet;
}

/**
 * Per-framework setup snippets, mirroring the real published adapters:
 * - vanilla — `new Blok({ holder, tools })` from the core package
 * - react   — `useBlok(config)` + `<BlokContent editor={editor} />`
 * - vue     — `useBlok(config)` composable + `<BlokContent :editor="editor" />`
 * - angular — `<blok-editor [tools]="tools" />` standalone component
 *
 * Only instantiation and how you reach the live editor change between
 * frameworks; the rest of the API (`save`, `render`, `blocks`, `caret`, …)
 * operates on the same editor instance, so those examples stay framework-neutral.
 */
export const QUICK_START_SNIPPETS: Record<Framework, QuickStartSnippet> = {
  vanilla: {
    create: {
      language: 'typescript',
      code: `import { Blok } from '@jackuait/blok';
import { Header, Paragraph, List } from '@jackuait/blok/tools';

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
      code: `const data = await editor.save();
console.log(data.blocks);`,
    },
  },
  react: {
    create: {
      language: 'tsx',
      code: `import { useBlok, BlokContent } from '@jackuait/blok/react';
import { Header, Paragraph, List } from '@jackuait/blok/tools';

export function Editor() {
  const editor = useBlok({
    tools: {
      paragraph: Paragraph,
      header: { class: Header, placeholder: 'Enter a heading' },
      list: List,
    },
  });

  return <BlokContent editor={editor} />;
}`,
    },
    save: {
      language: 'tsx',
      // useBlok is null until the editor is ready, so guard the call.
      code: `const data = await editor?.save();
console.log(data?.blocks);`,
    },
  },
  vue: {
    create: {
      language: 'vue',
      code: `<script setup lang="ts">
import { useBlok, BlokContent } from '@jackuait/blok/vue';
import { Header, Paragraph, List } from '@jackuait/blok/tools';

const editor = useBlok({
  tools: {
    paragraph: Paragraph,
    header: { class: Header, placeholder: 'Enter a heading' },
    list: List,
  },
});
</script>

<template>
  <BlokContent :editor="editor" />
</template>`,
    },
    save: {
      language: 'typescript',
      // useBlok returns a ref; unwrap it with .value before calling save().
      code: `const data = await editor.value?.save();
console.log(data?.blocks);`,
    },
  },
  angular: {
    create: {
      language: 'typescript',
      code: `import { Component } from '@angular/core';
import { BlokEditorComponent } from '@jackuait/blok/angular';
import { Header, Paragraph, List } from '@jackuait/blok/tools';

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
      code: `import type { OutputData } from '@jackuait/blok';

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
    code: `import { Blok, type BlokConfig } from '@jackuait/blok';

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
    code: `import { useBlok, BlokContent } from '@jackuait/blok/react';

export function Editor() {
  // The adapter manages the mount point, so \`holder\` is omitted.
  const editor = useBlok({
    placeholder: 'Start writing...',
    autofocus: true,
    readOnly: false,
  });

  return <BlokContent editor={editor} />;
}`,
  },
  vue: {
    language: 'vue',
    code: `<script setup lang="ts">
import { useBlok, BlokContent } from '@jackuait/blok/vue';

// The adapter manages the mount point, so \`holder\` is omitted.
const editor = useBlok({
  placeholder: 'Start writing...',
  autofocus: true,
  readOnly: false,
});
</script>

<template>
  <BlokContent :editor="editor" />
</template>`,
  },
  angular: {
    language: 'typescript',
    code: `import { Component } from '@angular/core';
import { BlokEditorComponent } from '@jackuait/blok/angular';

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

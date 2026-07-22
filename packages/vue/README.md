# @bloklabs/vue

The Vue 3 block editor bindings for [Blok](https://blokeditor.com) — a headless, Notion-like rich text editor whose content is JSON blocks, not HTML.

## Install

```bash
npm install @bloklabs/vue @bloklabs/core
```

`@bloklabs/core` and `vue` are peer dependencies.

## Usage

`<BlokEditor>` is the all-in-one component: it mounts the editor, manages its lifecycle, and takes every editor config option as a prop.

```vue
<script setup lang="ts">
import { BlokEditor } from '@bloklabs/vue';
import { Header, Paragraph, List } from '@bloklabs/core/tools';

const tools = {
  paragraph: Paragraph,
  header: { class: Header, placeholder: 'Enter a heading' },
  list: List,
};
</script>

<template>
  <BlokEditor :tools="tools" />
</template>
```

## Saving

The `save` emit fires with the latest content on every change, so you never have to call `save()` by hand.

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { BlokEditor } from '@bloklabs/vue';
import type { OutputData } from '@bloklabs/core';

const data = ref<OutputData>();
</script>

<template>
  <BlokEditor @save="(d: OutputData) => (data = d)" />
  <pre>{{ data?.blocks }}</pre>
</template>
```

## Also exported

- `useBlok(config, recreateKey?)` — the composable behind the component, returns a `Ref<Blok | null>`.
- `BlokContent` — the mount-point element, if you want to wire the composable yourself.
- `useBlocks(editor)` — a reactive snapshot of the block tree plus a manipulation API.
- `createVueBlock` — author block tools as Vue components.
- `provideBlok` / `useBlokDefaults` — share default editor config through provide/inject.

## Docs

- [Quick start](https://blokeditor.com/docs/quick-start?framework=vue)
- [`BlokEditor` reference](https://blokeditor.com/docs/blok-editor?framework=vue)
- [`useBlocks` reference](https://blokeditor.com/docs/use-blocks?framework=vue)

Licensed under Apache-2.0.

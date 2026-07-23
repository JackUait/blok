# @bloklabs/react

The React block editor bindings for [Blok](https://blokeditor.com) — a headless, Notion-like rich text editor whose content is JSON blocks, not HTML.

## Install

```bash
npm install @bloklabs/react @bloklabs/core
```

`@bloklabs/core`, `react` and `react-dom` are peer dependencies.

## Usage

`<BlokEditor>` is the all-in-one component: it mounts the editor, manages its lifecycle, and takes every editor config option as a prop.

```tsx
import { BlokEditor } from '@bloklabs/react';
import { Header, Paragraph, List } from '@bloklabs/core/tools';

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
}
```

## Saving

`onSave` fires with the latest content on every change, so you never have to call `save()` by hand.

```tsx
import { useState } from 'react';
import { BlokEditor } from '@bloklabs/react';
import type { OutputData } from '@bloklabs/core';

export function Editor() {
  const [data, setData] = useState<OutputData>();

  return (
    <>
      <BlokEditor onSave={setData} />
      <pre>{JSON.stringify(data?.blocks, null, 2)}</pre>
    </>
  );
}
```

## Also exported

- `useBlok(config, deps?)` — the hook behind the component, returns `Blok | null`.
- `useBlokHandle()` — a stable, null-safe imperative handle (`focus`/`clear`/`save`/`render`/`setReadOnly`); attach via `<BlokEditor ref={handle.ref} />` instead of guarding a raw `Blok | null` ref.
- `BlokContent` — the mount-point `<div>`, if you want to wire the hook yourself.
- `useBlocks(editor)` — a reactive snapshot of the block tree plus a manipulation API.
- `createReactBlock` / `createReactInlineTool` — author block and inline tools as React components.
- `BlokProvider` / `useBlokDefaults` — share default editor config through context.

## Docs

- [Quick start](https://blokeditor.com/docs/quick-start?framework=react)
- [`BlokEditor` reference](https://blokeditor.com/docs/blok-editor?framework=react)
- [`useBlocks` reference](https://blokeditor.com/docs/use-blocks?framework=react)

Licensed under Apache-2.0.

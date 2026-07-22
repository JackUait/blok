# @bloklabs/angular

The Angular block editor bindings for [Blok](https://blokeditor.com) — a headless, Notion-like rich text editor whose content is JSON blocks, not HTML.

## Install

```bash
npm install @bloklabs/angular @bloklabs/core
```

`@bloklabs/core` and `@angular/core` / `@angular/common` / `@angular/forms` are peer dependencies.

## Usage

`BlokEditorComponent` is a standalone component: it mounts the editor, manages its lifecycle, and takes every editor config option as an input.

```typescript
import { Component } from '@angular/core';
import { BlokEditorComponent } from '@bloklabs/angular';
import { Header, Paragraph, List } from '@bloklabs/core/tools';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [BlokEditorComponent],
  template: `<blok-editor [tools]="tools" />`,
})
export class EditorComponent {
  tools = {
    paragraph: Paragraph,
    header: { class: Header, placeholder: 'Enter a heading' },
    list: List,
  };
}
```

## Saving

The `(save)` output fires with the latest content on every change, so you never have to call `save()` by hand.

```typescript
import type { OutputData } from '@bloklabs/core';

// template: <blok-editor [tools]="tools" (save)="onSave($event)" />
onSave(data: OutputData) {
  console.log(data.blocks);
}
```

The component also implements `ControlValueAccessor`, so it works with `[(ngModel)]` and reactive forms.

## Also exported

- `BlokContentDirective` (`[blokContent]`) — the mount point, if you drive the editor yourself.
- `injectBlocks()` — a reactive snapshot of the block tree plus a manipulation API.
- `createAngularBlock` — author block tools as Angular components.
- `provideBlok` / `BLOK_DEFAULT_CONFIG` — share default editor config through DI.

## Docs

- [Quick start](https://blokeditor.com/docs/quick-start?framework=angular)
- [`BlokEditor` reference](https://blokeditor.com/docs/blok-editor?framework=angular)
- [`useBlocks` reference](https://blokeditor.com/docs/use-blocks?framework=angular)

Licensed under Apache-2.0.

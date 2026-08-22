# @bloklabs/presets

Ready-made [`uploader`](https://blokeditor.com/docs/uploader-api) implementations for [Blok](https://blokeditor.com) — plug in storage you already have instead of hand-writing an upload handler. Presets for Supabase, S3-compatible storage, Cloudinary, and IndexedDB are shipping incrementally.

## Install

```bash
npm install @bloklabs/presets @bloklabs/core
```

## What a preset is

Blok's `uploader` config option takes an object shaped like this — store the file, return where it landed:

```ts
import { Blok } from '@bloklabs/core';

new Blok({
  holder: 'editor',
  uploader: {
    async uploadByFile(file, { kind }) {
      const res = await fetch(`/upload/${kind}`, { method: 'POST', body: file });
      return { url: (await res.json()).url };
    },
  },
});
```

Without an `uploadByFile`, an uploaded asset becomes a `blob:` URL that doesn't survive a reload — most projects need to configure one. Each preset in this package is a ready-made implementation of that shape for one storage backend, so you import a preset instead of writing `uploadByFile` yourself.

## Status

The presets themselves haven't landed yet — this package currently ships only the scaffold and a shared upload helper the presets build on. This README will grow to cover each one (Supabase, S3, Cloudinary, IndexedDB) as it ships.

## Docs

- [Uploader API reference](https://blokeditor.com/docs/uploader-api)

Licensed under Apache-2.0.

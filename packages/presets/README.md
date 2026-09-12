# @bloklabs/presets

Ready-made [`uploader`](https://blokeditor.com/docs/uploader-api) implementations for [Blok](https://blokeditor.com). Plug in storage you already have instead of writing an upload handler yourself. Five presets ship today: Supabase, S3-compatible storage (presigned URLs), Cloudinary, a generic fetch endpoint, and IndexedDB.

## Install

```bash
npm install @bloklabs/presets @bloklabs/core
```

## What a preset is

Blok's `uploader` config option takes an object shaped like this. Store the file, return where it landed:

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

Without an `uploadByFile`, an uploaded asset becomes a `blob:` URL. That URL does not survive a reload, so most projects need to configure one. Each preset in this package implements that shape for one storage backend. Import a preset instead of writing `uploadByFile` yourself.

## Which preset, and what it needs

| Preset | Re-hosts a pasted URL? | Needs on the storage side |
| --- | --- | --- |
| `fetchStorage` | **Yes** — your endpoint fetches it server-side | A backend answering `POST /upload` and `POST /upload-by-url` |
| `supabaseStorage` | No | A Storage bucket, made public (or an anon SELECT policy), plus an INSERT policy |
| `presignedStorage` | No | A backend that mints presigned PUT URLs, and a CORS rule on the bucket allowing PUT |
| `cloudinaryStorage` | **Yes** — Cloudinary fetches it itself | An **unsigned** upload preset in the Cloudinary dashboard |
| `indexedDBStorage` | No | Nothing — see the warning below |

Only `fetchStorage` and `cloudinaryStorage` can turn a pasted remote URL into a re-hosted copy. Both have something that fetches the URL on the server side, either your endpoint or Cloudinary's. The other three cannot. A browser is not allowed to fetch a third-party URL and re-upload it itself. Their `uploadByUrl` is deliberately left undefined rather than faked. Blok then falls back to its documented behavior and stores the pasted URL verbatim.

### fetchStorage

```ts
import { fetchStorage } from '@bloklabs/presets';

new Blok({ holder: 'editor', uploader: fetchStorage({ baseUrl: 'https://api.myapp.com' }) });
```

Your own backend does the actual storing. This preset only calls it. The backend must answer `POST {baseUrl}/upload` (multipart) and `POST {baseUrl}/upload-by-url` (`{ url }` JSON). Both return `{ url, fileName? }`. The URL you receive on `/upload-by-url` is user-supplied. Validate it server-side and block requests to internal or private addresses before fetching. Otherwise the endpoint becomes an SSRF vector.

### supabaseStorage

```ts
import { createClient } from '@supabase/supabase-js';
import { supabaseStorage } from '@bloklabs/presets';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
new Blok({ holder: 'editor', uploader: supabaseStorage(supabase, { bucket: 'blok' }) });
```

Create the bucket first (default name `"blok"`). Make it public or add an anon `SELECT` policy. This preset returns `getPublicUrl()` directly, so an unreadable object is a broken image. Then add an `INSERT` policy for whichever role the client authenticates as.

### presignedStorage

```ts
import { presignedStorage } from '@bloklabs/presets';

new Blok({ holder: 'editor', uploader: presignedStorage({ sign: (request) => api.sign(request) }) });
```

For S3, R2, MinIO, or any S3-compatible store. `sign` is your function. It gets `{ fileName, mimeType, size, kind }` and returns a presigned `{ uploadUrl, publicUrl, headers? }` from your backend. The browser then `PUT`s the file straight to `uploadUrl`. So the bucket needs a CORS rule allowing `PUT` (and `Content-Type`) from your app's origin. That CORS rule is the part that actually blocks people.

### cloudinaryStorage

```ts
import { cloudinaryStorage } from '@bloklabs/presets';

new Blok({
  holder: 'editor',
  uploader: cloudinaryStorage({ cloudName: 'my-cloud', uploadPreset: 'blok-unsigned' }),
});
```

`uploadPreset` must be **unsigned** (Cloudinary dashboard → Settings → Upload → Upload presets). A signed preset needs a server to sign the request. That defeats the point of a preset with no backend.

### indexedDBStorage

```ts
import { indexedDBStorage, resolveBlokObjectUrl } from '@bloklabs/presets';

new Blok({ holder: 'editor', uploader: indexedDBStorage() });

// Wherever you render a stored asset's url, e.g. an <img src>:
const displayUrl = await resolveBlokObjectUrl(asset.url);
```

**Not for production.** This preset stores uploaded bytes in the visitor's own browser via IndexedDB. They are gone on another device, in another browser, or the moment the user clears site data. Nothing is actually shared or backed up.

It exists because Blok's built-in fallback (a `blob:` URL) does not even survive a page reload. Before you wire up real storage, that makes local demos and prototypes look broken.

`uploadByFile` returns a `blok:asset/…` reference, not a directly usable URL. Resolve it with `resolveBlokObjectUrl` wherever you render an uploaded asset.

If you pass a custom `dbName` to `indexedDBStorage()`, pass the same `dbName` to `resolveBlokObjectUrl(url, { dbName })`. A mismatch resolves to `null` with no error, not a thrown exception.

Each call to `resolveBlokObjectUrl` mints a fresh `blob:` URL. Nothing is cached, and nothing is revoked. Call `URL.revokeObjectURL()` yourself once a displayed asset is no longer needed. Otherwise a view that re-renders it repeatedly will leak memory.

## Docs

- [Uploader API reference](https://blokeditor.com/docs/uploader-api)
- [Storage presets guide](https://blokeditor.com/presets)

Licensed under Apache-2.0.

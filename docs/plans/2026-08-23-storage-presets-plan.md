# Storage Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@bloklabs/presets` — ready-made uploaders for storage a consumer already has, so path 1 of the backend design ("I already have storage") needs no service and no backend code.

**Architecture:** Each preset is a function returning a `BlokUploader` — the contract `config.uploader` already accepts. Nothing new is invented on the client: the presets are the existing seam, pre-filled. Every preset is tree-shakeable and the package takes **zero runtime dependencies** — vendor SDKs are passed in by the consumer, never imported.

**Tech Stack:** TypeScript, Vite library build, Vitest.

**Spec:** `docs/plans/2026-08-22-backend-service-design.md` (§1 path 1, §3 seam 1)

## Global Constraints

- **Zero runtime dependencies.** The Supabase preset takes an already-constructed client as an argument; it never imports `@supabase/supabase-js`. Adding a dependency here shows up in every consumer's bundle report.
- **The contract is `BlokUploader`** from `types/configs/uploader.d.ts`: `uploadByFile(file, ctx)` and `uploadByUrl(url, ctx)`, each returning `{ url, fileName? }`. Both are optional and resolved independently.
- **`ctx.kind` routes by ASSET KIND, not by tool.** An audio block uploading cover art passes `kind: 'image'`. A preset that ignores `kind` and hard-codes one bucket will misfile cover art — the exact bug `src/components/utils/asset-uploader.ts` exists to prevent.
- **`ctx.onProgress` is optional and must be called when the transport can report it.** XHR can; `fetch` cannot without streams.
- **Version lockstep** with the `@bloklabs/*` family (currently `1.10.1`).
- **Published-types law:** no file under a published `types/` directory may import from `src/`.
- **`yarn install --immutable` is a hard CI gate.** The workspace addition ships with its `yarn.lock` entry.

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/presets/package.json` | Manifest, exports map |
| `packages/presets/src/index.ts` | Re-exports every preset |
| `packages/presets/src/fetch-endpoint.ts` | `fetchStorage` — talks to any endpoint speaking Blok's upload wire contract |
| `packages/presets/src/supabase.ts` | `supabaseStorage` |
| `packages/presets/src/presigned.ts` | `presignedStorage` — S3/R2/anything with a signer |
| `packages/presets/src/cloudinary.ts` | `cloudinaryStorage` |
| `packages/presets/src/indexeddb.ts` | `indexedDBStorage` — demos and local-first |
| `packages/presets/src/upload-xhr.ts` | Shared XHR helper that reports progress |
| `packages/presets/types/index.d.ts` | Hand-authored public types |

One file per preset: they share nothing but the XHR helper, and a consumer's bundler should be able to drop the four they do not use.

---

### Task 1: Package scaffold and the shared upload helper

**Files:**
- Create: `packages/presets/package.json`, `packages/presets/vite.config.mjs`, `packages/presets/src/index.ts`, `packages/presets/src/upload-xhr.ts`, `packages/presets/types/index.d.ts`
- Test: `packages/presets/src/upload-xhr.test.ts`
- Modify: `yarn.lock`, `scripts/build-all.mjs`, `scripts/release.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `uploadWithProgress(request: XhrRequest): Promise<XhrResult>` where

```ts
interface XhrRequest {
  method: 'POST' | 'PUT';
  url: string;
  body: FormData | File | Blob;
  headers?: Record<string, string>;
  onProgress?: (percent: number) => void;
}

interface XhrResult { status: number; text: string }
```

`fetch` cannot report upload progress without request streams, so every preset that wants a progress bar goes through this helper.

- [ ] **Step 1: Write the failing test**

`packages/presets/src/upload-xhr.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadWithProgress } from './upload-xhr';

class FakeXhr {
  public static instances: FakeXhr[] = [];
  public upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  public status = 0;
  public responseText = '';
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public readonly headers: Record<string, string> = {};
  public method = '';
  public url = '';

  public constructor() {
    FakeXhr.instances.push(this);
  }

  public open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  public setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  public send(): void {}
}

describe('uploadWithProgress', () => {
  beforeEach(() => {
    FakeXhr.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves with the status and body once the request loads', async () => {
    const pending = uploadWithProgress({ method: 'POST', url: '/upload', body: new FormData() });
    const xhr = FakeXhr.instances[0];

    xhr.status = 200;
    xhr.responseText = '{"url":"https://cdn/x.png"}';
    xhr.onload?.();

    await expect(pending).resolves.toEqual({ status: 200, text: '{"url":"https://cdn/x.png"}' });
  });

  it('reports progress as a whole percentage', async () => {
    const onProgress = vi.fn();
    const pending = uploadWithProgress({ method: 'POST', url: '/upload', body: new FormData(), onProgress });
    const xhr = FakeXhr.instances[0];

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 200 } as ProgressEvent);
    expect(onProgress).toHaveBeenCalledWith(13);

    xhr.status = 200;
    xhr.onload?.();
    await pending;
  });

  it('ignores progress events that carry no total', async () => {
    const onProgress = vi.fn();
    const pending = uploadWithProgress({ method: 'POST', url: '/upload', body: new FormData(), onProgress });
    const xhr = FakeXhr.instances[0];

    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 25, total: 0 } as ProgressEvent);
    expect(onProgress).not.toHaveBeenCalled();

    xhr.status = 200;
    xhr.onload?.();
    await pending;
  });

  it('rejects when the transport fails', async () => {
    const pending = uploadWithProgress({ method: 'POST', url: '/upload', body: new FormData() });

    FakeXhr.instances[0].onerror?.();

    await expect(pending).rejects.toThrow(/network/i);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
yarn workspace @bloklabs/presets test src/upload-xhr.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Create the package and implement**

`packages/presets/package.json` (mirrors `packages/react/package.json`'s shape):

```json
{
  "name": "@bloklabs/presets",
  "version": "1.10.1",
  "description": "Storage presets for Blok — ready-made uploaders for Supabase, S3-compatible storage, Cloudinary, and IndexedDB.",
  "license": "Apache-2.0",
  "author": "JackUait",
  "homepage": "https://blokeditor.com",
  "repository": { "type": "git", "url": "git+https://github.com/JackUait/blok.git", "directory": "packages/presets" },
  "type": "module",
  "sideEffects": false,
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./types/index.d.ts",
  "exports": {
    ".": { "types": "./types/index.d.ts", "import": "./dist/index.mjs", "require": "./dist/index.cjs" }
  },
  "files": ["dist", "types"],
  "publishConfig": { "access": "public" },
  "scripts": {
    "build": "vite build",
    "test": "vitest run"
  }
}
```

`packages/presets/src/upload-xhr.ts`:

```typescript
export interface XhrRequest {
  method: 'POST' | 'PUT';
  url: string;
  body: FormData | File | Blob;
  headers?: Record<string, string>;
  onProgress?: (percent: number) => void;
}

export interface XhrResult {
  status: number;
  text: string;
}

/**
 * XHR rather than fetch: fetch cannot report upload progress without request
 * streams, which are not available in Safari. Every preset that shows a progress
 * bar goes through here.
 */
export function uploadWithProgress(request: XhrRequest): Promise<XhrResult> {
  return new Promise<XhrResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open(request.method, request.url);

    for (const [name, value] of Object.entries(request.headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }

    if (request.onProgress) {
      xhr.upload.onprogress = (event): void => {
        if (!event.lengthComputable || event.total === 0) {
          return;
        }

        request.onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
    }

    xhr.onload = (): void => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = (): void => reject(new Error('Upload failed: network error'));

    xhr.send(request.body);
  });
}
```

`packages/presets/src/index.ts` starts empty apart from a comment; each later task adds one re-export.

- [ ] **Step 4: Run the test and watch it pass**

```bash
yarn workspace @bloklabs/presets test src/upload-xhr.test.ts
```

- [ ] **Step 5: Register the workspace everywhere it must be registered**

Nothing iterates `packages/*` automatically. All three lists are explicit:

```bash
yarn install --mode=update-lockfile
yarn install --immutable
```

In `scripts/build-all.mjs`, add to the task list alongside `react` and `vue`:

```js
    { name: 'presets', cmd: 'yarn workspace @bloklabs/presets build', deps: [] },
```

In `scripts/release.mjs`, add `'packages/presets/package.json'` to `WORKSPACE_MANIFESTS`.

- [ ] **Step 6: Commit**

```bash
git add packages/presets yarn.lock scripts/build-all.mjs scripts/release.mjs
git commit -m "feat(presets): scaffold the storage-presets package"
```

---

### Task 2: `fetchStorage` — any endpoint speaking Blok's upload contract

This is the preset that pairs with `blok-server`, and with any backend a consumer already wrote against the documented contract.

**Files:**
- Create: `packages/presets/src/fetch-endpoint.ts`
- Modify: `packages/presets/src/index.ts`, `packages/presets/types/index.d.ts`
- Test: `packages/presets/src/fetch-endpoint.test.ts`

**Interfaces:**
- Consumes: `uploadWithProgress`.
- Produces:

```ts
function fetchStorage(options: {
  baseUrl: string;
  field?: string;                                  // multipart field name, default 'file'
  headers?: Record<string, string> | (() => Promise<Record<string, string>>);
}): BlokUploader;
```

`headers` accepts a function so a caller can mint a fresh access pass per upload without the preset knowing what a pass is.

- [ ] **Step 1: Write the failing test**

`packages/presets/src/fetch-endpoint.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchStorage } from './fetch-endpoint';
import * as xhr from './upload-xhr';

describe('fetchStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts multipart to <baseUrl>/upload and returns the parsed url', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({
      status: 200,
      text: '{"url":"https://cdn.example.com/a.png","fileName":"a.png"}',
    });

    const uploader = fetchStorage({ baseUrl: 'https://blok.example.com' });
    const result = await uploader.uploadByFile!(new File(['x'], 'a.png', { type: 'image/png' }), { kind: 'image' });

    expect(result).toEqual({ url: 'https://cdn.example.com/a.png', fileName: 'a.png' });
    expect(spy.mock.calls[0][0].url).toBe('https://blok.example.com/upload');
    expect(spy.mock.calls[0][0].method).toBe('POST');
  });

  it('strips a trailing slash from baseUrl instead of producing a double slash', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '{"url":"u"}' });

    await fetchStorage({ baseUrl: 'https://blok.example.com/' })
      .uploadByFile!(new File(['x'], 'a.png'), { kind: 'image' });

    expect(spy.mock.calls[0][0].url).toBe('https://blok.example.com/upload');
  });

  it('resolves headers from a function on every call', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '{"url":"u"}' });
    const headers = vi.fn().mockResolvedValue({ Authorization: 'Bearer pass-1' });

    const uploader = fetchStorage({ baseUrl: 'https://blok.example.com', headers });
    await uploader.uploadByFile!(new File(['x'], 'a.png'), { kind: 'image' });
    await uploader.uploadByFile!(new File(['y'], 'b.png'), { kind: 'image' });

    expect(headers).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][0].headers).toEqual({ Authorization: 'Bearer pass-1' });
  });

  it('posts JSON to <baseUrl>/upload-by-url for uploadByUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://cdn.example.com/rehosted.png' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchStorage({ baseUrl: 'https://blok.example.com' })
      .uploadByUrl!('https://elsewhere.example.net/i.png', { kind: 'image' });

    expect(result.url).toBe('https://cdn.example.com/rehosted.png');
    expect(fetchMock.mock.calls[0][0]).toBe('https://blok.example.com/upload-by-url');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ url: 'https://elsewhere.example.net/i.png' });

    vi.unstubAllGlobals();
  });

  it('throws with the status when the endpoint rejects the upload', async () => {
    vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 413, text: 'file too large' });

    await expect(
      fetchStorage({ baseUrl: 'https://blok.example.com' }).uploadByFile!(new File(['x'], 'a.png'), { kind: 'image' })
    ).rejects.toThrow(/413/);
  });

  it('throws when the endpoint answers 200 with a body carrying no url', async () => {
    vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '{"ok":true}' });

    await expect(
      fetchStorage({ baseUrl: 'https://blok.example.com' }).uploadByFile!(new File(['x'], 'a.png'), { kind: 'image' })
    ).rejects.toThrow(/url/i);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
yarn workspace @bloklabs/presets test src/fetch-endpoint.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

`packages/presets/src/fetch-endpoint.ts`:

```typescript
import type { BlokUploader, UploadContext, UploadedAsset } from '../../../types/configs/uploader';
import { uploadWithProgress } from './upload-xhr';

export interface FetchStorageOptions {
  /** Base URL of a service speaking Blok's upload contract, e.g. `https://blok.myapp.com`. */
  baseUrl: string;
  /** Multipart field name the endpoint reads. Defaults to `file`. */
  field?: string;
  /**
   * Extra headers. Pass a function to mint a short-lived access pass per
   * request — the preset never inspects what it returns.
   */
  headers?: Record<string, string> | (() => Promise<Record<string, string>>);
}

export function fetchStorage(options: FetchStorageOptions): BlokUploader {
  const base = options.baseUrl.replace(/\/+$/, '');
  const field = options.field ?? 'file';

  const resolveHeaders = async (): Promise<Record<string, string>> =>
    typeof options.headers === 'function' ? options.headers() : options.headers ?? {};

  return {
    async uploadByFile(file: File, ctx: UploadContext): Promise<UploadedAsset> {
      const body = new FormData();

      body.append(field, file);

      const { status, text } = await uploadWithProgress({
        method: 'POST',
        url: `${base}/upload`,
        body,
        headers: await resolveHeaders(),
        onProgress: ctx.onProgress,
      });

      if (status < 200 || status > 299) {
        throw new Error(`Upload failed with status ${status}`);
      }

      return parseUploadResponse(text, file.name);
    },

    async uploadByUrl(url: string, _ctx: UploadContext): Promise<UploadedAsset> {
      const response = await fetch(`${base}/upload-by-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await resolveHeaders()) },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }

      const body: unknown = await response.json();

      return toAsset(body);
    },
  };
}

function parseUploadResponse(text: string, fallbackName: string): UploadedAsset {
  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('Upload failed: the endpoint returned a malformed response');
  }

  const asset = toAsset(body);

  return { url: asset.url, fileName: asset.fileName ?? fallbackName };
}

function toAsset(body: unknown): UploadedAsset {
  if (typeof body !== 'object' || body === null || typeof (body as { url?: unknown }).url !== 'string') {
    throw new Error('Upload failed: the endpoint returned no url');
  }

  const record = body as Record<string, unknown>;

  return {
    url: record.url as string,
    fileName: typeof record.fileName === 'string' ? record.fileName : undefined,
  };
}
```

Add `export { fetchStorage } from './fetch-endpoint';` to `src/index.ts`, and hand-author the signature in `types/index.d.ts` — the published-types law forbids re-exporting from `src/`.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
yarn workspace @bloklabs/presets test
```

- [ ] **Step 5: Commit**

```bash
git add packages/presets
git commit -m "feat(presets): add fetchStorage for endpoints speaking Blok's upload contract"
```

---

### Task 3: `supabaseStorage`

**Files:**
- Create: `packages/presets/src/supabase.ts`
- Modify: `packages/presets/src/index.ts`, `packages/presets/types/index.d.ts`
- Test: `packages/presets/src/supabase.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (the Supabase JS client uploads by itself).
- Produces:

```ts
interface SupabaseLike {
  storage: {
    from(bucket: string): {
      upload(path: string, file: File, options?: { contentType?: string; upsert?: boolean }):
        Promise<{ data: { path: string } | null; error: { message: string } | null }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
}

function supabaseStorage(client: SupabaseLike, options?: {
  bucket?: string | ((kind: string) => string);
  path?: (file: File, ctx: UploadContext) => string;
}): BlokUploader;
```

The client is **passed in**, never imported: that is what keeps this package dependency-free, and it means the consumer's own auth session is used.

- [ ] **Step 1: Write the failing test**

`packages/presets/src/supabase.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { supabaseStorage } from './supabase';

function fakeClient(overrides: { uploadError?: { message: string } } = {}) {
  const upload = vi.fn().mockResolvedValue({
    data: overrides.uploadError ? null : { path: 'stored/path.png' },
    error: overrides.uploadError ?? null,
  });
  const getPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl: 'https://sb.example.com/stored/path.png' } });
  const from = vi.fn().mockReturnValue({ upload, getPublicUrl });

  return { client: { storage: { from } }, from, upload, getPublicUrl };
}

describe('supabaseStorage', () => {
  it('uploads into the configured bucket and returns the public url', async () => {
    const { client, from, upload } = fakeClient();

    const result = await supabaseStorage(client, { bucket: 'media' })
      .uploadByFile!(new File(['x'], 'a.png', { type: 'image/png' }), { kind: 'image' });

    expect(from).toHaveBeenCalledWith('media');
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: 'image/png' });
    expect(result.url).toBe('https://sb.example.com/stored/path.png');
    expect(result.fileName).toBe('a.png');
  });

  // Routing on kind is the whole reason UploadContext carries it: an audio block
  // uploading cover art passes kind 'image' and must not land in the audio bucket.
  it('routes by asset kind when bucket is a function', async () => {
    const { client, from } = fakeClient();

    await supabaseStorage(client, { bucket: (kind) => `blok-${kind}` })
      .uploadByFile!(new File(['x'], 'cover.png', { type: 'image/png' }), { kind: 'image', tool: 'audio' });

    expect(from).toHaveBeenCalledWith('blok-image');
  });

  it('generates a collision-free path that keeps the extension', async () => {
    const { client, upload } = fakeClient();

    await supabaseStorage(client).uploadByFile!(new File(['x'], 'my photo.png'), { kind: 'image' });

    const path = upload.mock.calls[0][0] as string;

    expect(path).toMatch(/\.png$/);
    expect(path).not.toContain(' ');
    expect(path).not.toContain('my photo');
  });

  it('surfaces the Supabase error message', async () => {
    const { client } = fakeClient({ uploadError: { message: 'bucket not found' } });

    await expect(
      supabaseStorage(client).uploadByFile!(new File(['x'], 'a.png'), { kind: 'image' })
    ).rejects.toThrow(/bucket not found/);
  });

  it('declares no uploadByUrl, so Blok keeps a third-party URL verbatim', () => {
    const { client } = fakeClient();

    expect(supabaseStorage(client).uploadByUrl).toBeUndefined();
  });
});
```

The last test pins a deliberate decision: re-hosting a remote URL from the browser needs a server fetch, which this preset cannot do. Declaring `uploadByUrl` as a stub that silently returns the input would look like it worked. Leaving it undefined lets Blok's documented fallback apply instead.

- [ ] **Step 2: Run the test and watch it fail**

```bash
yarn workspace @bloklabs/presets test src/supabase.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

`packages/presets/src/supabase.ts`:

```typescript
import type { BlokUploader, UploadContext, UploadedAsset } from '../../../types/configs/uploader';

export interface SupabaseLike {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: File,
        options?: { contentType?: string; upsert?: boolean }
      ): Promise<{ data: { path: string } | null; error: { message: string } | null }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
}

export interface SupabaseStorageOptions {
  /** Bucket name, or a function of the asset kind for per-kind buckets. */
  bucket?: string | ((kind: string) => string);
  /** Object path. Defaults to a random name that keeps the original extension. */
  path?: (file: File, ctx: UploadContext) => string;
}

export function supabaseStorage(client: SupabaseLike, options: SupabaseStorageOptions = {}): BlokUploader {
  const bucketFor = (kind: string): string =>
    typeof options.bucket === 'function' ? options.bucket(kind) : options.bucket ?? 'blok';

  return {
    async uploadByFile(file: File, ctx: UploadContext): Promise<UploadedAsset> {
      const objectPath = options.path?.(file, ctx) ?? randomObjectName(file.name);

      const { data, error } = await client.storage
        .from(bucketFor(ctx.kind))
        .upload(objectPath, file, { contentType: file.type || undefined, upsert: false });

      if (error !== null || data === null) {
        throw new Error(`Supabase upload failed: ${error?.message ?? 'unknown error'}`);
      }

      const { data: publicData } = client.storage.from(bucketFor(ctx.kind)).getPublicUrl(data.path);

      return { url: publicData.publicUrl, fileName: file.name };
    },

    // No uploadByUrl on purpose: re-hosting a remote URL needs a server-side
    // fetch. Leaving it undefined lets Blok apply its documented fallback
    // instead of pretending the file was re-hosted.
  };
}

function randomObjectName(originalName: string): string {
  const match = /\.[a-z0-9]+$/i.exec(originalName);
  const extension = match ? match[0].toLowerCase() : '';
  const random = crypto.randomUUID();

  return `${random}${extension}`;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
yarn workspace @bloklabs/presets test
```

- [ ] **Step 5: Commit**

```bash
git add packages/presets
git commit -m "feat(presets): add supabaseStorage routing by asset kind"
```

---

### Task 4: `presignedStorage` — S3, R2, or anything with a signer

**Files:**
- Create: `packages/presets/src/presigned.ts`
- Modify: `packages/presets/src/index.ts`, `packages/presets/types/index.d.ts`
- Test: `packages/presets/src/presigned.test.ts`

**Interfaces:**
- Consumes: `uploadWithProgress`.
- Produces:

```ts
function presignedStorage(options: {
  sign: (request: { fileName: string; mimeType: string; size: number; kind: string })
    => Promise<{ uploadUrl: string; publicUrl: string; headers?: Record<string, string> }>;
}): BlokUploader;
```

The consumer's own backend mints the signed URL — credentials never reach the browser. This is the preset for anyone already on S3.

- [ ] **Step 1: Write the failing test**

`packages/presets/src/presigned.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { presignedStorage } from './presigned';
import * as xhr from './upload-xhr';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('presignedStorage', () => {
  it('PUTs the file to the signed url and returns the public url', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '' });
    const sign = vi.fn().mockResolvedValue({
      uploadUrl: 'https://bucket.s3.example.com/key?sig=abc',
      publicUrl: 'https://cdn.example.com/key',
      headers: { 'x-amz-acl': 'private' },
    });

    const result = await presignedStorage({ sign })
      .uploadByFile!(new File(['xyz'], 'a.png', { type: 'image/png' }), { kind: 'image' });

    expect(sign).toHaveBeenCalledWith({ fileName: 'a.png', mimeType: 'image/png', size: 3, kind: 'image' });
    expect(spy.mock.calls[0][0].method).toBe('PUT');
    expect(spy.mock.calls[0][0].url).toBe('https://bucket.s3.example.com/key?sig=abc');
    expect(spy.mock.calls[0][0].headers).toMatchObject({ 'x-amz-acl': 'private', 'Content-Type': 'image/png' });
    expect(result).toEqual({ url: 'https://cdn.example.com/key', fileName: 'a.png' });
  });

  it('throws when the storage rejects the PUT', async () => {
    vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 403, text: 'AccessDenied' });
    const sign = vi.fn().mockResolvedValue({ uploadUrl: 'https://u', publicUrl: 'https://p' });

    await expect(
      presignedStorage({ sign }).uploadByFile!(new File(['x'], 'a.png'), { kind: 'image' })
    ).rejects.toThrow(/403/);
  });

  it('propagates a failure from the signer without attempting an upload', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress');
    const sign = vi.fn().mockRejectedValue(new Error('not authorised'));

    await expect(
      presignedStorage({ sign }).uploadByFile!(new File(['x'], 'a.png'), { kind: 'image' })
    ).rejects.toThrow(/not authorised/);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
yarn workspace @bloklabs/presets test src/presigned.test.ts
```

- [ ] **Step 3: Implement**

`packages/presets/src/presigned.ts`:

```typescript
import type { BlokUploader, UploadContext, UploadedAsset } from '../../../types/configs/uploader';
import { uploadWithProgress } from './upload-xhr';

export interface SignRequest {
  fileName: string;
  mimeType: string;
  size: number;
  kind: string;
}

export interface SignedTarget {
  /** Short-lived URL the browser PUTs to. */
  uploadUrl: string;
  /** Where the object will be readable once stored. */
  publicUrl: string;
  /** Headers the signature covers — they must be sent verbatim or it fails. */
  headers?: Record<string, string>;
}

export interface PresignedStorageOptions {
  sign(request: SignRequest): Promise<SignedTarget>;
}

export function presignedStorage(options: PresignedStorageOptions): BlokUploader {
  return {
    async uploadByFile(file: File, ctx: UploadContext): Promise<UploadedAsset> {
      const target = await options.sign({
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        kind: ctx.kind,
      });

      const { status } = await uploadWithProgress({
        method: 'PUT',
        url: target.uploadUrl,
        body: file,
        // Content-Type is part of what the signature covers for most providers,
        // so it is set last and cannot be dropped by a caller's header map.
        headers: { ...target.headers, 'Content-Type': file.type || 'application/octet-stream' },
        onProgress: ctx.onProgress,
      });

      if (status < 200 || status > 299) {
        throw new Error(`Upload failed with status ${status}`);
      }

      return { url: target.publicUrl, fileName: file.name };
    },
  };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
yarn workspace @bloklabs/presets test
```

- [ ] **Step 5: Commit**

```bash
git add packages/presets
git commit -m "feat(presets): add presignedStorage for S3-compatible storage"
```

---

### Task 5: `cloudinaryStorage`

**Files:**
- Create: `packages/presets/src/cloudinary.ts`
- Modify: `packages/presets/src/index.ts`, `packages/presets/types/index.d.ts`
- Test: `packages/presets/src/cloudinary.test.ts`

**Interfaces:**
- Consumes: `uploadWithProgress`.
- Produces:

```ts
function cloudinaryStorage(options: {
  cloudName: string;
  uploadPreset: string;                       // an UNSIGNED preset
  folder?: string;
}): BlokUploader;
```

Unlike the others this one has a real `uploadByUrl`: Cloudinary fetches remote URLs itself, so re-hosting works without any server of the consumer's.

- [ ] **Step 1: Write the failing test**

`packages/presets/src/cloudinary.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudinaryStorage } from './cloudinary';
import * as xhr from './upload-xhr';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const preset = { cloudName: 'demo', uploadPreset: 'blok-unsigned' };

describe('cloudinaryStorage', () => {
  it('posts to the image endpoint for image assets', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({
      status: 200,
      text: '{"secure_url":"https://res.cloudinary.com/demo/image/upload/v1/a.png"}',
    });

    const result = await cloudinaryStorage(preset)
      .uploadByFile!(new File(['x'], 'a.png', { type: 'image/png' }), { kind: 'image' });

    expect(spy.mock.calls[0][0].url).toBe('https://api.cloudinary.com/v1_1/demo/image/upload');
    expect(result.url).toBe('https://res.cloudinary.com/demo/image/upload/v1/a.png');
  });

  // Cloudinary routes by resource type in the URL, so the kind must pick it.
  it('uses the video endpoint for video and audio, and raw for files', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '{"secure_url":"u"}' });
    const uploader = cloudinaryStorage(preset);

    await uploader.uploadByFile!(new File(['x'], 'a.mp4', { type: 'video/mp4' }), { kind: 'video' });
    await uploader.uploadByFile!(new File(['x'], 'a.mp3', { type: 'audio/mpeg' }), { kind: 'audio' });
    await uploader.uploadByFile!(new File(['x'], 'a.zip'), { kind: 'file' });

    expect(spy.mock.calls[0][0].url).toContain('/video/upload');
    expect(spy.mock.calls[1][0].url).toContain('/video/upload');
    expect(spy.mock.calls[2][0].url).toContain('/raw/upload');
  });

  it('re-hosts a remote URL by handing it to Cloudinary as the file field', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({
      status: 200,
      text: '{"secure_url":"https://res.cloudinary.com/demo/image/upload/v1/rehosted.png"}',
    });

    const result = await cloudinaryStorage(preset)
      .uploadByUrl!('https://elsewhere.example.net/i.png', { kind: 'image' });

    expect((spy.mock.calls[0][0].body as FormData).get('file')).toBe('https://elsewhere.example.net/i.png');
    expect(result.url).toBe('https://res.cloudinary.com/demo/image/upload/v1/rehosted.png');
  });

  it('throws when Cloudinary answers without a secure_url', async () => {
    vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '{"error":{"message":"bad preset"}}' });

    await expect(
      cloudinaryStorage(preset).uploadByFile!(new File(['x'], 'a.png'), { kind: 'image' })
    ).rejects.toThrow(/bad preset/);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
yarn workspace @bloklabs/presets test src/cloudinary.test.ts
```

- [ ] **Step 3: Implement**

`packages/presets/src/cloudinary.ts`:

```typescript
import type { BlokUploader, UploadContext, UploadedAsset } from '../../../types/configs/uploader';
import { uploadWithProgress } from './upload-xhr';

export interface CloudinaryStorageOptions {
  cloudName: string;
  /** An UNSIGNED upload preset — a signed one would need a server. */
  uploadPreset: string;
  folder?: string;
}

// Cloudinary picks the pipeline from the resource type in the path, so the
// asset kind must map onto it. Audio rides the video pipeline by their design.
const RESOURCE_TYPE: Record<string, string> = {
  image: 'image',
  video: 'video',
  audio: 'video',
  file: 'raw',
};

export function cloudinaryStorage(options: CloudinaryStorageOptions): BlokUploader {
  const endpointFor = (kind: string): string =>
    `https://api.cloudinary.com/v1_1/${options.cloudName}/${RESOURCE_TYPE[kind] ?? 'raw'}/upload`;

  const send = async (kind: string, filePart: File | string, onProgress?: (p: number) => void): Promise<UploadedAsset> => {
    const body = new FormData();

    body.append('file', filePart);
    body.append('upload_preset', options.uploadPreset);

    if (options.folder !== undefined) {
      body.append('folder', options.folder);
    }

    const { status, text } = await uploadWithProgress({ method: 'POST', url: endpointFor(kind), body, onProgress });

    return parseCloudinary(text, status, typeof filePart === 'string' ? undefined : filePart.name);
  };

  return {
    uploadByFile: (file, ctx: UploadContext) => send(ctx.kind, file, ctx.onProgress),
    uploadByUrl: (url, ctx: UploadContext) => send(ctx.kind, url, ctx.onProgress),
  };
}

function parseCloudinary(text: string, status: number, fileName?: string): UploadedAsset {
  let body: Record<string, unknown>;

  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Cloudinary upload failed with status ${status}`);
  }

  if (typeof body.secure_url !== 'string') {
    const error = body.error as { message?: string } | undefined;

    throw new Error(`Cloudinary upload failed: ${error?.message ?? `status ${status}`}`);
  }

  return { url: body.secure_url, fileName };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
yarn workspace @bloklabs/presets test
```

- [ ] **Step 5: Commit**

```bash
git add packages/presets
git commit -m "feat(presets): add cloudinaryStorage with kind-aware resource types"
```

---

### Task 6: `indexedDBStorage` — demos and local-first

**Files:**
- Create: `packages/presets/src/indexeddb.ts`
- Modify: `packages/presets/src/index.ts`, `packages/presets/types/index.d.ts`
- Test: `packages/presets/src/indexeddb.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `indexedDBStorage(options?: { dbName?: string }): BlokUploader` plus `resolveBlokObjectUrl(url: string): Promise<string | null>` — the reader the host needs to turn a stored reference back into something an `<img>` can display after a reload.

This preset exists because Blok's built-in fallback is `URL.createObjectURL`, which does **not** survive a reload — a demo looks fine until the page refreshes and every image is broken.

- [ ] **Step 1: Write the failing test**

`packages/presets/src/indexeddb.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { indexedDBStorage, resolveBlokObjectUrl } from './indexeddb';

// vitest.config.ts runs jsdom, which has no IndexedDB. `fake-indexeddb/auto`
// installs a spec-compliant in-memory implementation on globalThis.
import 'fake-indexeddb/auto';

describe('indexedDBStorage', () => {
  beforeEach(async () => {
    indexedDB.deleteDatabase('blok-assets-test');
  });

  it('stores the file and returns a stable blok: reference', async () => {
    const uploader = indexedDBStorage({ dbName: 'blok-assets-test' });

    const result = await uploader.uploadByFile!(new File(['bytes'], 'a.png', { type: 'image/png' }), { kind: 'image' });

    expect(result.url).toMatch(/^blok:asset\//);
    expect(result.fileName).toBe('a.png');
  });

  it('reads the file back after the object URL from the first session is gone', async () => {
    const uploader = indexedDBStorage({ dbName: 'blok-assets-test' });
    const { url } = await uploader.uploadByFile!(new File(['bytes'], 'a.png', { type: 'image/png' }), { kind: 'image' });

    const resolved = await resolveBlokObjectUrl(url, { dbName: 'blok-assets-test' });

    expect(resolved).toMatch(/^blob:/);
  });

  it('returns null for a reference that is not stored', async () => {
    expect(await resolveBlokObjectUrl('blok:asset/missing', { dbName: 'blok-assets-test' })).toBeNull();
  });

  it('passes through a plain http url untouched', async () => {
    expect(await resolveBlokObjectUrl('https://example.com/a.png', { dbName: 'blok-assets-test' }))
      .toBe('https://example.com/a.png');
  });
});
```

- [ ] **Step 2: Add the test-only dependency and watch the test fail**

```bash
yarn workspace @bloklabs/presets add -D fake-indexeddb
yarn workspace @bloklabs/presets test src/indexeddb.test.ts
```

Expected: FAIL — the module does not exist. `fake-indexeddb` is a **devDependency**; it must not appear in `dependencies`, or the zero-dependency constraint is broken.

- [ ] **Step 3: Implement**

Write `packages/presets/src/indexeddb.ts` with:

```typescript
import type { BlokUploader, UploadContext, UploadedAsset } from '../../../types/configs/uploader';

export interface IndexedDBStorageOptions {
  dbName?: string;
}

const DEFAULT_DB = 'blok-assets';
const STORE = 'assets';
const PREFIX = 'blok:asset/';

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);

    request.onupgradeneeded = (): void => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));

    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function indexedDBStorage(options: IndexedDBStorageOptions = {}): BlokUploader {
  const dbName = options.dbName ?? DEFAULT_DB;

  return {
    async uploadByFile(file: File, _ctx: UploadContext): Promise<UploadedAsset> {
      const key = crypto.randomUUID();
      const db = await openDb(dbName);

      await tx(db, 'readwrite', (store) => store.put({ blob: file, name: file.name, type: file.type }, key));
      db.close();

      // A blok: reference rather than a blob: URL: blob URLs are scoped to the
      // page that made them, so saving one produces a broken image after reload.
      return { url: `${PREFIX}${key}`, fileName: file.name };
    },
  };
}

export async function resolveBlokObjectUrl(url: string, options: IndexedDBStorageOptions = {}): Promise<string | null> {
  if (!url.startsWith(PREFIX)) {
    return url;
  }

  const db = await openDb(options.dbName ?? DEFAULT_DB);
  const record = await tx<{ blob: Blob } | undefined>(db, 'readonly', (store) => store.get(url.slice(PREFIX.length)));

  db.close();

  return record ? URL.createObjectURL(record.blob) : null;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
yarn workspace @bloklabs/presets test
```

- [ ] **Step 5: Commit**

```bash
git add packages/presets
git commit -m "feat(presets): add indexedDBStorage so demo uploads survive a reload"
```

---

### Task 7: Documentation

**Files:**
- Create: `docs/src/components/presets/presets-data.ts`
- Modify: the docs route table alongside the existing pages
- Test: `docs/src/components/presets/presets-data.test.ts`

**Interfaces:**
- Consumes: every preset.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { presets } from './presets-data';

describe('presets docs data', () => {
  it('documents every shipped preset', () => {
    expect(presets.map((p) => p.id).sort()).toEqual(
      ['cloudinary', 'fetch-endpoint', 'indexeddb', 'presigned', 'supabase'].sort()
    );
  });

  it('says for each preset whether re-hosting a remote URL works', () => {
    for (const preset of presets) {
      expect(typeof preset.supportsUploadByUrl).toBe('boolean');
    }
  });

  it('marks indexedDB as unsuitable for production', () => {
    expect(presets.find((p) => p.id === 'indexeddb')?.productionReady).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd docs && yarn test src/components/presets/presets-data.test.ts
```

- [ ] **Step 3: Write the docs data and page**

One page listing all five, each with: the two lines of config, whether `uploadByUrl` works and why, and what the consumer must set up on the storage side (a bucket, a CORS rule, an unsigned preset). The `supportsUploadByUrl` flag is load-bearing in the copy: three of the five cannot re-host a remote URL, and a reader must learn that from the table rather than from a bug report.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd docs && yarn test src/components/presets/presets-data.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: document the storage presets"
```

---

## Notes for the executor

- **`uploadByUrl` is absent from three presets on purpose.** Supabase, presigned S3, and IndexedDB cannot fetch a third-party URL from the browser. Leaving the method undefined makes Blok apply its documented fallback (store the URL verbatim); defining it as a pass-through would look identical at the type level and silently misreport a re-host that never happened.
- **`ctx.kind`, not `ctx.tool`.** See `src/components/utils/asset-uploader.ts` — routing on the tool is the bug that broke audio cover art.
- **Zero runtime dependencies is a constraint, not a preference.** `fake-indexeddb` is the only new dependency and it is dev-only.

// docs/src/components/presets/presets-data.ts
import type { ToolConfigOption } from '../tools/tools-data';

export type PresetId = 'fetch-endpoint' | 'supabase' | 'presigned' | 'cloudinary' | 'indexeddb';

export interface PresetSection {
  id: PresetId;
  exportName: string; // exact export name in packages/presets/src/index.ts
  title: string;
  description: string;
  /** Whether the browser can hand this preset a remote URL and get a re-hosted copy back. */
  supportsUploadByUrl: boolean;
  /** Why re-hosting does or doesn't work — surfaced next to the flag, not buried in prose. */
  uploadByUrlNote: string;
  /** False only for indexeddb: bytes live in one visitor's browser, not shared storage. */
  productionReady: boolean;
  productionNote?: string;
  configOptions: ToolConfigOption[];
  /** What the consumer must configure on the storage side before this works at all. */
  storageSetup: string[];
  usageExample: string;
}

export const presets: PresetSection[] = [
  {
    id: 'fetch-endpoint',
    exportName: 'fetchStorage',
    title: 'Fetch endpoint',
    description:
      'Talks to a backend you already have. Every upload goes through your server, which decides where the bytes actually land.',
    supportsUploadByUrl: true,
    uploadByUrlNote:
      'Yes — your endpoint does the fetch server-side, so the browser never has to reach a third-party URL itself.',
    productionReady: true,
    configOptions: [
      {
        option: 'baseUrl',
        type: 'string',
        default: '(required)',
        description: "Origin of your upload service, e.g. \"https://api.myapp.com\".",
      },
      {
        option: 'field',
        type: 'string',
        default: '"file"',
        description: 'Multipart field name the endpoint reads for POST /upload.',
      },
      {
        option: 'headers',
        type: 'Record<string, string> | (() => Promise<Record<string, string>>)',
        default: 'undefined',
        description: 'Extra headers on every request. Pass a function to mint a fresh access token per upload.',
      },
    ],
    storageSetup: [
      'A server that answers POST {baseUrl}/upload (multipart) and POST {baseUrl}/upload-by-url ({ url }) with { url, fileName? } JSON.',
      "Where the endpoint stores the file — S3, a disk volume, Supabase — is entirely the endpoint's decision; this preset never sees it.",
    ],
    usageExample: `import { fetchStorage } from '@bloklabs/presets';

new Blok({
  holder: 'editor',
  uploader: fetchStorage({ baseUrl: 'https://api.myapp.com' }),
});`,
  },
  {
    id: 'supabase',
    exportName: 'supabaseStorage',
    title: 'Supabase',
    description: 'Uploads straight to a Supabase Storage bucket using the client you already initialize.',
    supportsUploadByUrl: false,
    uploadByUrlNote:
      "No — re-hosting a remote URL needs a server-side fetch, and the browser can't make one on Supabase's behalf. uploadByUrl is left undefined so Blok stores the URL verbatim instead of pretending it was re-hosted.",
    productionReady: true,
    configOptions: [
      {
        option: 'bucket',
        type: 'string | ((kind: string) => string)',
        default: '"blok"',
        description: 'Bucket name, or a function of the asset kind for per-kind buckets.',
      },
      {
        option: 'path',
        type: '(file: File, ctx: UploadContext) => string',
        default: 'random name, original extension kept',
        description: 'Object path within the bucket.',
      },
    ],
    storageSetup: [
      'Create the bucket in the Supabase dashboard (default name "blok", or whatever `bucket` resolves to).',
      'Make the bucket public, or add a Storage policy granting anon SELECT — this preset returns getPublicUrl() directly, so an unreadable object is a broken image.',
      "Add a Storage INSERT policy for whichever role the client authenticates as.",
    ],
    usageExample: `import { createClient } from '@supabase/supabase-js';
import { supabaseStorage } from '@bloklabs/presets';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
new Blok({ holder: 'editor', uploader: supabaseStorage(supabase, { bucket: 'blok' }) });`,
  },
  {
    id: 'presigned',
    exportName: 'presignedStorage',
    title: 'Presigned URLs',
    description:
      'For S3 and S3-compatible storage (R2, MinIO, GCS). Your backend mints a short-lived signed URL; the browser PUTs the file straight to it.',
    supportsUploadByUrl: false,
    uploadByUrlNote:
      "No — re-hosting a remote URL needs a server-side fetch, which is outside what a presigned PUT URL can do. uploadByUrl is left undefined so Blok stores the URL verbatim instead.",
    productionReady: true,
    configOptions: [
      {
        option: 'sign',
        type: '(request: SignRequest) => Promise<SignedTarget>',
        default: '(required)',
        description:
          'Called with { fileName, mimeType, size, kind }; must return { uploadUrl, publicUrl, headers? } from your backend.',
      },
    ],
    storageSetup: [
      'A backend endpoint that mints a presigned PUT URL (e.g. S3 PutObjectCommand) and returns it as SignedTarget.',
      "A CORS rule on the bucket allowing PUT (and the headers this preset sends, notably Content-Type) from your app's origin — this is what actually blocks people, since the browser PUTs directly to the bucket.",
    ],
    usageExample: `import { presignedStorage } from '@bloklabs/presets';

new Blok({
  holder: 'editor',
  uploader: presignedStorage({ sign: (request) => api.sign(request) }),
});`,
  },
  {
    id: 'cloudinary',
    exportName: 'cloudinaryStorage',
    title: 'Cloudinary',
    description: 'Uploads directly to Cloudinary using an unsigned upload preset — no backend required.',
    supportsUploadByUrl: true,
    uploadByUrlNote:
      "Yes — Cloudinary fetches the remote URL itself once the browser hands it over, so re-hosting works without any server of the consumer's.",
    productionReady: true,
    configOptions: [
      {
        option: 'cloudName',
        type: 'string',
        default: '(required)',
        description: 'Your Cloudinary cloud name.',
      },
      {
        option: 'uploadPreset',
        type: 'string',
        default: '(required)',
        description: 'Must be an UNSIGNED upload preset — a signed one would need a server.',
      },
      {
        option: 'folder',
        type: 'string',
        default: 'undefined',
        description: 'Optional folder to upload into.',
      },
    ],
    storageSetup: [
      'A Cloudinary account and its cloud name.',
      'An upload preset with signing mode set to Unsigned (Settings → Upload → Upload presets) — a signed preset silently fails from the browser since there is no server to sign the request.',
      "Audio assets ride Cloudinary's video pipeline by Cloudinary's own design; this preset maps kinds onto resource types accordingly, no setup needed for that part.",
    ],
    usageExample: `import { cloudinaryStorage } from '@bloklabs/presets';

new Blok({
  holder: 'editor',
  uploader: cloudinaryStorage({ cloudName: 'my-cloud', uploadPreset: 'blok-unsigned' }),
});`,
  },
  {
    id: 'indexeddb',
    exportName: 'indexedDBStorage',
    title: 'IndexedDB',
    description:
      'Stores uploaded files as blobs in the browser\'s own IndexedDB — nothing leaves the device.',
    supportsUploadByUrl: false,
    uploadByUrlNote:
      "No — there is nothing to re-host to; a remote URL just gets stored as-is. IndexedDB only has an uploadByFile.",
    productionReady: false,
    productionNote:
      "Demo and prototyping only. The bytes live in one visitor's browser: they're gone on another device, in another browser, or the moment the user clears site data. It exists because Blok's built-in fallback (a blob: URL) doesn't even survive a page reload, which makes demos look broken before you've configured any real storage.",
    configOptions: [
      {
        option: 'dbName',
        type: 'string',
        default: '"blok-assets"',
        description: 'IndexedDB database name.',
      },
    ],
    storageSetup: [
      'None — this preset needs no external service, which is the point.',
      'Wire the exported resolveBlokObjectUrl(url) helper into wherever you render an uploaded asset: uploadByFile returns a blok:asset/… reference, not a directly usable URL, and nothing resolves it back into a blob: URL for you automatically.',
    ],
    usageExample: `import { indexedDBStorage, resolveBlokObjectUrl } from '@bloklabs/presets';

new Blok({ holder: 'editor', uploader: indexedDBStorage() });

// Wherever you render a stored asset's url, e.g. an <img src>:
const displayUrl = await resolveBlokObjectUrl(asset.url);`,
  },
];

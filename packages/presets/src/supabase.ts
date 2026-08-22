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

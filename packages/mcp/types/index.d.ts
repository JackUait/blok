/**
 * Public types for `@bloklabs/mcp`.
 *
 * Hand-authored: a published `.d.ts` may not reach outside its own tarball,
 * and this package has no `@bloklabs/core` dependency.
 * AgentActor, ManifestOverrides and BlokCustomToolsFile copy core's types;
 * test/unit/mcp/public-types.test.ts fails the type check when they drift.
 */

export interface AgentActor {
  id: string;
  name: string;
  kind: 'agent';
  onBehalfOf?: string;
  color?: string;
}

export type ManifestOverrides = Record<string, { hidden?: boolean; hiddenActions?: string[]; guidance?: string }>;

export interface BlokCustomToolsFile {
  formatVersion: 1;
  blocks: Array<{
    name: string;
    /** A `BlockToolDescription` from `@bloklabs/core`. `object`, not a Record: core's interfaces have no index signature. */
    description: object;
    /** `SnapshotBlockStatics` from `@bloklabs/core`. */
    statics: object;
    /** Object and boolean sanitize rules only. */
    sanitize?: Record<string, unknown>;
  }>;
  /** The host's own inline tools. Their marks are `tag:<tag>` keys. */
  inlineTools?: Array<{
    name: string;
    title?: string;
    /** The tool's `static sanitize` as JSON: tag to `true` or to its attributes. */
    sanitize: Record<string, true | Record<string, boolean | string>>;
  }>;
}

export interface BlokMcpOptions {
  transport: { kind: 'stdio' } | { kind: 'http'; listen: string; public?: boolean };
  auth: { kind: 'none' } | { kind: 'oauth'; issuer: string; audience: string; jwksUrl: string };
  /** Absent: no live mode. */
  sync?: { url: string; origin?: string };
  tickets?: { kind: 'secret'; secret: string } | { kind: 'url'; url: string; hostToken: string };
  authorize?: (principal: string, documentId: string, write: boolean) => Promise<boolean>;
  /**
   * Builds the session's actor. The ticket `user` must equal the returned `id`.
   * Blocks the agent writes name `onBehalfOf` in `createdBy`/`lastEditedBy` and the
   * actor's `id` in `createdWith`/`lastEditedWith`. Leave `onBehalfOf` out and the
   * agent's id is named alone. The default actor sets it to the principal.
   */
  agentActor?: (principal: string, clientName: string) => AgentActor;
  source?: { kind: 'endpoint'; url: string; endpointAuth: string; list?: string } | { kind: 'files'; dir: string };
  /** Host custom tool descriptions, as `--manifest <file>` loads them. */
  manifest?: BlokCustomToolsFile;
  /** 'page-map' turns on headless page.rename / page.setIcon, and inserting a page block (it creates the page document). Default 'off'. */
  pageTitles?: 'off' | 'page-map';
  /** Same shape as `--manifest-overrides <file>`. */
  overrides?: ManifestOverrides;
  /** Only for block types missing from the manifest. */
  richTextFields?: Record<string, string[]>;
  /** Default 'mixed': full arguments for the common commands, the envelope for the rest. */
  schema?: 'envelope' | 'full' | 'mixed';
  /** Default 600000 (10 minutes). */
  handleIdleMs?: number;
  /** Default 8. */
  maxHandlesPerPrincipal?: number;
  /** stdio and auth 'none' only: who the caller is. Default 'local'. */
  principal?: string;
  /** Turns on `image.uploadFile`, `video.uploadFile`, `audio.uploadFile` and `file.uploadFile`. */
  uploads?: McpUploads;
}

export type McpAssetKind = 'image' | 'video' | 'audio' | 'file';

/** Copies core's `UploadContext`, without the progress and variant fields an agent upload never sends. */
export interface McpUploadContext {
  kind: McpAssetKind;
  tool?: string;
}

/** The host's own uploader, which an agent's upload goes through. */
export interface McpUploads {
  uploader: {
    /** A file card keeps `size` and `mimeType` when the host returns them. */
    uploadByFile(file: File, ctx: McpUploadContext): Promise<{ url: string; fileName?: string; size?: number; mimeType?: string }>;
    /** When set, `<tool>.setSource` copies a linked file to the host too. */
    uploadByUrl?(url: string, ctx: McpUploadContext): Promise<{ url: string; fileName?: string }>;
  };
  /** A folder the agent may upload from by path. stdio only; symlinks out of it are refused. Absent: base64 bytes only. */
  root?: string;
  /** Per kind, like a media tool's `types` and `maxSize`. Defaults: image/*, audio/* and video/* only; 30 MiB, video 100 MiB. */
  limits?: Partial<Record<McpAssetKind, { types?: string[]; maxSize?: number }>>;
}

export declare function createBlokMcpServer(options: BlokMcpOptions): { start(): Promise<void>; stop(): Promise<void> };

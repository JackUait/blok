import type { AgentActor } from '../../../types/agent';
import type { UploadContext, UploadedAsset } from '../../../types/configs/uploader';
import type { BlokCustomToolsFile, ManifestOverrides } from '../../../types/tool-manifest';

export interface BlokMcpOptions {
  transport: { kind: 'stdio' } | { kind: 'http'; listen: string; public?: boolean };
  auth: { kind: 'none' } | { kind: 'oauth'; issuer: string; audience: string; jwksUrl: string };
  sync?: { url: string; origin?: string };
  tickets?: { kind: 'secret'; secret: string } | { kind: 'url'; url: string; hostToken: string };
  authorize?: (principal: string, documentId: string, write: boolean) => Promise<boolean>;
  agentActor?: (principal: string, clientName: string) => AgentActor;
  source?:
    | { kind: 'endpoint'; url: string; endpointAuth: string; list?: string }
    | { kind: 'files'; dir: string }
    | { kind: 'custom'; source: BlokMcpDocumentSource };
  manifest?: BlokCustomToolsFile;
  pageTitles?: 'off' | 'page-map';
  overrides?: ManifestOverrides;
  richTextFields?: Record<string, string[]>;
  schema?: 'envelope' | 'full' | 'mixed';
  handleIdleMs?: number;
  maxHandlesPerPrincipal?: number;
  principal?: string;
  uploads?: McpUploads;
  /**
   * The host makes each new page document (src/mcp/create-page.ts). Runs only with pageTitles
   * 'page-map' and a stored source. Answers the new page id, or null to refuse (FORBIDDEN).
   */
  createPage?: (request: BlokPageCreateRequest) => Promise<string | null>;
  /**
   * False: the editors keep comments in the host's own system (a `comments` hook). Agent
   * comments would be invisible to people there, so the comment commands are unavailable.
   * On by default.
   */
  comments?: boolean;
}

/** What the host gets when an agent inserts a page block. */
export interface BlokPageCreateRequest {
  /** The open document the page block goes into. */
  parentDocumentId: string;
  principal: string;
  actor: AgentActor;
  /** A fresh Blok id the host may use or ignore. */
  suggestedPageId: string;
}

/** Who works on a document: the caller that opened the handle, with the agent's actor. */
export interface BlokDocumentCaller {
  principal: string;
  clientName: string;
  /** Null when the caller came without scopes (stdio, or a host that passes none). */
  scopes: readonly string[] | null;
  actor: AgentActor;
}

/**
 * The host's own document store (src/mcp/sources/custom.ts). Throw a BlokMcpSourceError to
 * refuse with a code; any other throw is logged and the agent sees SOURCE_UNAVAILABLE.
 */
export interface BlokMcpDocumentSource {
  /** Null: never saved. An existing document needs a non-empty version. */
  load(caller: BlokDocumentCaller, documentId: string): Promise<{ document: unknown; version: string } | null>;
  /**
   * documentText is compact JSON. ifVersion null means "must not exist yet"; any other value
   * must equal the stored version, else throw `changed`. Answer the new non-empty version.
   */
  save(caller: BlokDocumentCaller, documentId: string, documentText: string, ifVersion: string | null): Promise<{ version: string }>;
  /** Absent: listing is not supported. Blok still runs authorize on every id. */
  list?(
    caller: BlokDocumentCaller,
    request: { query?: string; cursor?: string; limit: number },
  ): Promise<{ documents: Array<{ id: string; title?: string | null }>; nextCursor?: string | null }>;
}

/**
 * The host's own uploader, which `<tool>.uploadFile` sends files through. A throw reaches the
 * agent as "The upload failed.", or as the error's string `agentMessage` (src/mcp/uploads.ts).
 */
export interface McpUploads {
  uploader: {
    uploadByFile(file: File, ctx: UploadContext): Promise<UploadedAsset & { size?: number; mimeType?: string }>;
    uploadByUrl?(url: string, ctx: UploadContext): Promise<UploadedAsset>;
  };
  /** A folder the agent may upload files from by path. stdio only. Absent: bytes only. */
  root?: string;
  /** Per kind, as a media tool's `types` and `maxSize`. Absent: the tool's defaults. */
  limits?: Partial<Record<'image' | 'video' | 'audio' | 'file', { types?: string[]; maxSize?: number }>>;
}

export const DEFAULTS: {
  handleIdleMs: 600_000;
  maxHandlesPerPrincipal: 8;
  schema: 'mixed';
  pageTitles: 'off';
  principal: 'local';
} = {
  handleIdleMs: 600_000,
  maxHandlesPerPrincipal: 8,
  schema: 'mixed',
  pageTitles: 'off',
  principal: 'local',
};

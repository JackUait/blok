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
   * Where stored-mode handles live (src/mcp/shared-handles.ts). Absent: this process's memory, as
   * before. Live handles always stay in this process.
   */
  handleStore?: BlokMcpHandleStore;
  /**
   * False: the editors keep comments in the host's own system (a `comments` hook). Agent
   * comments would be invisible to people there, so the comment commands are unavailable.
   * On by default.
   */
  comments?: boolean;
}

/**
 * One stored-mode handle as a handle store keeps it: plain JSON, written by Blok. Live handles hold
 * sockets and are never stored. The server checks `principal` and `contractRevision`, never the store.
 */
export interface BlokMcpHandleRecord {
  /** The record format. A store keeps the record as it is given. */
  v: 1;
  /** The tool contract of the server that opened the handle. Another one answers VERSION_SKEW. */
  contractRevision: string;
  /** The opener. A call from another principal answers UNKNOWN_HANDLE. */
  principal: string;
  clientName: string;
  scopes: readonly string[] | null;
  actor: AgentActor;
  documentId: string;
  write: boolean;
  /** The source version the next save sends as `ifVersion`. */
  version: string | null;
  /** The last save or reload failed: the next call reloads from the source first. */
  stale: boolean;
  /** The document as the handle holds it: `blocks` and the page fields (`title`, `icon`, ...). */
  document: { blocks: unknown[] };
  /**
   * Undo and redo steps, `{ past, future, lost?, revision }`, each step a whole document. Not
   * bounded in bytes: the newest step is always kept, so a store must take large values.
   */
  history: Record<string, unknown>;
}

/**
 * One call's hold on a handle. A lease is time-limited: the store ends it unless it is renewed, so
 * a paused holder can lose it to another process. Every op checks that this lease still holds the
 * handle; once it does not, renew, save and remove must throw and change nothing.
 */
export interface BlokMcpHandleLease {
  readonly record: BlokMcpHandleRecord;
  /**
   * Extends the lease. Blok calls it every 5 seconds while a call holds the lease, so a store needs
   * no timer of its own; a lease not renewed for longer than the store's lease time (30 s) may be taken.
   */
  renew(): Promise<void>;
  /** Replaces the record. Blok calls it after the source save, before release. */
  save(record: BlokMcpHandleRecord): Promise<void>;
  /** Ends the lease and restarts the handle's idle time. Does nothing once the lease is gone. */
  release(): Promise<void>;
  /** Deletes the handle (blok_close, or a record that could not be saved). The lease ends with it. */
  remove(): Promise<void>;
}

/**
 * Where stored-mode handles live, so any process sharing the store can serve a call. A handle
 * expires after `idleMs` without a lease; a leased handle never expires. Blok passes only handles
 * of 1-128 characters of [A-Za-z0-9_-]. Any throw is logged and the agent sees SOURCE_UNAVAILABLE.
 */
export interface BlokMcpHandleStore {
  /** The principal's handles that have not expired. */
  count(principal: string, idleMs: number): Promise<number>;
  /** Counts and adds as one step: false, and nothing added, when the principal already holds maxPerPrincipal. */
  tryAdd(handle: string, record: BlokMcpHandleRecord, maxPerPrincipal: number, idleMs: number): Promise<boolean>;
  /** Waits up to timeoutMs for the lease. 'unknown': no such handle, or it expired. 'busy': still leased at the timeout. */
  acquire(handle: string, idleMs: number, timeoutMs: number): Promise<BlokMcpHandleLease | 'unknown' | 'busy'>;
  /**
   * Deletes every handle idle longer than idleMs that nobody leases, of every principal. Blok calls
   * it on a timer. A store that expires records by itself (a TTL) may do nothing here.
   */
  sweep(idleMs: number): Promise<void>;
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
  /**
   * Null: never saved. Else the document as JSON text, as stored, with its non-empty version.
   * Text, not a parsed object: Blok parses it as the endpoint source does (src/mcp/sources/custom.ts).
   */
  load(caller: BlokDocumentCaller, documentId: string): Promise<{ documentText: string; version: string } | null>;
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

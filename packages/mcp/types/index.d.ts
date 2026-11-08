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
  /** Where stored documents live. `custom` is your own store; it cannot be combined with the other two. */
  source?:
    | { kind: 'endpoint'; url: string; endpointAuth: string; list?: string }
    | { kind: 'files'; dir: string }
    | { kind: 'custom'; source: BlokMcpDocumentSource };
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
  /**
   * False: the editors keep comments in the host's own system (a `comments` hook). Agent
   * comments would be invisible to people there, so the comment commands are unavailable.
   * On by default.
   */
  comments?: boolean;
}

/** Who works on a document: the caller that opened the handle, with the agent's actor. */
export interface BlokDocumentCaller {
  principal: string;
  clientName: string;
  /** Null when the caller came without scopes. */
  scopes: readonly string[] | null;
  actor: AgentActor;
}

/**
 * Your own document store. Blok checks every loaded document as it checks a file (a `blocks`
 * array, at most 48 levels deep, lone surrogates as U+FFFD), and still runs `authorize` first.
 * Throw a `BlokMcpSourceError` to refuse with a code. Any other throw, or a missing version, is
 * logged to stderr and the agent sees SOURCE_UNAVAILABLE; a failed save drops the batch from memory.
 */
export interface BlokMcpDocumentSource {
  /** Null: never saved (opens empty, `exists: false`). An existing document needs a non-empty version. */
  load(caller: BlokDocumentCaller, documentId: string): Promise<{ document: unknown; version: string } | null>;
  /**
   * `documentText` is compact JSON. `ifVersion` null means "must not exist yet"; otherwise it must
   * equal the stored version, or throw `changed`. Answer the new non-empty version.
   */
  save(caller: BlokDocumentCaller, documentId: string, documentText: string, ifVersion: string | null): Promise<{ version: string }>;
  /** Absent: listing is not supported. Blok drops every id `authorize` refuses. */
  list?(
    caller: BlokDocumentCaller,
    request: { query?: string; cursor?: string; limit: number },
  ): Promise<{ documents: Array<{ id: string; title?: string | null }>; nextCursor?: string | null }>;
}

/** changed: DOCUMENT_CHANGED; unavailable: SOURCE_UNAVAILABLE; forbidden: FORBIDDEN; invalidId: INVALID_ARGS. */
export type BlokMcpSourceErrorKind = 'changed' | 'unavailable' | 'forbidden' | 'invalidId';

/** A refusal from your document source. The agent sees `agentMessage`, or Blok's own words when it is empty. */
export declare class BlokMcpSourceError extends Error {
  readonly kind: BlokMcpSourceErrorKind;
  readonly agentMessage: string;
  constructor(kind: BlokMcpSourceErrorKind, agentMessage: string, options?: { cause?: unknown });
}

export type McpAssetKind = 'image' | 'video' | 'audio' | 'file';

/** Copies core's `UploadContext`, without the progress and variant fields an agent upload never sends. */
export interface McpUploadContext {
  kind: McpAssetKind;
  tool?: string;
}

/**
 * The host's own uploader, which an agent's upload goes through. When it throws, the agent sees
 * TOOL_ACTION_FAILED "The upload failed." and the error goes to stderr. A string `agentMessage`
 * on the thrown error is shown to the agent instead.
 */
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

/** The `blok-mcp` flags and env as options, with the `--authorize` hook and the manifest files loaded. */
export declare function parseBlokMcpArgs(argv: string[], env: Record<string, string | undefined>): Promise<BlokMcpOptions>;

/** The same options as the standalone server. The host owns the transport and sign-in, so both are optional. */
export type BlokEmbedOptions = Omit<BlokMcpOptions, 'transport' | 'auth'> & Partial<Pick<BlokMcpOptions, 'transport' | 'auth'>>;

/** The parts of an `@modelcontextprotocol/server` request context Blok reads. The SDK's `ServerContext` fits it. */
export interface BlokMcpRequestContext {
  mcpReq: { signal: AbortSignal; envelope?: unknown; inputResponses?: unknown };
  http?: { authInfo?: { token?: string; clientId?: string; scopes?: string[]; extra?: Record<string, unknown> } };
}

/** Who the host says calls. No principal (or an empty one) means signed in without a name. */
export interface BlokCallerIdentity {
  principal?: string | null;
  /** OAuth-style scopes; null or absent skips Blok's `blok.read` / `blok.write` checks. */
  scopes?: readonly string[] | null;
}

export interface CreateBlokHooks {
  /**
   * The signed-in caller of one `tools/call`, or null/undefined for an anonymous one.
   * Default: `ctx.http.authInfo`, named by its `extra.sub`. An anonymous caller gets the
   * protocol error "Blok needs a signed-in caller."; an unnamed one "Blok needs a named caller (sub or NameIdentifier).".
   */
  caller?(ctx: BlokMcpRequestContext): BlokCallerIdentity | null | undefined | Promise<BlokCallerIdentity | null | undefined>;
  /** Serve anonymous callers as this principal. Absent: they are refused. */
  anonymousPrincipal?: string;
}

/** An `@modelcontextprotocol/server` low-level `Server`, or an `McpServer` (its `.server` is used). */
export type BlokMcpSdkServer = { setRequestHandler: unknown } | { server: { setRequestHandler: unknown } };

export interface BlokMcpToolEntry {
  name: string;
  description?: string;
  inputSchema: { type: 'object'; [key: string]: unknown };
  [key: string]: unknown;
}

export interface BlokMcpPromptEntry {
  name: string;
  [key: string]: unknown;
}

export interface BlokMcpToolCall {
  params: { name: string; arguments?: Record<string, unknown> };
}

export interface BlokMcpPromptGet {
  params: { name: string; arguments?: Record<string, string> };
}

/** The one question Blok asks the client's person: approve a change a person guarded (a locked database). */
export interface BlokMcpApprovalRequest {
  method: 'elicitation/create';
  params: {
    mode: 'form';
    message: string;
    requestedSchema: {
      type: 'object';
      properties: Record<string, { type: 'boolean'; title?: string; description?: string; default?: boolean }>;
      required?: string[];
    };
  };
}

/** A `tools/call` result, or an `input_required` result asking for approval (the SDK turns it into elicitation for 2025 clients). */
export type BlokMcpCallResult = { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean; [key: string]: unknown }
  | { resultType: 'input_required'; inputRequests: Record<string, BlokMcpApprovalRequest>; [key: string]: unknown };

export interface BlokMcpPromptResult {
  description?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
  [key: string]: unknown;
}

/** Blok's answers for one server, for a host that installs the four handlers itself. */
export interface BlokMcpHandlers {
  ownsTool(name: string): boolean;
  ownsPrompt(name: string): boolean;
  listTools(): { tools: BlokMcpToolEntry[] };
  listPrompts(): { prompts: BlokMcpPromptEntry[] };
  /** Throws Blok's protocol errors (-32602, -32603, -32600 for the caller) for the SDK to send. */
  callTool(request: BlokMcpToolCall, ctx: BlokMcpRequestContext): Promise<BlokMcpCallResult>;
  getPrompt(request: BlokMcpPromptGet): BlokMcpPromptResult;
}

/** The host's own tools and prompts, served next to Blok's by `attach`. Other names reach these handlers. */
/** Your own tool and prompt names, checked against Blok's. */
export interface BlokMcpHostNames {
  tools?: ReadonlyArray<{ name: string }>;
  prompts?: ReadonlyArray<{ name: string }>;
}

export interface BlokMcpHostSurface {
  tools?: BlokMcpToolEntry[];
  callTool?(request: BlokMcpToolCall, ctx: BlokMcpRequestContext): unknown;
  prompts?: BlokMcpPromptEntry[];
  getPrompt?(request: BlokMcpPromptGet, ctx: BlokMcpRequestContext): unknown;
}

export interface BlokMcp {
  /** Blok's primer. Put it into your own server's instructions; Blok never sets them. */
  readonly instructions: string;
  readonly toolNames: readonly string[];
  readonly promptNames: readonly string[];
  readonly version: string;
  /**
   * Serves Blok's tools and prompts on your server, next to `host`'s. It adds the tools and
   * prompts capabilities when missing and changes nothing else. It throws when a host name
   * is a Blok name, or when the server already answers tools/list, tools/call, prompts/list or prompts/get.
   */
  attach(server: BlokMcpSdkServer, host?: BlokMcpHostSurface): void;
  /**
   * Blok's four handlers, for a server whose tools/list, tools/call, prompts/list and prompts/get you
   * install yourself. Pass your own tools and prompts: it throws when one of their names is a Blok name.
   */
  handlers(server: BlokMcpSdkServer, host?: BlokMcpHostNames): BlokMcpHandlers;
  /** Waits for calls in flight and closes every handle. */
  close(): Promise<void>;
}

/**
 * Blok's tools and prompts for your own MCP server. Build it once and attach it to every
 * server you make (one per request over stateless HTTP). It needs `authorize`, as HTTP does,
 * and refuses `auth: oauth` and `principal`: your server signs callers in.
 */
export declare function createBlok(options: BlokEmbedOptions, hooks?: CreateBlokHooks): BlokMcp;

import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';

import type { McpServer, ServerContext } from '@modelcontextprotocol/server';

import { getBlokVersion } from '../components/utils/version';

import { checkOptionSafety, McpConfigError } from './config';
import type { BlokMcpOptions } from './options';
import { listMcpPrompts } from './prompts';
import { assertNoClash, attachBlok, blokHandlers } from './sdk-server';
import type { BlokHandlers, HostNames, HostSurface, ResolveCaller, SdkServer } from './sdk-server';
import { assembleMcp } from './server';

export type { BlokHandlers as BlokMcpHandlers, HostNames as BlokMcpHostNames, HostSurface as BlokMcpHostSurface } from './sdk-server';

/** The same options as the standalone server. The host owns the transport and sign-in, so both are optional. */
export type BlokEmbedOptions = Omit<BlokMcpOptions, 'transport' | 'auth'> & Partial<Pick<BlokMcpOptions, 'transport' | 'auth'>>;

/** Who the host says calls. No principal (or an empty one) means signed in without a name. */
export interface BlokCallerIdentity {
  principal?: string | null;
  /** OAuth-style scopes; null or absent skips Blok's blok.read / blok.write checks. */
  scopes?: readonly string[] | null;
}

export interface CreateBlokHooks {
  /**
   * The signed-in caller of one tools/call, or null/undefined for an anonymous one.
   * Default: `ctx.http.authInfo`, named by its `extra.sub`.
   */
  caller?(ctx: ServerContext): BlokCallerIdentity | null | undefined | Promise<BlokCallerIdentity | null | undefined>;
  /** Serve anonymous callers as this principal. Absent: they are refused. */
  anonymousPrincipal?: string;
}

export interface BlokMcp {
  /** Blok's primer. The host puts it into its own server's instructions; Blok never sets them. */
  readonly instructions: string;
  readonly toolNames: readonly string[];
  readonly promptNames: readonly string[];
  readonly version: string;
  /** Serves Blok's tools and prompts on the host's low-level server (or McpServer.server). */
  attach(server: SdkServer | McpServer, host?: HostSurface): void;
  /**
   * Blok's handlers, for a host that installs tools/list, tools/call, prompts/list and prompts/get itself.
   * Pass the host's own tools and prompts to have their names checked against Blok's, as attach does.
   */
  handlers(server: SdkServer | McpServer, host?: HostNames): BlokHandlers;
  /** Waits for calls in flight and closes every handle. */
  close(): Promise<void>;
}

const ANONYMOUS = 'Blok needs a signed-in caller.';
const FAILED = 'Blok could not run this call.';

/**
 * On a host's server an unexpected throw (the host's caller hook, a host store or source bug, Blok's
 * own) must not reach the client: it is logged in full and answered -32603 with fixed words.
 * Blok's protocol errors pass as they are. The standalone server keeps the SDK's own answer.
 */
const hidden = (thrown: unknown): never => {
  if (thrown instanceof ProtocolError) {
    throw thrown;
  }
  console.error('blok-mcp: a tool call failed', thrown);
  throw new ProtocolError(ProtocolErrorCode.InternalError, FAILED);
};
const UNNAMED = 'Blok needs a named caller (sub or NameIdentifier).';

const fromAuthInfo = (ctx: ServerContext): BlokCallerIdentity | undefined => {
  const info = ctx.http?.authInfo;

  if (info === undefined) {
    return undefined;
  }
  const sub = info.extra?.sub;

  return { principal: typeof sub === 'string' ? sub : null };
};

const checkEmbedOptions = (options: BlokEmbedOptions, hooks: CreateBlokHooks): void => {
  if (options.auth?.kind === 'oauth') {
    throw new McpConfigError("Blok's own OAuth is for the standalone server; on a host server the host signs callers in (pass caller)");
  }
  if (options.principal !== undefined) {
    throw new McpConfigError('principal names the standalone caller; on a host server use caller, or anonymousPrincipal');
  }
  if (hooks.anonymousPrincipal !== undefined && (typeof hooks.anonymousPrincipal !== 'string' || hooks.anonymousPrincipal === '')) {
    throw new McpConfigError('anonymousPrincipal must be a non-empty string');
  }
  // Blok cannot see the host's transport, so it treats every caller as remote, as over HTTP.
  const hostDecides = options.tickets?.kind === 'url' && options.source === undefined;

  if (options.authorize === undefined && !hostDecides) {
    throw new McpConfigError('Blok on a host server needs a per-document check: pass authorize (--authorize), or serve live rooms only with --ticket-url and no source');
  }
  // A loopback listen keeps the bind rules out; the host owns its address.
  checkOptionSafety({ ...options, transport: { kind: 'http', listen: '127.0.0.1:0' }, auth: { kind: 'none' } });
};

// Duck-typed: a host may load its own copy of the SDK, where instanceof would fail.
const lowLevel = (server: SdkServer | McpServer): SdkServer => ('setRequestHandler' in server ? server : server.server);

/**
 * Blok's MCP tools and prompts for a host's own MCP server. Build it once; attach it to
 * every server the host makes (one per request over stateless HTTP).
 */
export const createBlok = (options: BlokEmbedOptions, hooks: CreateBlokHooks = {}): BlokMcp => {
  checkEmbedOptions(options, hooks);
  const assembled = assembleMcp({ ...options, transport: options.transport ?? { kind: 'stdio' }, auth: { kind: 'none' } });
  const identify = hooks.caller ?? fromAuthInfo;
  const resolveCaller: ResolveCaller = async (clientName, ctx) => {
    const who = await identify(ctx);

    if (who === null || who === undefined) {
      if (hooks.anonymousPrincipal === undefined) {
        throw new ProtocolError(ProtocolErrorCode.InvalidRequest, ANONYMOUS);
      }

      return { principal: hooks.anonymousPrincipal, clientName, scopes: null };
    }
    if (typeof who.principal !== 'string' || who.principal === '') {
      throw new ProtocolError(ProtocolErrorCode.InvalidRequest, UNNAMED);
    }

    return { principal: who.principal, clientName, scopes: who.scopes ?? null };
  };
  const handlersFor = (server: SdkServer | McpServer): BlokHandlers => {
    const made = blokHandlers({ tools: assembled.tools, dispatch: assembled.dispatch, resolveCaller }, lowLevel(server));

    return { ...made, callTool: (request, ctx) => made.callTool(request, ctx).catch(hidden) };
  };
  const handlers = (server: SdkServer | McpServer, host: HostNames = {}): BlokHandlers => {
    const made = handlersFor(server);

    assertNoClash(made, host);

    return made;
  };

  return {
    instructions: assembled.instructions,
    toolNames: assembled.tools.map(tool => tool.name),
    promptNames: listMcpPrompts().map(prompt => prompt.name),
    version: getBlokVersion(),
    attach: (server, host) => attachBlok(lowLevel(server), handlersFor(server), host),
    handlers,
    close: () => assembled.stop(),
  };
};

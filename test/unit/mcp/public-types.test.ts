// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallToolRequest, Server, ServerContext } from '@modelcontextprotocol/server';
import type * as Public from '../../../packages/mcp/types/index';
import { BlokMcpSourceError, parseBlokMcpArgs } from '../../../src/mcp/index';
import type { createBlok } from '../../../src/mcp/index';
import type { BlokDocumentCaller, BlokMcpDocumentSource, BlokMcpOptions as InternalOptions, BlokPageCreateRequest } from '../../../src/mcp/options';
import type { AgentActor } from '../../../types/agent';
import type { BlokCustomToolsFile, ManifestOverrides } from '../../../types/tool-manifest';

/*
 * Compile-time drift guard: `yarn lint:types` fails on an assignment below
 * when a copy in packages/mcp/types drifts from its source.
 */
const actorToPublic = (value: AgentActor): Public.AgentActor => value;
const actorFromPublic = (value: Public.AgentActor): AgentActor => value;
const overridesToPublic = (value: ManifestOverrides): Public.ManifestOverrides => value;
const overridesFromPublic = (value: Public.ManifestOverrides): ManifestOverrides => value;
// One way only: the copy loosens description and statics, so core values must fit it.
const customToolsToPublic = (value: BlokCustomToolsFile): Public.BlokCustomToolsFile => value;
const optionsToPublic = (value: InternalOptions): Public.BlokMcpOptions => value;
const optionsFromPublic = (value: Public.BlokMcpOptions): Omit<InternalOptions, 'manifest'> => value;

// The options copy loosens the manifest, so createBlok is checked by its hooks and its answer.
// handlers() answers the SDK's wider result types; wireHost below checks the public ones fit the SDK.
const blokToPublic = (value: ReturnType<typeof createBlok>): Omit<Public.BlokMcp, 'handlers'> => value;
const hooksFromPublic = (value: Public.CreateBlokHooks): NonNullable<Parameters<typeof createBlok>[1]> => value;
const parseArgsToPublic: typeof Public.parseBlokMcpArgs = parseBlokMcpArgs;
const sourceToPublic = (value: BlokMcpDocumentSource): Public.BlokMcpDocumentSource => value;
const sourceFromPublic = (value: Public.BlokMcpDocumentSource): BlokMcpDocumentSource => value;
const sourceErrorToPublic: typeof Public.BlokMcpSourceError = BlokMcpSourceError;
const pageRequestToPublic = (value: BlokPageCreateRequest): Public.BlokPageCreateRequest => value;
const pageRequestFromPublic = (value: Public.BlokPageCreateRequest): BlokPageCreateRequest => value;

// A TypeScript host wires the public handlers into the SDK without a cast.
const wireHost = (server: Server, blok: Public.BlokMcp): void => {
  const handlers = blok.handlers(server);

  server.setRequestHandler('tools/call', (request: CallToolRequest, ctx: ServerContext) => handlers.callTool(request, ctx));
  server.setRequestHandler('tools/list', () => handlers.listTools());
  blok.attach(server, { tools: [{ name: 'host_echo', inputSchema: { type: 'object' } }], callTool: (_request, ctx) => ctx.mcpReq.signal });
};

// Assignability misses a dropped optional field, so the key sets must match too.
type SameKeys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false;
type CustomBlock = BlokCustomToolsFile['blocks'][number];
type PublicCustomBlock = Public.BlokCustomToolsFile['blocks'][number];

const sameKeys: [
  SameKeys<AgentActor, Public.AgentActor>,
  SameKeys<ManifestOverrides[string], Public.ManifestOverrides[string]>,
  SameKeys<BlokCustomToolsFile, Public.BlokCustomToolsFile>,
  SameKeys<CustomBlock, PublicCustomBlock>,
  SameKeys<InternalOptions, Public.BlokMcpOptions>,
  SameKeys<BlokDocumentCaller, Public.BlokDocumentCaller>,
  SameKeys<BlokMcpDocumentSource, Public.BlokMcpDocumentSource>,
  SameKeys<BlokPageCreateRequest, Public.BlokPageCreateRequest>,
] = [true, true, true, true, true, true, true, true];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('@bloklabs/mcp public types', () => {
  it('keeps the compile-time checks referenced', () => {
    expect([
      actorToPublic, actorFromPublic, overridesToPublic, overridesFromPublic, customToolsToPublic, optionsToPublic, optionsFromPublic,
      blokToPublic, hooksFromPublic, parseArgsToPublic, wireHost, sourceToPublic, sourceFromPublic, sourceErrorToPublic,
      pageRequestToPublic, pageRequestFromPublic,
    ]).toHaveLength(16);
    expect(sameKeys.every(Boolean)).toBe(true);
  });

  it('declares createBlokMcpServer and imports nothing', () => {
    const source = readFileSync(resolve(__dirname, '../../../packages/mcp/types/index.d.ts'), 'utf-8');

    expect(source).toContain('export declare function createBlokMcpServer');
    expect(source).toContain('export declare function createBlok(');
    expect(source).toContain('export declare function parseBlokMcpArgs');
    expect(source).not.toMatch(/\bfrom\s+['"]|\bimport\s*\(|\brequire\s*\(/);
  });
});

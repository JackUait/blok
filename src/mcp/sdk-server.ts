import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, inputRequired, inputResponse, McpServer, ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';

import type {
  CallToolRequest, CallToolResult, GetPromptRequest, GetPromptResult, InputRequiredResult, Prompt, ServerContext, Tool,
} from '@modelcontextprotocol/server';
import type { AgentApprovalRequest } from '../../types/agent';

import { approvalKey } from '../shared/agent/approval';
import { approvalQuestion, canElicit, elicitationApprover } from '../shared/mcp/approval';

import { safeClientName } from './actor';
import { UnknownToolError } from './dispatcher';
import { getMcpPrompt, listMcpPrompts } from './prompts';
import type { Caller, CallOptions, ToolOutcome } from './dispatcher';
import type { McpTool } from './tools';

/** The SDK's low-level server: McpServer.server, or one a host made itself. */
export type SdkServer = McpServer['server'];

export type Dispatch = (
  name: string,
  args: Record<string, unknown>,
  caller: Caller,
  options?: CallOptions,
) => Promise<ToolOutcome>;

/** Who calls one tools/call. Throwing a ProtocolError refuses the call. */
export type ResolveCaller = (clientName: string, ctx: ServerContext) => Caller | Promise<Caller>;

/** Blok's answers for the four methods it serves, bound to one SDK server. */
export interface BlokHandlers {
  ownsTool(name: string): boolean;
  ownsPrompt(name: string): boolean;
  listTools(): { tools: Tool[] };
  listPrompts(): { prompts: Prompt[] };
  callTool(request: CallToolRequest, ctx: ServerContext): Promise<CallToolResult | InputRequiredResult>;
  getPrompt(request: GetPromptRequest): GetPromptResult;
}

/** The host's own tools and prompts, served next to Blok's on the same methods. */
export interface HostSurface {
  tools?: Tool[];
  callTool?(request: CallToolRequest, ctx: ServerContext): CallToolResult | InputRequiredResult | Promise<CallToolResult | InputRequiredResult>;
  prompts?: Prompt[];
  getPrompt?(request: GetPromptRequest, ctx: ServerContext): GetPromptResult | InputRequiredResult | Promise<GetPromptResult | InputRequiredResult>;
}

const objectRooted = (tools: McpTool[]): (McpTool & Tool)[] => {
  // The SDK requires an object root; keep the renderer schemas by reference.
  if (!tools.every((tool): tool is McpTool & Tool => tool.inputSchema.type === 'object')) {
    throw new TypeError('MCP tool input schemas must have an object root.');
  }

  return tools;
};

const clientNameOf = (server: SdkServer, envelope: unknown): string => {
  const clientInfo = typeof envelope === 'object' && envelope !== null && CLIENT_INFO_META_KEY in envelope
    ? envelope[CLIENT_INFO_META_KEY]
    : undefined;

  return safeClientName(typeof clientInfo === 'object' && clientInfo !== null
    && 'name' in clientInfo && typeof clientInfo.name === 'string'
    ? clientInfo.name
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- 2025-era clients name themselves only in initialize; they send no per-request envelope.
    : server.getClientVersion()?.name);
};

export const blokHandlers = (input: { tools: McpTool[]; dispatch: Dispatch; resolveCaller: ResolveCaller }, server: SdkServer): BlokHandlers => {
  const tools = objectRooted(input.tools);
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  const promptNames = new Set(listMcpPrompts().map(prompt => prompt.name));

  return {
    ownsTool: name => byName.has(name),
    ownsPrompt: name => promptNames.has(name),
    listTools: () => ({ tools }),
    // Ask AI's skills, so an MCP client can offer the same buttons.
    listPrompts: () => ({ prompts: listMcpPrompts() }),
    getPrompt: request => getMcpPrompt(request.params.name, request.params.arguments),
    callTool: async (request, ctx) => {
      const name = request.params.name;
      const tool = byName.get(name);

      if (tool === undefined) {
        throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool: ${name}`);
      }
      const envelope: unknown = ctx.mcpReq.envelope;
      const caller = await input.resolveCaller(clientNameOf(server, envelope), ctx);
      const declared = typeof envelope === 'object' && envelope !== null && CLIENT_CAPABILITIES_META_KEY in envelope
        ? envelope[CLIENT_CAPABILITIES_META_KEY]
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- 2025-era clients declare capabilities only in initialize.
        : server.getClientCapabilities();
      const asked: AgentApprovalRequest[] = [];
      const approve = canElicit(declared) ? elicitationApprover(ctx.mcpReq.inputResponses, asked, inputResponse) : undefined;
      const outcome = await (async (): Promise<ToolOutcome> => {
        try {
          return await input.dispatch(name, request.params.arguments ?? {}, caller, { signal: ctx.mcpReq.signal, ...(approve !== undefined && { approve }) });
        } catch (thrown) {
          if (thrown instanceof UnknownToolError) {
            throw new ProtocolError(ProtocolErrorCode.InvalidParams, thrown.message);
          }
          throw thrown;
        }
      })();

      const question = asked[0];

      // The batch applied nothing; the client asks its person, then sends the same call again with the reply.
      if (question !== undefined) {
        return inputRequired({ inputRequests: { [approvalKey(question)]: inputRequired.elicit(approvalQuestion(question, caller.clientName)) } });
      }

      return server.projectCallToolResult({
        content: [{ type: 'text', text: JSON.stringify(outcome.structuredContent) }],
        structuredContent: outcome.structuredContent,
        isError: outcome.isError,
      }, tool.outputSchema);
    },
  };
};

const BLOK_METHODS = ['tools/list', 'tools/call', 'prompts/list', 'prompts/get'] as const;

const clashes = (names: string[] | undefined, owns: (name: string) => boolean): string[] =>
  (names ?? []).filter(name => owns(name));

/**
 * Serves Blok's tools and prompts on a host's low-level server, next to the host's own.
 * It never changes serverInfo, instructions or a handler the host set; it only adds the
 * tools and prompts capabilities when they are missing.
 */
export const attachBlok = (server: SdkServer, blok: BlokHandlers, host: HostSurface = {}): void => {
  const taken = [
    ...clashes(host.tools?.map(tool => tool.name), blok.ownsTool),
    ...clashes(host.prompts?.map(prompt => prompt.name), blok.ownsPrompt),
  ];

  if (taken.length > 0) {
    throw new Error(`Blok already serves ${taken.join(', ')}: rename the host's tool or prompt`);
  }
  for (const method of BLOK_METHODS) {
    try {
      server.assertCanSetRequestHandler(method);
    } catch {
      throw new Error(`The host server already answers ${method}. attach() serves it: pass the host's own tools and prompts to attach(), or compose handlers() yourself`);
    }
  }
  const capabilities = server.getCapabilities();

  // setRequestHandler checks the capability, so it must be there first.
  server.registerCapabilities({
    ...(capabilities.tools === undefined && { tools: {} }),
    ...(capabilities.prompts === undefined && { prompts: {} }),
  });
  server.setRequestHandler('tools/list', async () => (host.tools === undefined ? blok.listTools() : { tools: [...host.tools, ...blok.listTools().tools] }));
  server.setRequestHandler('prompts/list', async () => (host.prompts === undefined ? blok.listPrompts() : { prompts: [...host.prompts, ...blok.listPrompts().prompts] }));
  server.setRequestHandler('prompts/get', async (request, ctx) => (blok.ownsPrompt(request.params.name) || host.getPrompt === undefined
    ? blok.getPrompt(request)
    : host.getPrompt(request, ctx)));
  server.setRequestHandler('tools/call', async (request, ctx) => (blok.ownsTool(request.params.name) || host.callTool === undefined
    ? blok.callTool(request, ctx)
    : host.callTool(request, ctx)));
};

export const buildSdkServer = (input: {
  tools: McpTool[];
  instructions: string;
  dispatch: Dispatch;
  caller: (clientName: string) => Caller;
  version: string;
}): McpServer['server'] => {
  // Clients put instructions in the model's context; otherwise the primer is only in blok_describe().
  const mcp = new McpServer({ name: 'blok-mcp', version: input.version }, { instructions: input.instructions });
  const server = mcp.server;

  attachBlok(server, blokHandlers({ tools: input.tools, dispatch: input.dispatch, resolveCaller: clientName => input.caller(clientName) }, server));

  return server;
};

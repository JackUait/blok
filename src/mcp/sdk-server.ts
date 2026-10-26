import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, inputRequired, inputResponse, McpServer, ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';

import type { Tool } from '@modelcontextprotocol/server';
import type { AgentApprovalRequest, AgentApprover } from '../../types/agent';

import { approvalKey, plainLine } from '../shared/agent/approval';

import { safeClientName } from './actor';
import { UnknownToolError } from './dispatcher';
import { getMcpPrompt, listMcpPrompts } from './prompts';
import type { Caller, CallOptions, ToolOutcome } from './dispatcher';
import type { McpTool } from './tools';

export type Dispatch = (
  name: string,
  args: Record<string, unknown>,
  caller: Caller,
  options?: CallOptions,
) => Promise<ToolOutcome>;

/**
 * The question MCP elicitation puts to the client's person (spec: client/elicitation).
 * Named by the saved title, so a rename in the same batch cannot hide the database.
 */
/** `client` is already safeClientName's: letters, digits, dot, dash and underscore. */
const unlockQuestion = (request: AgentApprovalRequest, client: string): ReturnType<typeof inputRequired.elicit> => inputRequired.elicit({
  // The title is already one plain line (savedTitle); JSON quoting keeps its own quotes from closing ours.
  message: `${client}'s agent wants to unlock the database ${request.title === undefined ? '' : `${JSON.stringify(request.title)} `}`
    + `(id ${JSON.stringify(plainLine(request.blockId, 64) ?? '?')}). A person locked it, so its properties and views cannot change. Unlock it?`,
  requestedSchema: {
    type: 'object',
    properties: { unlock: { type: 'boolean', title: 'Unlock', description: 'Tick to let the agent unlock this database.', default: false } },
    required: ['unlock'],
  },
});

/**
 * Answers from the person's elicitation replies on this request. With no reply yet it records
 * the question and says no, so the batch applies nothing; the server then asks and the client retries.
 * The model never sees these replies: the client sends them, not the tool arguments.
 */
const elicitationApprover = (responses: unknown, asked: AgentApprovalRequest[]): AgentApprover => (request) => {
  const reply = inputResponse(typeof responses === 'object' && responses !== null ? responses as Record<string, unknown> : undefined, approvalKey(request));

  if (reply.kind === 'elicit') {
    return Promise.resolve(reply.action === 'accept' && reply.content?.unlock === true);
  }
  asked.push(request);

  return Promise.resolve(false);
};

const canElicit = (capabilities: unknown): boolean =>
  typeof capabilities === 'object' && capabilities !== null && 'elicitation' in capabilities
  && typeof capabilities.elicitation === 'object' && capabilities.elicitation !== null;

export const buildSdkServer = (input: {
  tools: McpTool[];
  instructions: string;
  dispatch: Dispatch;
  caller: (clientName: string) => Caller;
  version: string;
}): McpServer['server'] => {
  const tools = input.tools;

  // The SDK requires an object root; keep the renderer schemas by reference.
  if (!tools.every((tool): tool is McpTool & Tool => tool.inputSchema.type === 'object')) {
    throw new TypeError('MCP tool input schemas must have an object root.');
  }
  // Clients put instructions in the model's context; otherwise the primer is only in blok_describe().
  const mcp = new McpServer({ name: 'blok-mcp', version: input.version }, { instructions: input.instructions });
  const server = mcp.server;
  const byName = new Map(tools.map(tool => [tool.name, tool]));

  server.registerCapabilities({ tools: {}, prompts: {} });
  server.setRequestHandler('tools/list', async () => ({ tools }));
  // Ask AI's skills, so an MCP client can offer the same buttons.
  server.setRequestHandler('prompts/list', async () => ({ prompts: listMcpPrompts() }));
  server.setRequestHandler('prompts/get', async request => getMcpPrompt(request.params.name, request.params.arguments));
  server.setRequestHandler('tools/call', async (request, ctx) => {
    const name = request.params.name;
    const tool = byName.get(name);

    if (tool === undefined) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    const envelope: unknown = ctx.mcpReq.envelope;
    const clientInfo = typeof envelope === 'object' && envelope !== null && CLIENT_INFO_META_KEY in envelope
      ? envelope[CLIENT_INFO_META_KEY]
      : undefined;
    const rawName = typeof clientInfo === 'object' && clientInfo !== null
      && 'name' in clientInfo && typeof clientInfo.name === 'string'
      ? clientInfo.name
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- 2025-era clients name themselves only in initialize; they send no per-request envelope.
      : server.getClientVersion()?.name;
    const caller = input.caller(safeClientName(rawName));
    const declared = typeof envelope === 'object' && envelope !== null && CLIENT_CAPABILITIES_META_KEY in envelope
      ? envelope[CLIENT_CAPABILITIES_META_KEY]
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- 2025-era clients declare capabilities only in initialize.
      : server.getClientCapabilities();
    const asked: AgentApprovalRequest[] = [];
    const approve = canElicit(declared) ? elicitationApprover(ctx.mcpReq.inputResponses, asked) : undefined;
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
      return inputRequired({ inputRequests: { [approvalKey(question)]: unlockQuestion(question, caller.clientName) } });
    }

    return server.projectCallToolResult({
      content: [{ type: 'text', text: JSON.stringify(outcome.structuredContent) }],
      structuredContent: outcome.structuredContent,
      isError: outcome.isError,
    }, tool.outputSchema);
  });

  return server;
};

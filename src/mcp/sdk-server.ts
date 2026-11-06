import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, inputRequired, inputResponse, McpServer, ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';

import type { Tool } from '@modelcontextprotocol/server';
import type { AgentApprovalRequest } from '../../types/agent';

import { approvalKey } from '../shared/agent/approval';
import { approvalQuestion, canElicit, elicitationApprover } from '../shared/mcp/approval';

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
  });

  return server;
};

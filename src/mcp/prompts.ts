import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';

import type { GetPromptResult, Prompt } from '@modelcontextprotocol/server';

import { listMcpPrompts as listPrompts, mcpPromptResult } from '../shared/mcp/prompts';

export { MCP_SKILL_STEPS } from '../shared/mcp/prompts';

/** Every Ask AI skill as an MCP prompt, named by its id. */
export const listMcpPrompts = (): Prompt[] => listPrompts();

/** The messages for one skill, from the prompt arguments the client sent. */
export const getMcpPrompt = (name: string, args: Record<string, string> = {}): GetPromptResult => {
  const outcome = mcpPromptResult(name, args);

  if (!outcome.ok) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, outcome.message);
  }

  return outcome.result;
};

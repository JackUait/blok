import type { AgentContract } from '../../types/tool-manifest';
import { SHARED_RULES } from '../agent/guidance';

/** Rules only an MCP agent gets: it opens sub-pages itself. */
export const MCP_RULES: readonly string[] = [
  '- A page block\'s data.pageId is the id of its sub-page document; open it with blok_open to write inside it.',
];

/** The same rules the in-app assistant gets, minus the in-app-only ones. */
export const mcpInstructions = (contract: AgentContract): string => [
  'How to write rich text in Blok:',
  contract.guidance.general.trim(),
  '',
  'Rules for editing a Blok document:',
  ...SHARED_RULES,
  ...MCP_RULES,
].join('\n');

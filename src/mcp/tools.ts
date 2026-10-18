import type { AgentContract } from '../../types/tool-manifest';

import { renderAgentTools } from '../agent/render-tools';
import { orError } from '../agent/result-schemas';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export const CORE_TOOL_NAMES: readonly ['blok_read', 'blok_describe', 'blok_execute'] = [
  'blok_read', 'blok_describe', 'blok_execute',
];

export const LIFECYCLE_TOOL_NAMES: readonly ['blok_list_documents', 'blok_open', 'blok_close'] = [
  'blok_list_documents', 'blok_open', 'blok_close',
];

/** blok_read's input without the handle: what blok_open's view passes to the read. */
const readArguments = (core: McpTool[]): Record<string, unknown> => {
  const read = core.find(tool => tool.name === 'blok_read')?.inputSchema ?? {};
  const all: Record<string, unknown> = typeof read.properties === 'object' && read.properties !== null ? { ...read.properties } : {};
  const properties = Object.fromEntries(Object.entries(all).filter(([key]) => key !== 'handle'));
  const required: unknown[] = Array.isArray(read.required) ? read.required : [];

  return { ...read, properties, required: required.filter(key => key !== 'handle') };
};

export const listMcpTools = (
  contract: AgentContract,
  options: { schema: 'envelope' | 'full' | 'mixed'; handleIdleMs: number },
): McpTool[] => {
  const core = renderAgentTools(contract, { format: 'mcp', handle: true, schema: options.schema }) as McpTool[];
  const idleMinutes = options.handleIdleMs / 60_000;
  const idleDuration = Number.isInteger(idleMinutes)
    ? `${idleMinutes} minutes`
    : `${Math.round(options.handleIdleMs / 1000)} seconds`;

  return [
    {
      name: 'blok_list_documents',
      description: 'Lists Blok documents you may open. Returns supported: false when the document source cannot list.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', maxLength: 200 },
          cursor: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
      },
      outputSchema: orError({
        type: 'object',
        required: ['documents'],
        properties: {
          documents: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id'],
              properties: { id: { type: 'string' }, title: { type: ['string', 'null'] }, live: { type: 'boolean' } },
            },
          },
          nextCursor: { type: ['string', 'null'] },
          supported: { type: 'boolean' },
        },
      }),
    },
    {
      name: 'blok_open',
      description: [
        'Opens a Blok document and returns a handle for blok_read, blok_describe, blok_execute and blok_close.',
        'mode "auto" joins the live room when one is configured, else edits the stored document.',
        'Pass write: true if you will edit; a read-only handle refuses blok_execute.',
        'Pass view with blok_read arguments, e.g. view: {}, to get the document back in the same call.',
        `A handle expires after ${idleDuration} without a call; then open again.`,
        'Write rich text with commands such as text.format or markdown.insert. Never put Markdown or HTML into block data.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['documentId'],
        properties: {
          documentId: { type: 'string', minLength: 1, maxLength: 512 },
          mode: { enum: ['auto', 'live', 'stored'], default: 'auto' },
          write: { type: 'boolean', default: false },
          view: readArguments(core),
        },
      },
      outputSchema: orError({
        type: 'object',
        required: ['handle', 'mode', 'write', 'expiresAfterIdleMs'],
        properties: {
          handle: { type: 'string' },
          mode: { enum: ['live', 'stored'] },
          write: { type: 'boolean' },
          durability: { enum: ['acknowledged', 'best-effort', 'saved-on-execute'] },
          expiresAfterIdleMs: { type: 'integer' },
          contractRevision: { type: 'string' },
          view: { type: 'object' },
        },
      }),
    },
    {
      name: 'blok_close',
      description: 'Closes a handle: leaves the live room, or drops the stored session. Reports work the server had not acknowledged.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['handle'],
        properties: { handle: { type: 'string', 'x-mcp-header': 'Blok-Handle' } },
      },
      outputSchema: orError({
        type: 'object',
        required: ['closed', 'unsavedBatches'],
        properties: { closed: { type: 'boolean' }, unsavedBatches: { type: 'integer' }, hostRecordLags: { type: 'boolean' } },
      }),
    },
    ...core,
  ];
};

import type { AgentContract } from '../../types/tool-manifest';

import { pagesInsert } from '../agent/guidance';
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

const DOCUMENTS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' }, title: { type: ['string', 'null'] }, live: { type: 'boolean' } },
  },
};

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
      description: 'Lists Blok documents you may open. blok_open without documentId runs this listing itself, so you rarely need it. query matches part of document ids and titles, not their content; when nothing matches, it lists every document and sets queryMatched: false. Returns supported: false when the document source cannot list.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', maxLength: 200, description: 'Matches part of a document id or title. It does not search the text inside documents.' },
          cursor: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
      },
      outputSchema: orError({
        type: 'object',
        required: ['documents'],
        properties: {
          documents: DOCUMENTS_SCHEMA,
          nextCursor: { type: ['string', 'null'] },
          supported: { type: 'boolean' },
          queryMatched: { type: 'boolean' },
        },
      }),
    },
    {
      name: 'blok_open',
      description: [
        'Opens a Blok document and returns a handle for blok_read, blok_describe, blok_execute and blok_close.',
        'Called without documentId, it opens a document only when exactly one fits: with no query, the only document there is; with a query, the one document whose id or title equals query (case and outer spaces ignored).',
        'Then it returns that documentId and title. Otherwise it opens nothing and returns the documents to choose from, listed the way blok_list_documents lists them; open one by its documentId.',
        'In stored mode an unknown documentId opens a new, empty document (exists: false), so pass only ids you were given or saw listed.',
        "A page block's data.pageId is the documentId of that sub-page: open it to read or edit the sub-page. The block id is not.",
        ...(pagesInsert(contract) ? ['A page block you insert gets a new, empty sub-page document, under the pageId the insert result shows.'] : []),
        'mode "auto" joins the live room when one is configured, else edits the stored document.',
        'Pass write: true if you will edit; a read-only handle refuses blok_execute.',
        'unavailableCommands names the blok_execute commands this handle refuses, if any; do not send them.',
        'Pass view with blok_read arguments, e.g. view: {}, to get the document back in the same call.',
        `A handle expires after ${idleDuration} without a call; then open again.`,
        'Write rich text with commands such as text.format or markdown.insert. Never put Markdown or HTML into block data.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          documentId: { type: 'string', minLength: 1, maxLength: 512 },
          query: { type: 'string', maxLength: 200, description: 'Without documentId: the exact id or title of the document to open.' },
          mode: { enum: ['auto', 'live', 'stored'], default: 'auto' },
          write: { type: 'boolean', default: false },
          view: readArguments(core),
        },
      },
      outputSchema: orError({
        type: 'object',
        // Opened, or (without documentId) the documents to choose from.
        anyOf: [{ required: ['handle', 'mode', 'write', 'expiresAfterIdleMs'] }, { required: ['documents'] }],
        properties: {
          handle: { type: 'string' },
          documentId: { type: 'string' },
          title: { type: ['string', 'null'] },
          mode: { enum: ['live', 'stored'] },
          write: { type: 'boolean' },
          durability: { enum: ['acknowledged', 'best-effort', 'saved-on-execute'] },
          expiresAfterIdleMs: { type: 'integer' },
          contractRevision: { type: 'string' },
          exists: { type: 'boolean' },
          unavailableCommands: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'reason'],
              properties: { name: { type: 'string' }, reason: { enum: ['runtime', 'service'] } },
            },
          },
          view: { type: 'object' },
          documents: DOCUMENTS_SCHEMA,
          nextCursor: { type: ['string', 'null'] },
          supported: { type: 'boolean' },
          queryMatched: { type: 'boolean' },
        },
      }),
    },
    {
      name: 'blok_close',
      description: 'Closes a handle. In live mode it leaves the room and reports work the server had not acknowledged. In stored mode every blok_execute already saves, so closing is not needed to save; it only frees the handle.',
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

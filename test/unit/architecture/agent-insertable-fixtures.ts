import type { AgentSession } from '../../../types/agent';
import type { BlokCustomToolsFile } from '../../../types/tool-manifest';

/** A host tool with a prepareInsert hook, as a custom tools file declares it. */
export const PREPARED_CUSTOM_TOOLS: BlokCustomToolsFile = {
  formatVersion: 1,
  blocks: [{
    name: 'prepared',
    description: { summary: 'A block the host prepares.', data: { type: 'object' } },
    statics: {
      toolbox: [{ name: 'prepared', title: 'Prepared' }],
      richTextFields: [],
      acceptsChildren: false,
      ownsChildren: false,
      isLayout: false,
      deletesChildren: false,
      selfPlacesChildren: false,
      restrictedInTableCell: false,
      conversion: {},
      convertible: { import: false, export: false },
      hasPrepareInsert: true,
    },
  }],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The smallest valid data for types whose schema requires fields. */
const DATA: Record<string, Record<string, unknown>> = {
  image: { url: 'https://example.com/a.png' },
  file: { url: 'https://example.com/a.pdf' },
  audio: { url: 'https://example.com/a.mp3' },
  video: { url: 'https://example.com/a.mp4' },
  bookmark: { url: 'https://example.com/' },
  'page-link': { pageId: 'page-1' },
  'database-row': { properties: {}, position: 'a0' },
  'database-comment': { text: 'Note', createdAt: 1 },
};

/** Types whose valid data is easiest to take from their own create command. */
const HARVEST = new Set(['database', 'embed']);

const CREATE_ARGS: Record<string, Record<string, unknown>> = {
  database: {},
  table: { rows: 1, cols: 1 },
  embed: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
};

const created = async (session: AgentSession, type: string): Promise<Record<string, unknown>> => {
  const result = await session.execute({ commands: [{ name: `${type}.create`, args: { ...CREATE_ARGS[type], position: 'end' } }] });
  const data = result.ok ? result.blocks?.find(block => block.type === type)?.data : undefined;

  if (!isRecord(data)) {
    throw new Error(`${type}.create gave no data: ${JSON.stringify(result)}`);
  }

  return data;
};

/** 'ok' when block.insert makes the block, else the error code. */
export const insertOutcome = async (session: AgentSession, type: string): Promise<string> => {
  const data = HARVEST.has(type) ? await created(session, type) : DATA[type];
  const result = await session.execute({ commands: [{ name: 'block.insert', args: { type, ...(data === undefined ? {} : { data }), position: 'end' } }] });

  if (result.ok) {
    return 'ok';
  }
  // A table is born with its cells: block.insert points at table.create, which must then work.
  if (result.error.code === 'INVALID_ARGS' && result.error.details?.use === `${type}.create`) {
    await created(session, type);

    return 'ok';
  }

  return result.error.code;
};

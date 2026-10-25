// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { openJsonSession } from '../agent/harness';
import { createHeadlessAgentSetup } from '../../../src/view/agent-runtime';

import type { AgentBatch, AgentResult, AgentSession, OutputData } from '../../../types';

/**
 * ARCHITECTURE LAW — an agent never leaves a "fill me in" placeholder.
 *
 * The saved-data schemas only check shapes, so a blank required string passes. For a media or link
 * block that blank renders as the empty upload / "Paste a link" state, which is how the agent left an
 * empty embed in a finished article. Every built-in block tool is probed through the real planner:
 *
 * 1. A blank insert (required fields filled with '' / [] / {} from the schema) is refused, unless the
 *    tool is in BLANK_IS_CONTENT with a reason. A new tool fails here until someone decides.
 * 2. A tool with a source field (SOURCE_FIELD) refuses an update that blanks the source of a working
 *    block. Where only some URLs render (NON_HTTP_RENDERS_EMPTY), a non-http source is refused too.
 *    Elsewhere it is allowed: a host uploader may return a relative URL.
 * 3. Every refused source tool still has a legal one-step creation path: `<tool>.create`, or a direct
 *    insert of a working example. Refusing without one leaves the agent no way to make the block.
 *
 * The editor runs the same checks only if its runtimes carry them: see
 * agent-runtime-parts-editor-parity-law.test.ts.
 */

const BLANK_IS_CONTENT: Record<string, string> = {
  paragraph: 'An empty line is real content.',
  header: 'An empty heading shows its placeholder while the person types into it.',
  list: 'An empty item is real content.',
  toggle: 'An empty toggle title is real content.',
  quote: 'An empty quote is real content.',
  code: 'An empty code block is real content.',
  callout: 'The body lives in child blocks; a blank emoji means no icon.',
  divider: 'Has no fields.',
  spacer: 'Has no fields.',
  table_of_contents: 'Reads sibling headings; has nothing to fill.',
  column_list: 'Columns are seeded as child blocks.',
  column: 'Its content is child blocks.',
  tabs: 'Tabs are seeded as child blocks.',
  tab: 'An untitled tab is a real tab.',
  'database-row': 'A row with no values is a real row.',
};

/** The field whose blank or bad value renders the placeholder. */
const SOURCE_FIELD: Record<string, string> = {
  embed: 'source',
  image: 'url',
  video: 'url',
  audio: 'url',
  file: 'url',
  bookmark: 'url',
};

const NON_HTTP_RENDERS_EMPTY: Record<string, string> = {
  embed: 'Only a URL the provider registry matches plays; anything else is the empty state.',
};

const WORKING: Record<string, Record<string, unknown>> = {
  embed: { service: 'youtube', source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
  image: { url: 'https://example.com/a.png' },
  video: { url: 'https://example.com/a.mp4' },
  audio: { url: 'https://example.com/a.mp3' },
  file: { url: 'https://example.com/a.pdf' },
  bookmark: { url: 'https://example.com/' },
};

type Schema = { properties?: Record<string, Record<string, unknown>>; required?: string[] };

const blankValue = (field: Record<string, unknown>): unknown => {
  const type = Array.isArray(field.type) ? field.type[0] : field.type;

  if (Array.isArray(field.enum)) {
    return field.enum[0];
  }
  switch (type) {
    case 'number':
    case 'integer':
      return typeof field.minimum === 'number' ? field.minimum : 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return '';
  }
};

const blankData = (schema: Schema): Record<string, unknown> =>
  Object.fromEntries((schema.required ?? []).map(field => [field, blankValue(schema.properties?.[field] ?? {})]));

const contract = createHeadlessAgentSetup({ runtime: 'node' }).contract;
const blocks = contract.manifest.blocks;
const commands = new Set(contract.commands.map(command => command.name));

const run = async (seed: OutputData, name: string, args: Record<string, unknown>): Promise<AgentResult> => {
  const session: AgentSession = openJsonSession(seed);

  try {
    return await session.execute({ commands: [{ name, args }] } as AgentBatch);
  } finally {
    await session.close();
  }
};

const insert = (type: string, data: Record<string, unknown>): Promise<AgentResult> =>
  run({ blocks: [] }, 'block.insert', { type, data });

describe('agent blank placeholder law', () => {
  it('refuses a blank insert of every tool that is not listed as blank-is-content', async () => {
    const accepted: string[] = [];

    for (const block of blocks) {
      if ((await insert(block.name, blankData(block.data))).ok && !Object.hasOwn(BLANK_IS_CONTENT, block.name)) {
        accepted.push(block.name);
      }
    }

    expect(accepted, 'These tools accept blank data from the agent. Refuse it with a runtime rejectWrite, or add the tool to BLANK_IS_CONTENT with a reason.').toEqual([]);
  });

  it('keeps BLANK_IS_CONTENT free of tools that no longer exist or already refuse blank data', async () => {
    const names = new Set(blocks.map(block => block.name));
    const stale: string[] = [];

    for (const name of Object.keys(BLANK_IS_CONTENT)) {
      const block = blocks.find(candidate => candidate.name === name);

      if (!names.has(name) || block === undefined || !(await insert(name, blankData(block.data))).ok) {
        stale.push(name);
      }
    }

    expect(stale).toEqual([]);
  });

  it.each(Object.keys(NON_HTTP_RENDERS_EMPTY))('%s refuses a non-http source on insert', async (tool) => {
    const result = await insert(tool, { ...WORKING[tool], [SOURCE_FIELD[tool]]: 'not a url' });

    expect(result.ok).toBe(false);
  });

  it.each(Object.entries(SOURCE_FIELD))('%s refuses an update that blanks the source of a working block', async (tool, field) => {
    const result = await run({ blocks: [{ id: 'b', type: tool, data: { ...WORKING[tool] } }] }, 'block.update', { id: 'b', data: { [field]: '' } });

    expect(result.ok).toBe(false);
  });

  it.each(Object.keys(SOURCE_FIELD))('%s can still be made in one step', async (tool) => {
    const direct = await insert(tool, { ...WORKING[tool] });

    expect(commands.has(`${tool}.create`) || direct.ok, `${tool} needs ${tool}.create or a working direct insert`).toBe(true);
  });
});

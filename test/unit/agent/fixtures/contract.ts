import type { AgentContract, CommandEntry } from '../../../../types/tool-manifest';

type Schema = Record<string, unknown>;

export const command = (
  name: CommandEntry['name'],
  args: Schema,
  extra: Partial<CommandEntry> = {}
): CommandEntry => ({
  name,
  summary: `${name} summary`,
  args,
  readOnly: false,
  runtime: 'any',
  source: 'core',
  available: true,
  ...extra,
});

const insertArgs: Schema = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    children: { type: 'array', items: { $ref: '#/$defs/InsertSpec' } },
  },
  required: ['type'],
  $defs: {
    InsertSpec: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        children: { type: 'array', items: { $ref: '#/$defs/InsertSpec' } },
      },
      required: ['type'],
    },
  },
};

export const FIXTURE_COMMANDS: CommandEntry[] = [
  command('block.insert', insertArgs),
  command('doc.read', {
    type: 'object',
    properties: { depth: { type: 'integer' } },
    additionalProperties: false,
  }, {
    readOnly: true,
    result: {
      type: 'object',
      properties: { blocks: { type: 'array' } },
      required: ['blocks'],
    },
  }),
  command('page.rename', {
    type: 'object',
    properties: { title: { type: 'string' } },
  }, {
    source: { tool: 'page', target: 'block' },
    available: false,
    unavailableReason: 'service',
    requires: ['pageBackend'],
  }),
  command('poll.addOption', {
    type: 'object',
    properties: { label: { type: 'string' } },
    required: ['label'],
  }, { source: { tool: 'poll', target: 'block' } }),
  command('table.insertRows', {
    type: 'object',
    properties: { at: { type: 'integer' }, count: { type: 'integer' } },
  }, { source: { tool: 'table', target: 'block' } }),
];

export const makeContract = (commands: CommandEntry[] = FIXTURE_COMMANDS): AgentContract => ({
  formatVersion: 1,
  revision: 'rev-1',
  commands,
  manifest: {
    formatVersion: 1,
    blokVersion: 'test',
    revision: 'manifest-1',
    readOnly: false,
    defaultBlock: 'paragraph',
    blocks: [],
    inlineTools: [],
    tunes: [],
  },
  guidance: { general: 'General guidance.', commands: {}, tools: {} },
});

export const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((child: unknown) => {
      deepFreeze(child);
    });
  }

  return value;
};

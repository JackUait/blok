import { COMMANDS } from '../../../../src/shared/agent/commands';

import type { JsonSchema, PlannerCommand, PlannerTool } from '../../../../src/shared/agent/types';

export const coreCommandMap = (
  unavailable: Record<string, 'runtime' | 'service'> = {}
): Map<string, PlannerCommand> => new Map(
  Object.entries(COMMANDS).map(([name, spec]): [string, PlannerCommand] => {
    const reason = unavailable[name];

    return [name, {
      name,
      args: spec.argsSchema,
      readOnly: spec.readOnly,
      available: reason === undefined,
      ...(reason === undefined ? {} : { unavailableReason: reason }),
      source: 'core',
    }];
  })
);

const rich: JsonSchema = { type: 'array' };

export const tool = (
  name: string,
  over: Partial<PlannerTool['entry']> = {},
  runtime: Partial<PlannerTool['runtime']> = {}
): PlannerTool => ({
  entry: {
    name,
    richTextFields: [],
    viewState: [],
    guardedFields: {},
    children: { accepts: true, ownedByTool: false, layout: false, deletedWithParent: false },
    selfPlacesChildren: false,
    restrictedInTableCell: false,
    conversion: {},
    data: { type: 'object' },
    ...over,
  },
  runtime: { actions: {}, ...runtime },
});

export const TOOLS: Map<string, PlannerTool> = new Map([
  ['paragraph', tool('paragraph', {
    richTextFields: ['text'],
    conversion: { import: 'text', export: 'text' },
    data: { type: 'object', properties: { text: rich }, additionalProperties: false },
  })],
  ['header', tool('header', {
    richTextFields: ['text'],
    summaryFields: ['level'],
    restrictedInTableCell: true,
    conversion: { import: 'text', export: 'text' },
    data: {
      type: 'object',
      properties: { text: rich, level: { type: 'integer', minimum: 1, maximum: 6 } },
      additionalProperties: false,
    },
  })],
  ['toggle', tool('toggle', {
    richTextFields: ['text'],
    children: { accepts: true, deny: ['table'], ownedByTool: false, layout: false, deletedWithParent: false },
    conversion: { import: 'text', export: 'text' },
    data: { type: 'object', properties: { text: rich } },
  })],
  ['divider', tool('divider', {
    children: { accepts: false, ownedByTool: false, layout: false, deletedWithParent: false },
  })],
  ['table', tool('table', {
    selfPlacesChildren: true,
    restrictedInTableCell: true,
    guardedFields: { content: 'table.*' },
    children: { accepts: true, ownedByTool: true, layout: false, deletedWithParent: true },
    data: { type: 'object' },
  })],
  ['column_list', tool('column_list', {
    restrictedInTableCell: true,
    children: { accepts: true, allow: ['column'], ownedByTool: true, layout: true, deletedWithParent: true },
  }, { defaultChildren: [{ type: 'column' }, { type: 'column' }] })],
  ['column', tool('column', {
    children: { accepts: true, ownedByTool: false, layout: true, deletedWithParent: true },
  })],
  ['image', tool('image', {
    viewState: ['zoom'],
    data: { type: 'object', properties: { url: { type: 'string' }, zoom: { type: 'number' } } },
  })],
]);

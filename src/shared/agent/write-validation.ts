import { failure } from './errors';
import { applyEdits } from './json-applier';
import { PREPARE_PENDING } from './plan-state';
import { fieldRules } from './variant-hint';

import type { PlannedBlock } from '../../../types/agent';
import type { PlanState } from './plan-state';
import type { DocSnapshot } from './snapshot';
import type { JsonSchema } from './types';

const fieldList = (tool: string, schema: JsonSchema): string => {
  const properties = schema.properties;

  if (typeof properties !== 'object' || properties === null) {
    return '';
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  const fields = Object.keys(properties).map(field => required.includes(field) ? `${field} (required)` : field);

  return fields.length === 0 ? '' : ` "${tool}" takes: ${fields.join(', ')}.`;
};

const check = (
  state: PlanState,
  commandIndex: number,
  block: { id: string; type: string },
  data: unknown,
  options: { partial?: boolean; converted?: boolean } = {}
): void => {
  const full = state.tool(block.type)?.entry.data;

  if (full === undefined) {
    return;
  }
  const problems = state.ctx.validate(options.partial === true ? fieldRules(full) : full, data);
  const first = problems[0];

  if (first !== undefined) {
    const carried = options.converted === true ? ' block.convert carries the text over: data only needs the fields that change.' : '';

    // fieldList names the same fields with the required ones marked, so drop the validator's plain list.
    const message = first.message.replace(/; accepted fields: .*$/, '');

    throw failure('DATA_REJECTED', `Block "${block.id}": ${message}.${fieldList(block.type, full)}${carried} Full schema: describe({ tool: "${block.type}" }).`, {
      commandIndex, path: `/commands/${commandIndex}`, details: { blockId: block.id, problems },
    });
  }
};

const checkKeys = (
  state: PlanState,
  commandIndex: number,
  id: string,
  type: string | undefined,
  patch: Record<string, unknown>
): void => {
  const written = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null));

  if (type === undefined || Object.keys(written).length === 0) {
    return;
  }
  check(state, commandIndex, { id, type }, written, { partial: true });
};

const checkTree = (state: PlanState, commandIndex: number, block: PlannedBlock): void => {
  check(state, commandIndex, block, block.data);
  block.children.forEach(child => checkTree(state, commandIndex, child));
};

export const validateWrites = (state: PlanState, snapshot: DocSnapshot): void => {
  // Pending insert data can flow into later copies.
  for (const prepared of state.ctx.prepared.values()) {
    if (prepared === PREPARE_PENDING) {
      return;
    }
  }
  const replay = snapshot.clone();

  for (const [index, edit] of state.edits.entries()) {
    const commandIndex = state.editCommand[index];

    if (commandIndex === undefined) {
      throw new Error('Planned edit has no command index.');
    }
    switch (edit.op) {
      case 'insert':
        checkTree(state, commandIndex, edit.block);
        break;
      case 'replaceType':
        check(state, commandIndex, { id: edit.id, type: edit.type }, edit.data, { converted: true });
        break;
      case 'setData':
      case 'setRichText': {
        const block = replay.get(edit.id);
        const patch = edit.op === 'setData' ? edit.patch : { [edit.field]: edit.value };

        checkKeys(state, commandIndex, edit.id, block?.type, patch);
        break;
      }
      case 'move':
      case 'remove':
      case 'setPageField':
      case 'setTunes':
        break;
    }
    applyEdits(replay, [edit], null);
  }
};

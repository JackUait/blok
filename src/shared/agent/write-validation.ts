import { failure } from './errors';
import { applyEdits } from './json-applier';
import { PREPARE_PENDING } from './plan-state';

import type { PlannedBlock } from '../../../types/agent';
import type { PlanState } from './plan-state';
import type { DocSnapshot } from './snapshot';
import type { JsonSchema } from './types';

const check = (
  state: PlanState,
  commandIndex: number,
  blockId: string,
  schema: JsonSchema | undefined,
  data: unknown
): void => {
  if (schema === undefined) {
    return;
  }
  const problems = state.ctx.validate(schema, data);
  const first = problems[0];

  if (first !== undefined) {
    throw failure('DATA_REJECTED', `Block "${blockId}": ${first.message}. Read the tool's data schema with describe({ tool }).`, {
      commandIndex, path: `/commands/${commandIndex}`, details: { blockId, problems },
    });
  }
};

const checkKeys = (
  state: PlanState,
  commandIndex: number,
  blockId: string,
  schema: JsonSchema | undefined,
  patch: Record<string, unknown>
): void => {
  if (schema === undefined) {
    return;
  }
  const written = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null));

  if (Object.keys(written).length === 0) {
    return;
  }
  // Root cross-field rules do not apply to partial writes.
  const scoped = Object.fromEntries(Object.entries(schema).filter(([key]) =>
    key === 'properties' || key === 'patternProperties' || key === 'additionalProperties'));

  check(state, commandIndex, blockId, scoped, written);
};

const checkTree = (state: PlanState, commandIndex: number, block: PlannedBlock): void => {
  check(state, commandIndex, block.id, state.tool(block.type)?.entry.data, block.data);
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
        check(state, commandIndex, edit.id, state.tool(edit.type)?.entry.data, edit.data);
        break;
      case 'setData':
      case 'setRichText': {
        const block = replay.get(edit.id);
        const schema = block === undefined ? undefined : state.tool(block.type)?.entry.data;
        const patch = edit.op === 'setData' ? edit.patch : { [edit.field]: edit.value };

        checkKeys(state, commandIndex, edit.id, schema, patch);
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

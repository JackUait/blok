import { AgentFailure, failure, problemOf } from './errors';
import { applyEdits } from './json-applier';
import { mediaProblems } from './media-gate';
import { PREPARE_PENDING } from './plan-state';
import { fieldRules } from './variant-hint';

import type { AgentError, PlannedBlock } from '../../../types/agent';
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

/**
 * The DATA_REJECTED error for data the tool schema refuses, or undefined. `subject` names the block,
 * e.g. `Block "id"`.
 */
export const dataProblem = (
  state: PlanState,
  commandIndex: number,
  block: { subject: string; type: string; blockId?: string; path?: string },
  data: unknown,
  options: { partial?: boolean; converted?: boolean } = {}
): AgentError | undefined => {
  const full = state.tool(block.type)?.entry.data;

  if (full === undefined) {
    return undefined;
  }
  const problems = state.ctx.validate(options.partial === true ? fieldRules(full) : full, data);
  const first = problems[0];

  if (first === undefined) {
    return undefined;
  }
  const carried = options.converted === true ? ' block.convert carries the text over: data only needs the fields that change.' : '';

  // fieldList names the same fields with the required ones marked, so drop the validator's plain list.
  const message = first.message.replace(/; accepted fields: .*$/, '');

  return failure('DATA_REJECTED', `${block.subject}: ${message}.${fieldList(block.type, full)}${carried} Full schema: describe({ tool: "${block.type}" }).`, {
    commandIndex, path: block.path ?? `/commands/${commandIndex}`,
    details: { ...(block.blockId !== undefined && { blockId: block.blockId }), problems },
  }).error;
};

const check = (
  state: PlanState,
  commandIndex: number,
  block: { id: string; type: string },
  data: unknown,
  options: { partial?: boolean; converted?: boolean } = {}
): AgentError | undefined =>
  dataProblem(state, commandIndex, { subject: `Block "${block.id}"`, type: block.type, blockId: block.id }, data, options);

const checkKeys = (
  state: PlanState,
  commandIndex: number,
  id: string,
  type: string | undefined,
  patch: Record<string, unknown>
): AgentError | undefined => {
  const written = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null));

  if (type === undefined || Object.keys(written).length === 0) {
    return undefined;
  }

  return check(state, commandIndex, { id, type }, written, { partial: true });
};

const checkTree = (state: PlanState, commandIndex: number, block: PlannedBlock): AgentError[] => [
  check(state, commandIndex, block, block.data),
  ...block.children.flatMap(child => checkTree(state, commandIndex, child)),
].filter((problem): problem is AgentError => problem !== undefined);

export const validateWrites = (state: PlanState, snapshot: DocSnapshot): void => {
  // Pending insert data can flow into later copies.
  for (const prepared of state.ctx.prepared.values()) {
    if (prepared === PREPARE_PENDING) {
      return;
    }
  }
  const replay = snapshot.clone();
  // Every rejected write, so one failed batch names them all.
  const rejected: AgentError[] = [];
  const add = (problem: AgentError | undefined): void => {
    if (problem !== undefined) {
      rejected.push(problem);
    }
  };

  for (const [index, edit] of state.edits.entries()) {
    const commandIndex = state.editCommand[index];

    if (commandIndex === undefined) {
      throw new Error('Planned edit has no command index.');
    }
    switch (edit.op) {
      case 'insert':
        checkTree(state, commandIndex, edit.block).forEach(add);
        break;
      case 'replaceType':
        add(check(state, commandIndex, { id: edit.id, type: edit.type }, edit.data, { converted: true }));
        break;
      case 'setData':
      case 'setRichText': {
        const block = replay.get(edit.id);
        const patch = edit.op === 'setData' ? edit.patch : { [edit.field]: edit.value };
        add(checkKeys(state, commandIndex, edit.id, block?.type, patch));
        break;
      }
      case 'move':
      case 'remove':
      case 'setPageField':
      case 'setTunes':
        break;
    }
    mediaProblems(state.ctx.ports.media, edit, commandIndex, id => replay.get(id)?.type).forEach(add);
    applyEdits(replay, [edit], null);
  }

  const [first, ...rest] = rejected;

  if (first !== undefined) {
    throw new AgentFailure(rest.length === 0 ? first : { ...first, others: rest.map(problemOf) });
  }
};

import { checkChildType, satisfiesChildTools } from './placement-rules';
import { PREPARE_PENDING } from './plan-state';

import type { AgentBatch, InsertSpec, PlannedBlock } from '../../../types/agent';
import type { Refusal } from './placement-rules';
import type { PlanState } from './plan-state';
import type { JsonSchema } from './types';

type Parent = { id: string | null } | { type: string; inCell: boolean };
type ReservedLocation = { type: string; inCell: boolean; parent: Parent };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
const SPEC_KEYS = new Set(['type', 'data', 'tunes', 'id', 'children']);

// Children are checked node by node; the schema profile does not resolve $ref.
const INSERT_NODE: JsonSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', minLength: 1 },
    data: { type: 'object' },
    tunes: { type: 'object' },
    id: { type: 'string', minLength: 1 },
    children: { type: 'array' },
  },
  required: ['type'],
  additionalProperties: false,
};

const readInsertSpec = (state: PlanState, value: unknown, path: string): InsertSpec => {
  if (!isRecord(value)) {
    state.fail('INVALID_ARGS', 'Expected a block specification.', path);
  }
  if (typeof value.type !== 'string' || value.type === '') {
    state.fail('INVALID_ARGS', 'Expected a non-empty block type.', `${path}/type`);
  }

  const problem = state.ctx.validate(INSERT_NODE, value)[0];

  if (problem !== undefined) {
    state.fail('INVALID_ARGS', problem.message, `${path}${problem.path}`);
  }

  const data = value.data;
  const tunes = value.tunes;
  const id = value.id;
  const children = value.children;

  if (data !== undefined && !isRecord(data)) {
    state.fail('INVALID_ARGS', 'Block data must be a record.', `${path}/data`);
  }
  if (tunes !== undefined && !isRecord(tunes)) {
    state.fail('INVALID_ARGS', 'Block tunes must be a record.', `${path}/tunes`);
  }
  if (id !== undefined && (typeof id !== 'string' || id === '')) {
    state.fail('INVALID_ARGS', 'Expected a non-empty block ID.', `${path}/id`);
  }
  if (children !== undefined && !isArray(children)) {
    state.fail('INVALID_ARGS', 'Block children must be an array.', `${path}/children`);
  }

  return {
    type: value.type,
    ...(data !== undefined && { data }),
    ...(tunes !== undefined && { tunes }),
    ...(id !== undefined && { id }),
    ...(children !== undefined && { children: children.map((child, index) =>
      readInsertSpec(state, child, `${path}/children/${index}`)) }),
  };
};

const childRefusal = (state: PlanState, parent: Parent, type: string): Refusal | null => {
  if ('id' in parent) {
    return checkChildType(state.tree(), parent.id, type);
  }

  const facts = state.tool(parent.type)?.entry.children;

  if (facts !== undefined && !facts.accepts) {
    return { reason: 'TAKES_NO_CHILDREN', message: `"${parent.type}" takes no children` };
  }
  if (facts !== undefined && !satisfiesChildTools(facts.allow, facts.deny, type)) {
    return {
      reason: 'CHILD_NOT_ALLOWED',
      message: `"${parent.type}" does not allow "${type}" children`,
      ...(facts.allow !== undefined && facts.allow.length > 0 && { allowed: [...facts.allow] }),
    };
  }
  if (parent.inCell && state.tool(type)?.entry.restrictedInTableCell === true) {
    return { reason: 'RESTRICTED_IN_CELL', message: `"${type}" is not allowed inside a table cell` };
  }

  return null;
};

const selectChildType = (state: PlanState, parent: Parent, type: string, demote: boolean): string | Refusal => {
  const refusal = childRefusal(state, parent, type);

  if (refusal === null) {
    return type;
  }
  if (refusal.reason !== 'CHILD_NOT_ALLOWED' || !demote) {
    return refusal;
  }

  const fallback = refusal.allowed?.[0] ?? state.ctx.defaultBlock;

  return childRefusal(state, parent, fallback) ?? fallback;
};

const parentTypeOf = (state: PlanState, parent: Parent): string | undefined => {
  if ('type' in parent) {
    return parent.type;
  }

  return parent.id === null ? undefined : state.draft.get(parent.id)?.type;
};

const refusePlacement = (state: PlanState, refusal: Refusal, path: string): never => {
  const childHint = refusal.allowed === undefined
    ? ' Insert it next to the container instead, or pass demote: true.'
    : ` Allowed: ${refusal.allowed.join(', ')}. Or pass demote: true.`;
  const hint = refusal.reason === 'CHILD_NOT_ALLOWED' ? childHint : '';

  return state.fail('PLACEMENT_REFUSED', `${refusal.message}.${hint}`, `${path}/type`, {
    reason: refusal.reason,
    ...(refusal.allowed !== undefined && { allowed: refusal.allowed }),
  });
};

const reserveBlockIds = (
  state: PlanState,
  spec: unknown,
  parent: Parent,
  path: string,
  demote: boolean,
  coreInsert: boolean,
  locations?: Map<string, ReservedLocation>
): ReservedLocation | undefined => {
  if (!isRecord(spec) || typeof spec.type !== 'string') {
    return undefined;
  }

  const parentType = parentTypeOf(state, parent);

  if (coreInsert && parentType !== undefined && state.tool(parentType)?.entry.selfPlacesChildren === true) {
    return undefined;
  }

  const type = selectChildType(state, parent, spec.type, demote);
  const tool = typeof type === 'string' ? state.tool(type) : undefined;

  if (typeof type !== 'string' || tool === undefined) {
    return undefined;
  }

  const inCell = 'type' in parent ? parent.inCell : parent.id !== null && state.draft.cellOf(parent.id) !== null;
  const location = { type, inCell, parent };

  if (typeof spec.id === 'string' && spec.id !== '') {
    state.reserveId(spec.id, `${path}/id`);
    locations?.set(spec.id, location);
  }

  const children = spec.children === undefined ? tool.runtime.defaultChildren ?? [] : spec.children;

  if (isArray(children)) {
    children.forEach((child, index) =>
      reserveBlockIds(state, child, location, `${path}/children/${index}`, demote, coreInsert, locations));
  }

  return location;
};

export const reserveBatchInsertIds = (state: PlanState, batch: AgentBatch): void => {
  const locations = new Map<string, ReservedLocation>();
  // These refs carry placement facts, not usable block IDs.
  const refs = new Map<string, ReservedLocation>();
  const locate = (value: unknown): ReservedLocation | undefined => {
    if (typeof value !== 'string') {
      return undefined;
    }
    if (value.startsWith('$')) {
      return refs.get(value.slice(1));
    }

    const reserved = locations.get(value);
    const block = state.draft.get(value);

    return reserved ?? (block === undefined ? undefined : {
      type: block.type, inCell: state.draft.cellOf(value) !== null, parent: { id: block.parent },
    });
  };
  const parentOfInsert = (args: Record<string, unknown>): Parent | undefined => {
    if (args.parentId !== undefined && args.parentId !== null) {
      return locate(args.parentId);
    }
    if (args.parentId === null) {
      return { id: null };
    }
    if (isRecord(args.position)) {
      const key = 'before' in args.position ? 'before' : 'after';

      return locate(args.position[key])?.parent;
    }

    return { id: null };
  };

  batch.commands.forEach((command, index) => {
    state.setCommandIndex(index);
    if (command.name !== 'block.insert') {
      return;
    }

    const parent = parentOfInsert(command.args);

    if (parent === undefined) {
      return;
    }

    const location = reserveBlockIds(state, command.args, parent, '', command.args.demote === true, true, locations);

    if (command.ref !== undefined && location !== undefined) {
      refs.set(command.ref, location);
    }
  });
};

const buildBlock = (
  state: PlanState,
  spec: InsertSpec,
  parent: Parent,
  path: string,
  demote: boolean,
  coreInsert: boolean,
  pending: boolean,
  extra?: Record<string, unknown>
): PlannedBlock => {
  const parentType = parentTypeOf(state, parent);

  if (coreInsert && parentType !== undefined && state.tool(parentType)?.entry.selfPlacesChildren === true) {
    const actions = state.actionsOf(parentType);

    state.fail('PLACEMENT_REFUSED', `"${parentType}" places its own children. Use one of: ${actions.join(', ')}.`, 'id' in parent ? '/parentId' : path, {
      reason: 'SELF_PLACED_PARENT', use: actions,
    });
  }

  const type = selectChildType(state, parent, spec.type, demote);

  if (typeof type !== 'string') {
    return refusePlacement(state, type, path);
  }

  const tool = state.tool(type);

  if (tool === undefined) {
    state.fail('UNKNOWN_TOOL', `No block tool "${type}" is registered. Known: ${[...state.ctx.tools.keys()].join(', ')}.`, `${path}/type`, {
      known: [...state.ctx.tools.keys()],
    });
  }

  const id = state.newBlockId(spec.id, `${path}/id`);
  const data = state.prepareData(type, { ...(spec.data ?? tool.entry.defaultData ?? {}), ...(extra ?? {}) }, `${path}/data`, id, { normalize: !pending });
  const inCell = 'type' in parent ? parent.inCell : parent.id !== null && state.draft.cellOf(parent.id) !== null;
  const childSpecs = spec.children ?? (tool.runtime.defaultChildren ?? []).map((child, index) =>
    readInsertSpec(state, child, `${path}/children/${index}`));
  const children = childSpecs.map((child, index) =>
    buildBlock(state, child, { type, inCell }, `${path}/children/${index}`, demote, coreInsert, pending));

  if (type !== spec.type) {
    state.warn('DEMOTED', `"${spec.type}" is not allowed here and was inserted as "${type}".`);
  }

  return { id, type, data, ...(spec.tunes !== undefined && { tunes: structuredClone(spec.tunes) }), children };
};

export const buildPlannedBlock = (
  state: PlanState,
  spec: InsertSpec,
  parent: Parent,
  path: string,
  demote: boolean,
  extra?: Record<string, unknown>
): PlannedBlock => {
  const parsed = readInsertSpec(state, spec, path);

  reserveBlockIds(state, parsed, parent, path, demote, false);

  return buildBlock(state, parsed, parent, path, demote, false, state.ctx.prepared.get(state.index) === PREPARE_PENDING, extra);
};

export const planInsert = (state: PlanState, args: Record<string, unknown>): unknown => {
  const placement = state.place(args.parentId, args.position ?? 'end');
  const spec = readInsertSpec(state, Object.fromEntries(Object.entries(args).filter(([key]) => SPEC_KEYS.has(key))), '');
  const target = state.tool(spec.type);

  if (target?.entry.children.ownedByTool === true && target.runtime.defaultChildren === undefined && state.ctx.commands.has(`${spec.type}.create`)) {
    state.fail('INVALID_ARGS', `Create a ${spec.type} with ${spec.type}.create; block.insert cannot place its children.`, '/type', {
      use: `${spec.type}.create`,
    });
  }

  const prepared = state.ctx.prepared.get(state.index);
  const pending = prepared === PREPARE_PENDING;

  if (prepared !== undefined && !pending && !isRecord(prepared)) {
    state.fail('INVALID_ARGS', 'Prepared insert data must be a record.', '/data');
  }

  reserveBlockIds(state, spec, { id: placement.parentId }, '', args.demote === true, true);

  const planned = buildBlock(state, spec, { id: placement.parentId }, '', args.demote === true, true, pending, isRecord(prepared) ? prepared : undefined);

  state.emit({ op: 'insert', block: planned, parentId: placement.parentId, afterId: placement.afterId });

  return { id: planned.id, childIds: planned.children.map(child => child.id) };
};

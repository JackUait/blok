import { isRichText } from '../rich-text/guards';
import { cleanupEmptiedColumnList } from '../tool-actions/columns';
import { carriedBlockColors } from '../turn-into';
import { convertMissing, convertShape, emitAfterSwap, emitBeforeSwap } from './plan-convert';
import { checkChildType, checkMove, satisfiesChildTools } from './placement-rules';
import { PREPARE_PENDING } from './plan-state';
import { createActionContext } from './tool-action-context';
import { matchVariants, titleSentence, variantSentence } from './variant-hint';
import { cloneRecord } from './snapshot';
import { notPreparedHere } from './errors';

import type { AgentBatch, Edit, InsertSpec, PlannedBlock } from '../../../types/agent';
import type { Refusal } from './placement-rules';
import type { PlanState } from './plan-state';
import type { SnapBlock } from './snapshot';
import type { JsonSchema, PlannerTool } from './types';

type Parent = { id: string | null } | { type: string; inCell: boolean; actionScoped?: boolean };
type ReservedLocation = { type: string; inCell: boolean; parent: Parent };
interface ActionInsertOptions {
  allowSelfPlaced?: boolean;
  tool: string;
  isScopedContainer(id: string): boolean;
}

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
      const ref = value.slice(1);

      // Mirrors PlanState.isBlockNotRef.
      return refs.get(ref) ?? (state.batchRefs.has(ref) || !state.batchIds.has(ref) ? undefined : locate(ref));
    }

    const reserved = locations.get(value);
    const block = state.draft.get(value);

    const location = reserved ?? (block === undefined ? undefined : {
      type: block.type, inCell: state.draft.cellOf(value) !== null, parent: { id: block.parent },
    });

    if (location !== undefined) {
      locations.set(value, location);
    }

    return location;
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
    if (command.name === 'block.move') {
      const location = locate(command.args.id);
      const parent = parentOfInsert(command.args);

      if (location !== undefined && parent !== undefined) {
        location.parent = parent;
        location.inCell = 'type' in parent ? parent.inCell : parent.id !== null && state.draft.cellOf(parent.id) !== null;
      }

      return;
    }
    if (command.name === 'block.convert') {
      const location = locate(command.args.id);
      const type = command.args.type;

      if (location !== undefined && typeof type === 'string' && state.tool(type) !== undefined) {
        location.type = type;
      }

      return;
    }
    if (command.name === 'block.duplicate' && command.ref !== undefined) {
      const source = locate(command.args.id);
      const parent = parentOfInsert({ position: command.args.position ?? { after: command.args.id } });

      if (source === undefined || parent === undefined) {
        return;
      }

      // A duplicate must not reserve runtime default children.
      const location = reserveBlockIds(state, { type: source.type, children: [] }, parent, '', false, true);

      if (location !== undefined) {
        refs.set(command.ref, location);
      }

      return;
    }
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

/** The spec's data plus each required field it left out that the tool lists in fillMissing, from defaultData. */
export const withRequiredDefaults = (
  tool: PlannerTool,
  data: Record<string, unknown>,
  onFill: (field: string, value: unknown) => void = () => undefined
): Record<string, unknown> => {
  const defaults = tool.entry.defaultData ?? {};
  const required = isArray(tool.entry.data.required) ? tool.entry.data.required : [];
  // Opt-in per field: some defaults change meaning (a heading level, a list style).
  const filled = (tool.entry.fillMissing ?? []).filter(field => required.includes(field)
    && !Object.hasOwn(data, field) && Object.hasOwn(defaults, field));

  filled.forEach(field => onFill(field, defaults[field]));

  return filled.length === 0 ? data : { ...Object.fromEntries(filled.map(field => [field, defaults[field]])), ...data };
};

const refuseInsert = (state: PlanState, entry: PlannerTool['entry'], path: string): never => {
  if (entry.insertUnavailableReason === 'runtime') {
    return state.fail('COMMAND_UNAVAILABLE', notPreparedHere(entry.name), path, { reason: 'runtime' });
  }

  return state.fail('COMMAND_UNAVAILABLE', `"${entry.name}" is not insertable: ${entry.children.annotation === true
    ? 'people write it in the editor' : 'the host hides it from the toolbox'}.`, path, { reason: 'not-insertable' });
};

export const failUnknownTool = (state: PlanState, type: string, path: string): never => {
  const known = [...state.ctx.tools.keys()];
  const entries = [...state.ctx.tools.values()].map(tool => tool.entry);
  const variants = matchVariants(type, entries, state.ctx.validate);
  const hint = variantSentence(type, variants) || titleSentence(type, entries);

  return state.fail('UNKNOWN_TOOL', `No block tool "${type}" is registered.${hint} Known: ${known.join(', ')}.`, path, {
    known, ...(variants.length > 0 && { variants }),
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
  extra?: Record<string, unknown>,
  options?: ActionInsertOptions
): PlannedBlock => {
  const parentType = parentTypeOf(state, parent);
  const scopedParent = options !== undefined && ('id' in parent
    ? parent.id !== null && options.isScopedContainer(parent.id)
    : parent.actionScoped === true);

  if ((coreInsert || (options !== undefined && !(options.allowSelfPlaced === true && scopedParent))) &&
      parentType !== undefined && state.tool(parentType)?.entry.selfPlacesChildren === true) {
    const actions = state.actionsOf(parentType);

    state.fail('PLACEMENT_REFUSED', `"${parentType}" places its own children. Use one of: ${actions.join(', ')}.`, 'id' in parent ? '/parentId' : path, {
      reason: 'SELF_PLACED_PARENT', use: actions,
    });
  }

  const type = selectChildType(state, parent, spec.type, demote);

  if (typeof type !== 'string') {
    return refusePlacement(state, type, path);
  }

  const tool = state.tool(type) ?? failUnknownTool(state, type, `${path}/type`);

  // The contract's word: a type it calls not insertable never inserts, so describe and the runtime agree.
  if (coreInsert && tool.entry.insertable === false) {
    refuseInsert(state, tool.entry, `${path}/type`);
  }

  for (const field of options === undefined ? [] : tool.entry.viewState) {
    if (Object.hasOwn(spec.data ?? {}, field)) {
      state.fail('FIELD_NOT_WRITABLE', `"${field}" is view state. Agents do not set it.`, `${path}/data/${pointerKey(field)}`, {
        reason: 'view-state', field,
      });
    }
  }

  const id = state.newBlockId(spec.id, `${path}/id`);
  const given = spec.data === undefined ? tool.entry.defaultData ?? {} : withRequiredDefaults(tool, spec.data, (field, value) => {
    state.warn('CORRECTED', `Required field "${field}" was missing, so it got its default ${JSON.stringify(value)}.`, { blockId: id, field });
  });
  const data = state.prepareData(type, { ...given, ...(extra ?? {}) }, `${path}/data`, id, { normalize: !pending });
  const inCell = 'type' in parent ? parent.inCell : parent.id !== null && state.draft.cellOf(parent.id) !== null;
  // A seed only keeps a free container from being empty. Skip it when a command in the batch names the
  // container as parentId: an earlier one cannot (the id does not exist yet), so that command fills it.
  const unseeded = !tool.entry.children.ownedByTool && spec.id !== undefined && state.filledParents.has(spec.id);
  const childSpecs = spec.children ?? (unseeded ? [] : tool.runtime.defaultChildren ?? []).map((child, index) =>
    readInsertSpec(state, child, `${path}/children/${index}`));
  const childParent: Parent = {
    type, inCell,
    ...(options !== undefined && { actionScoped: scopedParent || type === options.tool }),
  };
  const children = childSpecs.map((child, index) =>
    buildBlock(state, child, childParent, `${path}/children/${index}`, demote, coreInsert, pending, undefined, options));

  if (type !== spec.type) {
    state.warn('DEMOTED', `"${spec.type}" is not allowed here and was inserted as "${type}".`);
  }

  return { id, type, data, ...(spec.tunes !== undefined && { tunes: cloneRecord(spec.tunes) }), children };
};

export const buildPlannedBlock = (
  state: PlanState,
  spec: InsertSpec,
  parent: Parent,
  path: string,
  demote: boolean,
  extra?: Record<string, unknown>,
  options?: ActionInsertOptions
): PlannedBlock => {
  const parsed = readInsertSpec(state, spec, path);

  reserveBlockIds(state, parsed, parent, path, demote, false);

  return buildBlock(state, parsed, parent, path, demote, false, state.ctx.prepared.get(state.index) === PREPARE_PENDING, extra, options);
};

// Inserted data is the agent's own; a copy (block.duplicate) is not checked.
const rejectWrites = (state: PlanState, block: PlannedBlock, path: string): void => {
  const reason = state.tool(block.type)?.runtime.rejectWrite?.(block.data, Object.keys(block.data));

  if (reason !== undefined) {
    state.fail('DATA_REJECTED', reason, `${path}/data`);
  }
  block.children.forEach((child, index) => rejectWrites(state, child, `${path}/children/${index}`));
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

  rejectWrites(state, planned, '');
  state.emit({ op: 'insert', block: planned, parentId: placement.parentId, afterId: placement.afterId });

  return { id: planned.id, childIds: planned.children.map(child => child.id) };
};

const requireTool = (state: PlanState, block: SnapBlock): PlannerTool => state.tool(block.type)
  ?? state.fail('UNKNOWN_TOOL', `Block "${block.id}" is a "${block.type}", which is not registered here. Only block.move and block.delete work on it.`, '/id', { opaque: true });

const pointerKey = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1');
const sameField = (left: Record<string, unknown>, right: Record<string, unknown>, field: string): boolean =>
  Object.hasOwn(left, field) === Object.hasOwn(right, field) &&
  (!Object.hasOwn(left, field) || JSON.stringify(left[field]) === JSON.stringify(right[field]));

const REACTIONS_PREFIX = 'reactions:';

/** `stored` names fields rebuilt from the draft (see PlanState.prepareData). */
export const planUpdate = (state: PlanState, args: Record<string, unknown>, stored: readonly string[] = []): unknown => {
  const block = state.requireBlock(args.id, '/id');
  const tool = requireTool(state, block);
  const patch = args.data === undefined ? {} : args.data;
  const tunes = args.tunes;

  if (!isRecord(patch)) {
    state.fail('INVALID_ARGS', 'Block data must be a record.', '/data');
  }
  if (tunes !== undefined && !isRecord(tunes)) {
    state.fail('INVALID_ARGS', 'Block tunes must be a record.', '/tunes');
  }

  for (const field of Object.keys(patch)) {
    const path = `/data/${pointerKey(field)}`;

    if (tool.entry.viewState.includes(field)) {
      state.fail('FIELD_NOT_WRITABLE', `"${field}" is view state. Agents do not set it.`, path, {
        reason: 'view-state', field,
      });
    }
    if (Object.hasOwn(tool.entry.guardedFields, field)) {
      const use = tool.entry.guardedFields[field];

      state.fail('FIELD_NOT_WRITABLE', `"${field}" keeps an invariant. Use ${use} instead.`, path, {
        reason: 'guarded', field, use,
      });
    }
    // A feed reaction key names its person (database-row "reactions:<user id>").
    if (field.startsWith(REACTIONS_PREFIX) && field !== `${REACTIONS_PREFIX}${state.stamp.actorId}`) {
      state.fail('FIELD_NOT_WRITABLE', `"${field}" holds another person's reactions. An agent writes only "${REACTIONS_PREFIX}${state.stamp.actorId}".`, path, {
        reason: 'other-person', field,
      });
    }
  }

  emitPatch(state, block, args.data === undefined ? undefined : patch, tunes, stored);

  return { id: block.id };
};

export const emitPatch = (
  state: PlanState,
  block: SnapBlock,
  input: Record<string, unknown> | undefined,
  tunes?: Record<string, unknown>,
  stored: readonly string[] = []
): void => {
  const tool = requireTool(state, block);
  const patch = input === undefined ? {} : input;

  if (!isRecord(patch)) {
    state.fail('INVALID_ARGS', 'Block data must be a record.', '/data');
  }
  for (const field of Object.keys(patch)) {
    if (tool.entry.viewState.includes(field)) {
      state.fail('FIELD_NOT_WRITABLE', `"${field}" is view state. Agents do not set it.`, `/data/${pointerKey(field)}`, {
        reason: 'view-state', field,
      });
    }
  }

  // A removed rich field clears to no text: deleted, the editor kept the old text.
  const cleared: Readonly<Record<string, unknown>> = {
    ...Object.fromEntries(tool.entry.richTextFields.map(field => [field, []])),
    ...tool.runtime.cleared,
  };
  // A removed key with a cleared value is written as that value: deleting it would let the tool
  // refill it on load with a default the user did not ask for.
  const clearing = Object.fromEntries(Object.entries(patch)
    .filter(([key, value]) => (value === null || value === undefined) && Object.hasOwn(cleared, key))
    .map(([key]) => [key, cleared[key]]));
  const removed = Object.entries(patch)
    .filter(([key, value]) => (value === null || value === undefined) && !Object.hasOwn(clearing, key)).map(([key]) => key);
  const written = input === undefined ? {} : state.prepareData(
    block.type, { ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null && value !== undefined)), ...clearing },
    '/data', block.id, { normalize: false, stored, current: block.data }
  );
  const merged = { ...cloneRecord(block.data), ...written };

  removed.forEach(key => Reflect.deleteProperty(merged, key));

  const normalized = tool.runtime.normalize === undefined ? merged : tool.runtime.normalize(cloneRecord(merged));

  if (!isRecord(normalized)) {
    state.fail('INVALID_ARGS', 'Normalized block data must be a record.', '/data');
  }
  // Explicit removals must survive normalizer defaults.
  removed.forEach(key => Reflect.deleteProperty(normalized, key));

  const reason = tool.runtime.rejectWrite?.(normalized, Object.keys(patch));

  if (reason !== undefined) {
    state.fail('DATA_REJECTED', reason, '/data');
  }

  const required = isArray(tool.entry.data.required) ? tool.entry.data.required : [];
  // The editor drops or refills a required field it loads without, so no engine deletes one.
  const lost = removed.find(key => required.includes(key));

  if (lost !== undefined) {
    state.fail('INVALID_ARGS', `"${lost}" is required, so it cannot be cleared. Write a new value instead.`, `/data/${pointerKey(lost)}`);
  }

  const rich = tool.entry.richTextFields;
  const produced: Record<string, unknown> = Object.fromEntries(rich
    .filter(field => Object.hasOwn(normalized, field) && !sameField(merged, normalized, field))
    .map(field => [field, normalized[field]]));
  const effective: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(normalized).filter(([key]) => !Object.hasOwn(produced, key))),
    ...(Object.keys(produced).length === 0 ? {} : state.prepareData(
      block.type, produced, '/data', block.id, { normalize: false, stored: Object.keys(produced) }
    )),
  };

  removed.forEach(key => Reflect.deleteProperty(effective, key));

  for (const field of tool.entry.viewState) {
    if (!sameField(block.data, effective, field)) {
      state.fail('FIELD_NOT_WRITABLE', `"${field}" is view state. Normalization cannot change it.`, `/data/${pointerKey(field)}`, {
        reason: 'view-state', field,
      });
    }
  }

  const edits: Edit[] = [];

  for (const field of rich) {
    if (!Object.hasOwn(effective, field) ||
        (!Object.hasOwn(patch, field) && sameField(block.data, effective, field))) {
      continue;
    }
    const value = effective[field];

    if (!isRichText(value)) {
      state.fail('INVALID_ARGS', `"${field}" must contain rich-text segments.`, `/data/${pointerKey(field)}`);
    }
    edits.push({ op: 'setRichText', id: block.id, field, value });
  }

  const fields = new Set([...Object.keys(patch), ...Object.keys(block.data), ...Object.keys(effective)]);
  const dataPatch: Record<string, unknown> = Object.fromEntries([...fields]
    .filter(field => !rich.includes(field) || !Object.hasOwn(effective, field))
    .filter(field => Object.hasOwn(patch, field) || !sameField(block.data, effective, field))
    .map(field => [field, Object.hasOwn(effective, field) ? effective[field] : null]));

  if (Object.keys(dataPatch).length > 0) {
    edits.push({ op: 'setData', id: block.id, patch: dataPatch });
  }
  if (tunes !== undefined) {
    edits.push({ op: 'setTunes', id: block.id, tunes });
  }
  state.emit(...edits);
};

export const planMove = (state: PlanState, args: Record<string, unknown>): unknown => {
  const block = state.requireBlock(args.id, '/id');

  emitMove(state, block.id, args.parentId, args.position, { allowSelfPlaced: false, cleanupEmptiedColumns: true });

  return { id: block.id };
};

export const emitMove = (
  state: PlanState,
  blockId: string,
  parentArg: unknown,
  position: unknown,
  options: { allowSelfPlaced: boolean; cleanupEmptiedColumns?: boolean; isScopedContainer?: (id: string) => boolean }
): void => {
  const block = state.requireBlock(blockId, '/id');
  const previousParent = block.parent;
  const refKey = isRecord(position) && 'before' in position ? 'before' : 'after';
  const refId = isRecord(position) ? state.resolveId(position[refKey], `/position/${refKey}`) : undefined;

  if (refId === block.id) {
    state.fail('INVALID_ARGS', `Cannot place "${block.id}" relative to itself.`, '/position');
  }

  const placement = state.place(parentArg, position);
  const parentType = placement.parentId === null ? undefined : state.draft.get(placement.parentId)?.type;
  const isScoped = (id: string): boolean => options.allowSelfPlaced && options.isScopedContainer?.(id) === true;

  if (parentType !== undefined && state.tool(parentType)?.entry.selfPlacesChildren === true &&
      (placement.parentId === null || !isScoped(placement.parentId))) {
    const actions = state.actionsOf(parentType);

    state.fail('PLACEMENT_REFUSED', `"${parentType}" places its own children. Use one of: ${actions.join(', ')}.`, '/parentId', {
      reason: 'SELF_PLACED_PARENT', use: actions,
    });
  }

  const tree = state.tree();
  const refusal = checkMove({
    ...tree,
    containerFacts: id => {
      const facts = tree.containerFacts(id);

      return isScoped(id) ? { ...facts, ownedByTool: false } : facts;
    },
  }, block.id, placement.parentId, refId, { allowColumnMoves: true });

  if (refusal !== null) {
    state.fail('PLACEMENT_REFUSED', `${refusal.message}.`, '/parentId', {
      reason: refusal.reason, ...(refusal.allowed !== undefined && { allowed: refusal.allowed }),
    });
  }

  const siblings = state.draft.childrenOf(placement.parentId);
  const index = siblings.indexOf(block.id);
  const previousId = index > 0 ? siblings[index - 1] ?? null : null;
  const afterId = placement.afterId === block.id ? previousId : placement.afterId;

  state.emit({ op: 'move', id: block.id, parentId: placement.parentId, afterId });

  const oldParent = previousParent === null ? undefined : state.draft.get(previousParent);

  if (options.cleanupEmptiedColumns === true && oldParent?.type === 'column' && oldParent.content.length === 0) {
    const list = oldParent.parent === null ? undefined : state.draft.get(oldParent.parent);
    const ctx = createActionContext(state, undefined, list?.type ?? 'column_list');

    ctx.remove(oldParent.id);
    if (list !== undefined) {
      cleanupEmptiedColumnList(ctx, list.id);
    }
  }
};

export const planConvert = (state: PlanState, args: Record<string, unknown>): unknown => {
  const block = state.requireBlock(args.id, '/id');
  const source = requireTool(state, block);
  const targetType = args.type;

  if (typeof targetType !== 'string' || targetType === '') {
    state.fail('INVALID_ARGS', 'Expected a non-empty block type.', '/type');
  }

  const target = state.tool(targetType) ?? failUnknownTool(state, targetType, '/type');
  const overrides = args.data === undefined ? {} : args.data;

  if (!isRecord(overrides)) {
    state.fail('INVALID_ARGS', 'Block data must be a record.', '/data');
  }

  const shape = convertShape(state, block, source, targetType, target, overrides);
  const missing = convertMissing(block, targetType, shape);

  if (missing.length > 0) {
    state.fail('CONVERSION_UNSUPPORTED', `Conversion from "${block.type}" to "${targetType}" is not possible: ${missing.join(' and ')} cannot convert here.`, '/type', { missing });
  }

  const inCell = state.draft.cellOf(block.id) !== null;
  const refusal: Refusal | null | undefined = checkChildType(state.tree(), block.parent, targetType)
    ?? (inCell && target.entry.restrictedInTableCell
      ? { reason: 'RESTRICTED_IN_CELL', message: `"${targetType}" is not allowed inside a table cell` }
      : null)
    ?? shape.kept.map(id => childRefusal(state, { type: targetType, inCell }, state.requireBlock(id, '/id').type))
      .find(value => value !== null);

  if (refusal !== undefined && refusal !== null) {
    state.fail('PLACEMENT_REFUSED', `${refusal.message}.`, '/type', {
      reason: refusal.reason, ...(refusal.allowed !== undefined && { allowed: refusal.allowed }),
    });
  }

  for (const field of Object.keys(overrides)) {
    const path = `/data/${pointerKey(field)}`;

    if (target.entry.viewState.includes(field)) {
      state.fail('FIELD_NOT_WRITABLE', `"${field}" is view state. Agents do not set it.`, path, {
        reason: 'view-state', field,
      });
    }
    if (Object.hasOwn(target.entry.guardedFields, field) && target.entry.guardedFields[field] !== 'block.convert') {
      const use = target.entry.guardedFields[field];

      state.fail('FIELD_NOT_WRITABLE', `"${field}" keeps an invariant. Use ${use} instead.`, path, {
        reason: 'guarded', field, use,
      });
    }
  }

  const from = shape.textFrom.field;
  const to = shape.textTo.field ?? '';
  const toRich = shape.textTo.tool?.entry.richTextFields.includes(to) === true;
  const text = from === undefined ? undefined : shape.textFrom.block.data[from];
  const plainSegments = !toRich && isArray(text) ? text : undefined;

  if (plainSegments !== undefined && !isRichText(plainSegments)) {
    state.fail('INVALID_ARGS', `"${from}" must contain rich-text segments.`, '/id');
  }
  const carried = (plainSegments === undefined ? text : state.ctx.richText.plainText(plainSegments)) ?? (toRich ? [] : '');
  const seedType = shape.textTo.seedType;
  const base = {
    ...(target.entry.defaultData ?? {}),
    ...(target.runtime.conversion?.base ?? {}),
    ...(seedType === undefined && { [to]: carried }),
  };
  const keepsField = (field: string): boolean => isRecord(target.entry.data.properties) && Object.hasOwn(target.entry.data.properties, field);
  const colors = carriedBlockColors(block.data, { ...base, ...overrides }, keepsField);
  const prepared = state.prepareData(targetType, { ...base, ...colors, ...overrides }, '/data', block.id, {
    normalize: false,
    stored: [...(seedType !== undefined || Object.hasOwn(overrides, to) ? [] : [to]), ...Object.keys(colors)],
  });
  const normalized = target.runtime.normalize === undefined ? prepared : target.runtime.normalize(cloneRecord(prepared));

  if (!isRecord(normalized)) {
    state.fail('INVALID_ARGS', 'Normalized block data must be a record.', '/data');
  }

  const rich = target.entry.richTextFields;
  const produced: Record<string, unknown> = Object.fromEntries(rich
    .filter(field => Object.hasOwn(normalized, field) && !sameField(prepared, normalized, field))
    .map(field => [field, normalized[field]]));
  const data: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(normalized).filter(([key]) => !Object.hasOwn(produced, key))),
    ...(Object.keys(produced).length === 0 ? {} : state.prepareData(
      targetType, produced, '/data', block.id, { normalize: false, stored: Object.keys(produced) }
    )),
  };

  for (const field of target.entry.viewState) {
    if (Object.hasOwn(data, field)) {
      state.fail('FIELD_NOT_WRITABLE', `"${field}" is view state. Agents do not set it.`, `/data/${pointerKey(field)}`, {
        reason: 'view-state', field,
      });
    }
  }
  for (const field of rich) {
    if (Object.hasOwn(data, field) && !isRichText(data[field])) {
      state.fail('INVALID_ARGS', `"${field}" must contain rich-text segments.`, `/data/${pointerKey(field)}`);
    }
  }
  emitBeforeSwap(state, block, shape);
  state.emit({ op: 'replaceType', id: block.id, type: targetType, data });
  emitAfterSwap(state, block, shape, targetType, overrides, seedType === undefined ? undefined : {
    type: seedType, data: { ...(shape.textTo.tool?.entry.defaultData ?? {}), [to]: carried },
  });

  return { id: block.id };
};

export const planDelete = (state: PlanState, args: Record<string, unknown>): unknown => {
  const block = state.requireBlock(args.id, '/id');
  const entry = state.tool(block.type)?.entry;
  // Self-placed children (table cells, database rows) die with the parent, as in core's removeBlock.
  const withChildren = entry?.children.deletedWithParent === true || entry?.selfPlacesChildren === true;
  const result = {
    removedIds: withChildren ? state.draft.subtree(block.id) : [block.id],
    liftedIds: withChildren ? [] : [...state.draft.childrenOf(block.id)],
  };

  // Explicit lifts give every applier the same move attribution.
  result.liftedIds.reduce((after, child) => {
    state.emit({ op: 'move', id: child, parentId: block.parent, afterId: after });

    return child;
  }, block.id);
  state.emit({ op: 'remove', id: block.id, withChildren });

  return result;
};

export const planDuplicate = (state: PlanState, args: Record<string, unknown>): unknown => {
  const source = state.requireBlock(args.id, '/id');

  requireTool(state, source);

  const placement = state.place(undefined, args.position ?? { after: source.id });
  const parent = placement.parentId === null ? undefined : state.draft.get(placement.parentId);

  if (parent !== undefined && state.tool(parent.type)?.entry.selfPlacesChildren === true) {
    const actions = state.actionsOf(parent.type);

    state.fail('PLACEMENT_REFUSED', `"${parent.type}" places its own children. Use one of: ${actions.join(', ')}.`, '/position', {
      reason: 'SELF_PLACED_PARENT', use: actions,
    });
  }

  const ids = new Map<string, string>();
  const reserveCopyIds = (block: SnapBlock, path: string): void => {
    ids.set(block.id, state.reserveFreshId(`${path}/id`));
    block.content.forEach((id, index) =>
      reserveCopyIds(state.requireBlock(id, '/id'), `${path}/children/${index}`));
  };

  reserveCopyIds(source, '');

  const toSpec = (block: SnapBlock): InsertSpec => {
    const data = cloneRecord(block.data);

    if (block.type === 'table' && isArray(data.content)) {
      data.content = data.content.map(row => !isArray(row) ? row : row.map(cell => {
        if (!isRecord(cell) || !isArray(cell.blocks)) {
          return cell;
        }

        return {
          ...cell,
          blocks: cell.blocks.map(id => typeof id === 'string' ? ids.get(id) ?? id : id),
        };
      }));
    }

    return {
      type: block.type,
      id: ids.get(block.id) ?? state.fail('INVALID_ARGS', 'The copied block has no reserved ID.', '/id'),
      data,
      ...(block.tunes !== undefined && { tunes: cloneRecord(block.tunes) }),
      children: block.content.map(id => toSpec(state.requireBlock(id, '/id'))),
    };
  };
  const planned = state.copyStored(() => buildPlannedBlock(state, toSpec(source), { id: placement.parentId }, '', false));

  state.emit({ op: 'insert', block: planned, parentId: placement.parentId, afterId: placement.afterId });

  return { id: planned.id, childIds: planned.children.map(child => child.id) };
};

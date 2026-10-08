import { isRichText } from '../rich-text/guards';
import { checkChildType, checkMove, satisfiesChildTools } from './placement-rules';
import { PREPARE_PENDING } from './plan-state';

import type { AgentBatch, Edit, InsertSpec, PlannedBlock } from '../../../types/agent';
import type { Refusal } from './placement-rules';
import type { PlanState } from './plan-state';
import type { SnapBlock } from './snapshot';
import type { JsonSchema, PlannerTool } from './types';

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

const requireTool = (state: PlanState, block: SnapBlock): PlannerTool => state.tool(block.type)
  ?? state.fail('UNKNOWN_TOOL', `Block "${block.id}" is a "${block.type}", which is not registered here. Only block.move and block.delete work on it.`, '/id', { opaque: true });

const pointerKey = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1');
const sameField = (left: Record<string, unknown>, right: Record<string, unknown>, field: string): boolean =>
  Object.hasOwn(left, field) === Object.hasOwn(right, field) &&
  (!Object.hasOwn(left, field) || JSON.stringify(left[field]) === JSON.stringify(right[field]));

export const planUpdate = (state: PlanState, args: Record<string, unknown>): unknown => {
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
  }

  const written = args.data === undefined ? {} : state.prepareData(
    block.type, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null)),
    '/data', block.id, { normalize: false }
  );
  const merged = { ...structuredClone(block.data), ...written };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      Reflect.deleteProperty(merged, key);
    }
  }

  const normalized = tool.runtime.normalize === undefined ? merged : tool.runtime.normalize(structuredClone(merged));

  if (!isRecord(normalized)) {
    state.fail('INVALID_ARGS', 'Normalized block data must be a record.', '/data');
  }

  const rich = tool.entry.richTextFields;
  const produced: Record<string, unknown> = Object.fromEntries(rich
    .filter(field => Object.hasOwn(normalized, field) && !sameField(merged, normalized, field))
    .map(field => [field, normalized[field]]));
  const effective: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(normalized).filter(([key]) => !Object.hasOwn(produced, key))),
    ...(Object.keys(produced).length === 0 ? {} : state.prepareData(
      block.type, produced, '/data', block.id, { normalize: false }
    )),
  };

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

  return { id: block.id };
};

export const planMove = (state: PlanState, args: Record<string, unknown>): unknown => {
  const block = state.requireBlock(args.id, '/id');
  const position = args.position;
  const refKey = isRecord(position) && 'before' in position ? 'before' : 'after';
  const refId = isRecord(position) ? state.resolveId(position[refKey], `/position/${refKey}`) : undefined;

  if (refId === block.id) {
    state.fail('INVALID_ARGS', `Cannot place "${block.id}" relative to itself.`, '/position');
  }

  const placement = state.place(args.parentId, position);
  const parentType = placement.parentId === null ? undefined : state.draft.get(placement.parentId)?.type;

  if (parentType !== undefined && state.tool(parentType)?.entry.selfPlacesChildren === true) {
    const actions = state.actionsOf(parentType);

    state.fail('PLACEMENT_REFUSED', `"${parentType}" places its own children. Use one of: ${actions.join(', ')}.`, '/parentId', {
      reason: 'SELF_PLACED_PARENT', use: actions,
    });
  }

  const refusal = checkMove(state.tree(), block.id, placement.parentId, refId, { allowColumnMoves: true });

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

  return { id: block.id };
};

export const planConvert = (state: PlanState, args: Record<string, unknown>): unknown => {
  const block = state.requireBlock(args.id, '/id');
  const source = requireTool(state, block);
  const targetType = args.type;

  if (typeof targetType !== 'string' || targetType === '') {
    state.fail('INVALID_ARGS', 'Expected a non-empty block type.', '/type');
  }

  const target = state.tool(targetType) ?? state.fail('UNKNOWN_TOOL', `No block tool "${targetType}" is registered.`, '/type');
  const from = source.entry.conversion.export;
  const to = target.entry.conversion.import;

  if (typeof from !== 'string' || typeof to !== 'string') {
    const missing = [
      typeof from !== 'string' ? block.type : null,
      typeof to !== 'string' ? targetType : null,
    ].filter((type): type is string => type !== null);

    state.fail('CONVERSION_UNSUPPORTED', `Conversion from "${block.type}" to "${targetType}" is not possible: ${missing.join(' and ')} cannot convert here.`, '/type', { missing });
  }

  const inCell = state.draft.cellOf(block.id) !== null;
  const refusal: Refusal | null | undefined = checkChildType(state.tree(), block.parent, targetType)
    ?? (inCell && target.entry.restrictedInTableCell
      ? { reason: 'RESTRICTED_IN_CELL', message: `"${targetType}" is not allowed inside a table cell` }
      : null)
    ?? block.content.map(id => childRefusal(state, { type: targetType, inCell }, state.requireBlock(id, '/id').type))
      .find(value => value !== null);

  if (refusal !== undefined && refusal !== null) {
    state.fail('PLACEMENT_REFUSED', `${refusal.message}.`, '/type', {
      reason: refusal.reason, ...(refusal.allowed !== undefined && { allowed: refusal.allowed }),
    });
  }

  const overrides = args.data === undefined ? {} : args.data;

  if (!isRecord(overrides)) {
    state.fail('INVALID_ARGS', 'Block data must be a record.', '/data');
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

  const text = block.data[from];
  const plainSegments = !target.entry.richTextFields.includes(to) && isArray(text) ? text : undefined;

  if (plainSegments !== undefined && !isRichText(plainSegments)) {
    state.fail('INVALID_ARGS', `"${from}" must contain rich-text segments.`, '/id');
  }
  const carried = plainSegments === undefined ? text : state.ctx.richText.plainText(plainSegments);
  const prepared = state.prepareData(targetType, {
    ...(target.entry.defaultData ?? {}),
    [to]: carried ?? (target.entry.richTextFields.includes(to) ? [] : ''),
    ...overrides,
  }, '/data', block.id, { normalize: false });
  const normalized = target.runtime.normalize === undefined ? prepared : target.runtime.normalize(structuredClone(prepared));

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
      targetType, produced, '/data', block.id, { normalize: false }
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
  state.emit({ op: 'replaceType', id: block.id, type: targetType, data });

  return { id: block.id };
};

export const planDelete = (state: PlanState, args: Record<string, unknown>): unknown => {
  const block = state.requireBlock(args.id, '/id');
  const withChildren = state.tool(block.type)?.entry.children.deletedWithParent === true;
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
    const data = structuredClone(block.data);

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
      ...(block.tunes !== undefined && { tunes: structuredClone(block.tunes) }),
      children: block.content.map(id => toSpec(state.requireBlock(id, '/id'))),
    };
  };
  const planned = buildPlannedBlock(state, toSpec(source), { id: placement.parentId }, '', false);

  state.emit({ op: 'insert', block: planned, parentId: placement.parentId, afterId: placement.afterId });

  return { id: planned.id, childIds: planned.children.map(child => child.id) };
};

import { AgentFailure } from './errors';
import { splitCommandName } from './names';
import { buildPlannedBlock, emitMove, emitPatch } from './plan-block';
import { PREPARE_PENDING } from './plan-state';

import type { PlannedBlock } from '../../../types/agent';
import type { ToolActionContext } from '../../../types/tools/tool-description';
import type { PlanState } from './plan-state';
import type { SnapBlock } from './snapshot';

export type RecordingContext = ToolActionContext;

const pointerKey = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1');
const view = (block: SnapBlock): NonNullable<ReturnType<RecordingContext['read']>> => ({
  id: block.id,
  type: block.type,
  data: structuredClone(block.data),
  parentId: block.parent,
  children: [...block.content],
});

export const createActionContext = (state: PlanState, block: SnapBlock | undefined, tool: string): RecordingContext => {
  const roots = new Set<string>(block === undefined ? [] : [block.id]);
  const isScopedContainer = (id: string): boolean =>
    [...roots].some(root => id === root || state.draft.isUnder(id, root));

  return {
    tool,
    ...(block !== undefined && { block: {
      id: block.id, type: block.type, data: structuredClone(block.data), children: [...block.content],
    } }),
    read: id => {
      const found = state.draft.get(id);

      return found === undefined ? null : view(found);
    },
    insert: input => {
      const { parentId, position, ...spec } = input;
      const placement = state.place(parentId, position ?? 'end');
      const planned = buildPlannedBlock(state, spec, { id: placement.parentId }, '', false, undefined, {
        allowSelfPlaced: true, tool, isScopedContainer,
      });
      const nodes: Array<{ block: PlannedBlock; path: string }> = [{ block: planned, path: '' }];

      for (const node of nodes) {
        const field = (state.tool(node.block.type)?.entry.viewState ?? []).find(candidate => Object.hasOwn(node.block.data, candidate));

        if (field !== undefined) {
          state.fail('FIELD_NOT_WRITABLE', `"${field}" is view state. Agents do not set it.`, `${node.path}/data/${pointerKey(field)}`, {
            reason: 'view-state', field,
          });
        }
        node.block.children.forEach((child, index) => nodes.push({ block: child, path: `${node.path}/children/${index}` }));
      }

      state.emit({ op: 'insert', block: planned, parentId: placement.parentId, afterId: placement.afterId });
      nodes.forEach(node => {
        if (node.block.type === tool) {
          roots.add(node.block.id);
        }
      });

      return planned.id;
    },
    update: (id, patch) => emitPatch(state, state.requireBlock(id, '/id'), patch),
    setRichText: (id, field, value) => {
      const target = state.requireBlock(id, '/id');
      const targetTool = state.tool(target.type)
        ?? state.fail('UNKNOWN_TOOL', `Block "${target.id}" is a "${target.type}", which is not registered here.`, '/id', { opaque: true });
      const fields = targetTool.entry.richTextFields;

      if (!fields.includes(field)) {
        state.fail('FIELD_NOT_RICH_TEXT', `"${field}" is not a rich-text field of "${target.type}". Rich fields: ${fields.join(', ') || 'none'}.`, '/field', { fields });
      }
      emitPatch(state, target, { [field]: value });
    },
    move: (id, to) => emitMove(state, id, to.parentId, to.position, { allowSelfPlaced: true, isScopedContainer }),
    remove: (id, opts = {}) => {
      const target = state.requireBlock(id, '/id');
      const entry = state.tool(target.type)?.entry;

      state.emit({
        op: 'remove', id: target.id,
        withChildren: opts.withChildren ?? (entry?.children.deletedWithParent === true || entry?.selfPlacesChildren === true),
      });
    },
    newId: () => state.reserveFreshId('/id'),
    richText: state.ctx.richText,
    fail: (code, message) => state.fail(code, message),
  };
};

export const planToolAction = (state: PlanState, name: string, args: Record<string, unknown>): unknown => {
  const entry = state.ctx.commands.get(name);
  const split = splitCommandName(name);

  if (entry === undefined || typeof entry.source !== 'object' || split === null) {
    return state.fail('UNKNOWN_COMMAND', `"${name}" is not a command here.`);
  }

  const { tool, target } = entry.source;
  const block = target === 'block' ? state.requireBlock(args.id, '/id') : undefined;

  if (block !== undefined && block.type !== tool) {
    state.fail('INVALID_ARGS', `"${name}" works on "${tool}" blocks; "${block.id}" is a "${block.type}".`, '/id');
  }

  const prepared = state.ctx.prepared.get(state.index);

  if (prepared === PREPARE_PENDING) {
    return {};
  }

  const actions = state.tool(tool)?.runtime.actions;
  const impl = actions !== undefined && Object.hasOwn(actions, split.action) ? actions[split.action] : undefined;

  if (impl === undefined) {
    return state.fail('COMMAND_UNAVAILABLE', `"${name}" has no handler in this runtime.`, '', { reason: 'runtime' });
  }

  try {
    const result = impl.run(createActionContext(state, block, tool), args, prepared);

    if (result !== null && (typeof result === 'object' || typeof result === 'function') &&
        'then' in result && typeof result.then === 'function') {
      state.fail('PRECONDITION_FAILED', `"${name}" must run synchronously. Put async work in prepare.`);
    }

    return result;
  } catch (error) {
    if (error instanceof AgentFailure) {
      throw error;
    }

    return state.fail('TOOL_ACTION_FAILED', `"${name}" failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

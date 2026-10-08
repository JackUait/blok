import { failure } from './errors';
import { planDelete, planDuplicate, planInsert, planUpdate, reserveBatchInsertIds } from './plan-block';
import { PlanState } from './plan-state';

import type { AgentBatch, AgentWarning } from '../../../types/agent';
import type { EditStamp } from './json-applier';
import type { DocSnapshot } from './snapshot';
import type { Plan, PlannerContext } from './types';

export type CommandHandler = (state: PlanState, args: Record<string, unknown>) => unknown;

export const HANDLERS: Record<string, CommandHandler> = {
  'block.insert': planInsert,
  'block.update': planUpdate,
  'block.delete': planDelete,
  'block.duplicate': planDuplicate,
};

export const registerHandlers = (entries: Record<string, CommandHandler>): void => {
  Object.entries(entries).forEach(([name, handler]) => {
    Object.defineProperty(HANDLERS, name, {
      value: handler, writable: true, enumerable: true, configurable: true,
    });
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

const reserveInsertIds = (state: PlanState, value: unknown, path: string): void => {
  if (!isRecord(value)) {
    return;
  }
  if (typeof value.id === 'string' && value.id !== '') {
    state.reserveId(value.id, `${path}/id`);
  }
  if (isArray(value.children)) {
    value.children.forEach((child, index) => reserveInsertIds(state, child, `${path}/children/${index}`));
  }
};

const settleChanged = (changed: Plan['changed']): Plan['changed'] => {
  const removed = new Set(changed.removed);
  const created = new Set(changed.created.filter(id => !removed.has(id)));
  const unique = (ids: string[], skip: Set<string>[]): string[] =>
    [...new Set(ids)].filter(id => skip.every(set => !set.has(id)));

  return {
    created: [...created],
    updated: unique(changed.updated, [removed, created]),
    moved: unique(changed.moved, [removed, created]),
    removed: [...removed],
  };
};

export const planBatch = (input: {
  snapshot: DocSnapshot;
  batch: AgentBatch;
  ctx: PlannerContext;
  stamp: EditStamp;
  warnings: AgentWarning[];
}): { plan: Plan; draft: DocSnapshot } => {
  const state = new PlanState(input.snapshot.clone(), input.ctx, input.warnings, input.stamp);

  input.batch.commands.forEach((command, index) => {
    state.index = index;
    if (command.name === 'block.insert') {
      reserveInsertIds(state, command.args, '');
    }
  });
  reserveBatchInsertIds(state, input.batch);

  input.batch.commands.forEach((command, index) => {
    state.index = index;
    if (command.ref !== undefined && Object.prototype.hasOwnProperty.call(state.refs, command.ref)) {
      throw failure('INVALID_ARGS', `ref "${command.ref}" is already used by an earlier command. Pick another name.`, {
        commandIndex: index, path: `/commands/${index}/ref`,
      });
    }

    const handler = Object.prototype.hasOwnProperty.call(HANDLERS, command.name) ? HANDLERS[command.name] : undefined;

    if (handler === undefined) {
      throw failure('UNKNOWN_COMMAND', `"${command.name}" has no planner.`, {
        commandIndex: index, path: `/commands/${index}/name`,
      });
    }

    const createdAt = state.changed.created.length;
    const existing = command.ref === undefined ? undefined : new Set(state.draft.ids());
    const result = handler(state, command.args);

    state.results.push(result);
    if (command.ref !== undefined) {
      const id = isRecord(result) ? result.id : undefined;

      if (typeof id !== 'string' || id === '' || existing?.has(id) === true ||
        !state.draft.has(id) || !state.changed.created.slice(createdAt).includes(id)) {
        throw failure('INVALID_ARGS', `"${command.name}" creates no referenced block, so it cannot carry a ref.`, {
          commandIndex: index, path: `/commands/${index}/ref`,
        });
      }
      Object.defineProperty(state.refs, command.ref, {
        value: id, writable: true, enumerable: true, configurable: true,
      });
    }
  });

  return {
    plan: {
      edits: state.edits,
      results: state.results,
      refs: state.refs,
      changed: settleChanged(state.changed),
      ...(state.lastRange !== undefined && { lastRange: state.lastRange }),
      warnings: input.warnings,
      touched: state.touched,
    },
    draft: state.draft,
  };
};

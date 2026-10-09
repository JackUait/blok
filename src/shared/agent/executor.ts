import { isRichText } from '../rich-text/guards';
import { checkEnvelope } from './envelope';
import { AgentFailure, failure } from './errors';
import { splitCommandName } from './names';
import { PREPARE_PENDING } from './plan-state';
import { planBatch } from './planner';

import type { AgentActor, AgentBatch, AgentError, AgentResult, AgentWarning, CommandLogEntry } from '../../../types/agent';
import type { DocSnapshot } from './snapshot';
import type { Plan, PlannerActionImpl, PlannerContext } from './types';

export interface AgentApplier {
  readonly runtime: 'editor' | 'node' | 'jint' | 'node-live';
  isReadOnly(): boolean;
  settle?(): Promise<void>;
  snapshot(): DocSnapshot;
  revision(): string;
  apply(plan: Plan, draft: DocSnapshot): Promise<void>;
  prepareInsert?(type: string): Promise<Record<string, unknown> | undefined>;
  undo?(): Promise<void>;
  redo?(): Promise<void>;
}

export interface BatchInput {
  batch: unknown;
  ctx: Omit<PlannerContext, 'prepared'>;
  applier: AgentApplier;
  actor: AgentActor;
  signal?: AbortSignal;
  log: CommandLogEntry[];
  batchNo: number;
  now?: () => number;
}

type Preparation = () => Promise<unknown>;
type HostReceipt =
  | { command: string; prepared: unknown }
  | { command: 'block.insert'; type: string; prepared: Record<string, unknown> | undefined };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

const actionFor = (ctx: BatchInput['ctx'], name: string): PlannerActionImpl | undefined => {
  const entry = ctx.commands.get(name);
  const split = splitCommandName(name);
  const actions = typeof entry?.source === 'object'
    ? ctx.tools.get(entry.source.tool)?.runtime.actions : undefined;

  return actions !== undefined && split !== null && Object.hasOwn(actions, split.action)
    ? actions[split.action] : undefined;
};

const insertedType = (plan: Plan, index: number): string => {
  const result = plan.results[index];
  const id = isRecord(result) && typeof result.id === 'string' ? result.id : undefined;
  const insert = plan.edits.find(edit => edit.op === 'insert' && edit.block.id === id);

  if (insert?.op !== 'insert') {
    throw failure('PRECONDITION_FAILED', 'The insert plan has no created block.', { commandIndex: index });
  }

  return insert.block.type;
};

const preparationsFor = (
  input: BatchInput,
  batch: AgentBatch,
  plan: Plan,
  orphaned: HostReceipt[],
  insertTypes: Map<number, string>
): Map<number, Preparation> => {
  const preparations = new Map<number, Preparation>();

  batch.commands.forEach((command, index) => {
    if (command.name === 'markdown.insert') {
      const markdown = command.args.markdown;

      if (typeof markdown !== 'string') {
        throw failure('INVALID_ARGS', 'Expected Markdown text.', {
          commandIndex: index, path: `/commands/${index}/args/markdown`,
        });
      }
      preparations.set(index, () => input.ctx.ports.markdownToBlocks(markdown));

      return;
    }

    const impl = actionFor(input.ctx, command.name);
    const prepare = impl?.prepare;

    if (prepare !== undefined) {
      preparations.set(index, async () => {
        const prepared = await prepare.call(impl, { services: input.ctx.services }, command.args);

        if (input.ctx.commands.get(command.name)?.effects === 'host') {
          orphaned.push({ command: command.name, prepared });
        }

        return prepared;
      });

      return;
    }

    const type = command.name === 'block.insert' ? insertedType(plan, index) : undefined;
    const requires = type === undefined ? undefined : input.ctx.tools.get(type)?.entry.insertRequires;

    if (type !== undefined && requires !== undefined && requires.length > 0) {
      preparations.set(index, async () => {
        if (input.applier.prepareInsert === undefined) {
          throw failure('COMMAND_UNAVAILABLE', `Inserting "${type}" needs the host (${requires.join(', ')}), which is absent here.`, {
            commandIndex: index, details: { reason: 'service', requires },
          });
        }

        const prepared = await input.applier.prepareInsert(type);

        orphaned.push({ command: 'block.insert', type, prepared });
        insertTypes.set(index, type);

        return prepared;
      });
    }
  });

  return preparations;
};

const prepareAt = async (prepare: Preparation, index: number): Promise<unknown> => {
  try {
    return await prepare();
  } catch (error) {
    throw error instanceof AgentFailure
      ? new AgentFailure({ ...error.error, commandIndex: error.error.commandIndex ?? index })
      : failure('TOOL_ACTION_FAILED', `A prepare step failed: ${error instanceof Error ? error.message : String(error)}`, {
        commandIndex: index,
      });
  }
};

const historyStep = (applier: AgentApplier, name: 'history.undo' | 'history.redo'): (() => Promise<void>) => {
  const step = name === 'history.undo' ? applier.undo : applier.redo;

  if (step === undefined) {
    throw failure('COMMAND_UNAVAILABLE', `${name} is not available here.`, {
      commandIndex: 0, details: { reason: 'runtime' },
    });
  }

  return step.bind(applier);
};

const failureRevision = (applier: AgentApplier): string | undefined => {
  try {
    return applier.revision();
  } catch {
    return undefined;
  }
};

const staleContext = (
  batch: AgentBatch,
  snapshot: DocSnapshot,
  ctx: BatchInput['ctx']
): Array<{ id: string; type: string; text?: string }> => {
  const named = new Set<string>();

  for (const { args } of batch.commands) {
    const candidates = [
      args.id, args.parentId, args.rootId,
      ...(isArray(args.ids) ? args.ids : []),
      ...(isRecord(args.position) ? [args.position.before, args.position.after] : []),
    ];

    candidates.forEach(id => {
      if (typeof id === 'string' && !id.startsWith('$')) {
        named.add(id);
      }
    });
  }

  return snapshot.readingOrder(null).flatMap(({ id }) => {
    const block = named.has(id) ? snapshot.get(id) : undefined;

    if (block === undefined) {
      return [];
    }

    const field = ctx.tools.get(block.type)?.entry.richTextFields[0];
    const value = field === undefined ? undefined : block.data[field];

    return [{
      id, type: block.type,
      ...(isRichText(value) ? { text: ctx.richText.plainText(value) } : {}),
    }];
  });
};

export const runBatch = async (input: BatchInput): Promise<AgentResult> => {
  const warnings: AgentWarning[] = [];
  const orphaned: HostReceipt[] = [];
  const state: { batch?: AgentBatch } = {};

  const checkCancel = (): void => {
    if (input.signal?.aborted === true) {
      throw failure('CANCELLED', 'The turn was stopped before anything was written.',
        orphaned.length > 0 ? { details: { orphaned } } : {});
    }
  };
  const checkRevision = (checked: AgentBatch, revision: string, snapshot: () => DocSnapshot): void => {
    if (checked.expectRevision !== undefined && checked.expectRevision !== revision) {
      throw failure('STALE', 'The document changed since you read it. Read it again, then retry.', {
        details: { revision, current: staleContext(checked, snapshot(), input.ctx) },
      });
    }
  };
  const record = (results: unknown[] | null, error: AgentError | null): void => {
    const commands = state.batch?.commands;

    if (commands === undefined) {
      input.log.push({
        batch: input.batchNo, index: error?.commandIndex ?? 0, name: '', args: input.batch,
        ...(error !== null && { error }), actorId: input.actor.id,
      });

      return;
    }
    commands.forEach((command, index) => input.log.push({
      batch: input.batchNo, index, name: command.name, args: command.args,
      ...(results !== null && { result: results[index] }),
      ...(error !== null && (error.commandIndex ?? 0) === index && { error }),
      actorId: input.actor.id,
    }));
  };

  try {
    checkCancel();

    const checked = checkEnvelope(input.batch, input.ctx.commands, input.ctx.validate);
    const batch = checked.batch;

    state.batch = batch;
    if (checked.writes && input.applier.isReadOnly()) {
      throw failure('READ_ONLY', 'The document is read-only now. Reads still work.');
    }
    checkRevision(batch, input.applier.revision(), () => input.applier.snapshot());

    const first = batch.commands[0];

    if (first?.name === 'history.undo' || first?.name === 'history.redo') {
      const step = historyStep(input.applier, first.name);

      checkCancel();
      await step();
      const revision = input.applier.revision();

      record([{}], null);

      return {
        ok: true, revision, results: [{}], refs: {},
        changed: { created: [], updated: [], moved: [], removed: [] }, warnings,
      };
    }

    const stamp = { actorId: input.actor.id, at: (input.now ?? Date.now)() };
    const pending = new Map<number, unknown>();

    batch.commands.forEach((command, index) => {
      const requires = typeof command.args.type === 'string'
        ? input.ctx.tools.get(command.args.type)?.entry.insertRequires : undefined;
      const insertPending = command.name === 'block.insert'
        && (command.args.demote === true || (requires?.length ?? 0) > 0);

      if (command.name === 'markdown.insert' || actionFor(input.ctx, command.name)?.prepare !== undefined || insertPending) {
        pending.set(index, PREPARE_PENDING);
      }
    });
    const { plan: prePlan } = planBatch({
      snapshot: input.applier.snapshot(), batch, ctx: { ...input.ctx, prepared: pending }, stamp, warnings,
    });
    const insertTypes = new Map<number, string>();
    const preparations = preparationsFor(input, batch, prePlan, orphaned, insertTypes);
    const prepared = new Map<number, unknown>();

    for (const [index, prepare] of preparations) {
      prepared.set(index, await prepareAt(prepare, index));
    }

    checkCancel();
    await input.applier.settle?.();

    // Keep the fresh snapshot and apply in the same synchronous turn.
    const snapshot = input.applier.snapshot();
    const current = input.applier.revision();

    checkRevision(batch, current, () => snapshot);

    // Only concrete warnings refer to the IDs that will be applied.
    warnings.length = 0;
    const { plan, draft } = planBatch({
      snapshot, batch, ctx: { ...input.ctx, prepared }, stamp, warnings,
    });

    checkCancel();
    batch.commands.forEach((command, index) => {
      if (command.name !== 'block.insert') {
        return;
      }
      const type = insertedType(plan, index);
      const preparedType = insertTypes.get(index);
      const requires = input.ctx.tools.get(type)?.entry.insertRequires;

      if (preparedType !== type && (preparedType !== undefined || (requires?.length ?? 0) > 0)) {
        throw failure('STALE', 'The insertion type changed during preparation. Read the document again, then retry.', {
          commandIndex: index, details: { revision: current, current: staleContext(batch, snapshot, input.ctx) },
        });
      }
    });
    if (plan.edits.length > 0) {
      await input.applier.apply(plan, draft);
    }

    const revision = input.applier.revision();
    const commands = batch.commands;
    const results = plan.results.map((result, index) =>
      commands[index]?.name === 'doc.read' && isRecord(result) ? { ...result, revision } : result);

    record(results, null);

    return {
      ok: true, revision, results, refs: plan.refs, changed: plan.changed,
      ...(plan.lastRange !== undefined && { lastRange: plan.lastRange }), warnings,
    };
  } catch (error) {
    const cause = error instanceof AgentFailure ? error.error
      : failure('APPLY_FAILED', `The document runtime failed: ${error instanceof Error ? error.message : String(error)}. The document may be partly changed; read it again.`).error;
    const failed = orphaned.length > 0 && cause.code !== 'CANCELLED'
      ? failure('ORPHANED_SIDE_EFFECT', `The batch failed after the host did work for it (${cause.message}). Clean up the listed items.`, {
        ...(cause.commandIndex !== undefined && { commandIndex: cause.commandIndex }),
        details: { orphaned, cause },
      }).error
      : cause;
    const revision = failureRevision(input.applier);

    record(null, failed);

    return { ok: false, ...(revision !== undefined && { revision }), error: failed, warnings };
  }
};

import { isRichText } from '../rich-text/guards';
import {
  approvalKey, approvalNeeded, approveRequests, approveStep, checkShareReachable, lockedDatabases, planWithApprovals, savedTitle, sharedBetween, shareRequest, unlockedBetween,
} from './approval';
import type { ShareStep } from './approval';
import { agentAttribution } from './attribution';
import { viewRows } from './document-view';
import { checkEnvelope } from './envelope';
import { preflightProblems } from './batch-preflight';
import { AgentFailure, failure, insertUnavailableReason, notPreparedHere, withOthers } from './errors';
import { guardedServices } from './media-gate';
import { isVersionRead, splitCommandName } from './names';
import { PREPARE_PENDING } from './plan-state';
import { planBatch } from './planner';
import { runRestore, runVersionCommand } from './version-history';
import { FILE_UPLOAD_ACTION } from '../tool-manifest';

import type { AgentActor, AgentApprover, AgentBatch, AgentError, AgentErrorCode, AgentResult, AgentWarning, CommandLogEntry } from '../../../types/agent';
import type { EditStamp } from './json-applier';
import type { DocSnapshot } from './snapshot';
import type { HostEffect, Plan, PlannerActionImpl, PlannerContext } from './types';

export interface AgentApplier {
  readonly runtime: 'editor' | 'node' | 'jint' | 'node-live';
  isReadOnly(): boolean;
  settle?(): Promise<void>;
  snapshot(): DocSnapshot;
  revision(): string;
  apply(plan: Plan, draft: DocSnapshot): Promise<void>;
  /** `data`: the planned block's data, so a toolbox variant (e.g. a full-page database) prepares the right thing. */
  prepareInsert?(type: string, data?: Record<string, unknown>): Promise<Record<string, unknown> | undefined>;
  /**
   * `bound.expected`: the historyStepId the caller checked, undefined meaning "there was none".
   * Another step on top refuses with STALE and changes nothing. No `bound`: no check.
   */
  undo?(bound?: HistoryBound): Promise<void>;
  redo?(bound?: HistoryBound): Promise<void>;
  /** The step history.undo or history.redo would run now, as an identity to compare. */
  historyStepId?(name: 'history.undo' | 'history.redo'): unknown;
  /** The document a history step would leave, when the applier keeps whole snapshots. */
  historyTarget?(name: 'history.undo' | 'history.redo'): DocSnapshot | undefined;
  /** Keeps, on the step this batch just made, what that step unlocks when redone and when undone. */
  recordUnlocks?(unlocks: StepUnlocks): void;
  /**
   * What the step history.undo or history.redo would run now unlocks, read from that real step.
   * [] when the step is not this session's (the step refuses); undefined when it cannot tell.
   */
  pendingUnlocks?(name: 'history.undo' | 'history.redo'): readonly string[] | undefined;
  /** Runs the plan's host hooks after it applied. Absent: this runtime runs none. */
  runHostEffects?(effects: readonly HostEffect[]): void;
  /** Like pendingUnlocks, for the sharing changes the step makes. Undefined (or no method) refuses the step. */
  pendingShares?(name: 'history.undo' | 'history.redo'): readonly ShareStep[] | undefined;
}

/** The step a caller checked. A wrapper, so "the stack was empty" is not mistaken for "no check". */
export interface HistoryBound { expected: unknown }

/** The databases a step unlocks, and the views whose sharing it changes, when redone (forward) and when undone (backward). */
export interface StepUnlocks { forward: string[]; backward: string[]; shares?: { forward: ShareStep[]; backward: ShareStep[] } }

export interface BatchInput {
  batch: unknown;
  ctx: Omit<PlannerContext, 'prepared'>;
  applier: AgentApplier;
  actor: AgentActor;
  signal?: AbortSignal;
  /** The host's way to ask a person. Never from model input. */
  approve?: AgentApprover;
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

const insertedBlock = (plan: Plan, index: number): { type: string; data?: Record<string, unknown> } => {
  const result = plan.results[index];
  const id = isRecord(result) && typeof result.id === 'string' ? result.id : undefined;
  const insert = plan.edits.find(edit => edit.op === 'insert' && edit.block.id === id);

  if (insert?.op !== 'insert') {
    throw failure('PRECONDITION_FAILED', 'The insert plan has no created block.', { commandIndex: index });
  }

  return insert.block;
};

const importHtml = async (ports: BatchInput['ctx']['ports'], html: unknown, index: number): Promise<unknown> => {
  if (ports.htmlToBlocks === undefined) {
    throw failure('COMMAND_UNAVAILABLE', 'html.insert runs only in the editor.', { commandIndex: index, details: { reason: 'runtime' } });
  }
  if (typeof html !== 'string') {
    throw failure('INVALID_ARGS', 'Expected HTML text.', { commandIndex: index, path: `/commands/${index}/args/html` });
  }
  const imported = await ports.htmlToBlocks(html);

  if (imported.blocks.length === 0) {
    throw failure('INVALID_ARGS', 'A paste of this HTML gives no blocks. For plain text, use markdown.insert or block.insert.', {
      commandIndex: index, path: `/commands/${index}/args/html`,
    });
  }

  return imported;
};

// Each prepared insert makes the host create something, like a page's document; more than this is a loop, not a person's work.
export const MAX_PREPARED_INSERTS = 25;

const preparationsFor = (
  input: BatchInput,
  batch: AgentBatch,
  plan: Plan,
  orphaned: HostReceipt[],
  insertTypes: Map<number, string>
): Map<number, Preparation> => {
  const preparations = new Map<number, Preparation>();
  const counted = { inserts: 0 };

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
    if (command.name === 'html.insert') {
      preparations.set(index, () => importHtml(input.ctx.ports, command.args.html, index));

      return;
    }

    const impl = actionFor(input.ctx, command.name);
    const prepare = impl?.prepare;

    if (prepare !== undefined) {
      preparations.set(index, async () => {
        const prepared = await prepare.call(impl, { services: guardedServices(input.ctx.services, input.ctx.ports.media, index) }, command.args);

        if (input.ctx.commands.get(command.name)?.effects === 'host') {
          orphaned.push({ command: command.name, prepared });
        }

        return prepared;
      });

      return;
    }

    const inserted = command.name === 'block.insert' ? insertedBlock(plan, index) : undefined;
    const type = inserted?.type;
    const requires = type === undefined ? undefined : input.ctx.tools.get(type)?.entry.insertRequires;

    if (type !== undefined && requires !== undefined && requires.length > 0) {
      if (++counted.inserts > MAX_PREPARED_INSERTS) {
        throw failure('INVALID_ARGS', `One batch inserts at most ${MAX_PREPARED_INSERTS} blocks the host prepares, such as pages. Send the rest in another batch.`, {
          commandIndex: index,
        });
      }
      preparations.set(index, async () => {
        if (input.applier.prepareInsert === undefined) {
          throw failure('COMMAND_UNAVAILABLE', notPreparedHere(type, requires), {
            commandIndex: index, details: { reason: insertUnavailableReason(requires), requires },
          });
        }

        const prepared = await input.applier.prepareInsert(type, inserted?.data);

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

/**
 * The session's write batches in undo order. 'other' is a batch that wrote only
 * another document (a host action such as page.rename): the applier keeps no
 * step for it, so without this mark history.undo would undo the batch before it.
 */
export type HistoryMark = 'own' | 'other' | { restored: string | undefined };

export interface HistoryMarks { past: HistoryMark[]; future: HistoryMark[] }

const historyMarks = new WeakMap<AgentApplier, HistoryMarks>();

/** The live marks, so a session that outlives its applier (a Jint call) can carry them. */
export const marksOf = (applier: AgentApplier): HistoryMarks => {
  const found = historyMarks.get(applier);

  if (found !== undefined) {
    return found;
  }
  const marks: HistoryMarks = { past: [], future: [] };

  historyMarks.set(applier, marks);

  return marks;
};

/**
 * What a history step would unlock, from the step that will really run: a snapshot applier compares
 * documents, a native one reads the record kept on that step. Unknown means every locked database.
 */
const unlockedByStep = (applier: AgentApplier, name: 'history.undo' | 'history.redo'): readonly string[] => {
  const target = applier.historyTarget?.(name);

  if (target !== undefined) {
    return unlockedBetween(applier.snapshot(), target);
  }

  return applier.pendingUnlocks?.(name) ?? lockedDatabases(applier.snapshot());
};

/** What a history step would change in sharing. A step nobody can read is refused: the person must see what changes. */
const sharedByStep = (applier: AgentApplier, name: 'history.undo' | 'history.redo'): readonly ShareStep[] => {
  if (applier.historyTarget !== undefined) {
    const target = applier.historyTarget(name);

    // No target: no step, which undo and redo then refuse themselves.
    return target === undefined ? [] : sharedBetween(applier.snapshot(), target);
  }
  const shares = applier.pendingShares?.(name);

  if (shares === undefined) {
    throw failure('APPROVAL_REQUIRED', `It is not known what this ${name === 'history.undo' ? 'undo' : 'redo'} would change in who can see or fill out a view, so it was not run. Ask the person to do it themselves.`, {
      commandIndex: 0, details: { reason: 'no-channel' },
    });
  }

  return shares;
};

const staleStep = (): AgentFailure => failure('STALE', 'The history changed while the person decided, so nothing was undone or redone. Read the document again, then retry.', {
  commandIndex: 0,
});

/**
 * Undoing a lock or redoing an unlock asks like database.setLock does. Reads the document only when
 * there is something to ask. The yes covers that one step: if another step is on top once the person
 * answers, or the step now unlocks more, it is STALE.
 */
const approveHistoryStep = async (input: BatchInput, name: 'history.undo' | 'history.redo', expected: unknown): Promise<void> => {
  const unlocks = unlockedByStep(input.applier, name);
  const shares = sharedByStep(input.applier, name);

  if (unlocks.length === 0 && shares.length === 0) {
    return;
  }
  checkShareReachable(shares, input.ctx.services);
  const before = input.applier.snapshot();
  const asked = shares.map(step => shareRequest(step, before));

  await approveStep(unlocks, before, input.approve, () => checkCancel(input.signal));
  await approveRequests(asked, input.approve, () => checkCancel(input.signal));
  const keys = new Set(asked.map(approvalKey));
  const now = input.applier.snapshot();

  if (input.applier.historyStepId?.(name) !== expected || unlockedByStep(input.applier, name).some(id => !unlocks.includes(id))
    || sharedByStep(input.applier, name).some(step => !keys.has(approvalKey(shareRequest(step, now))))) {
    throw staleStep();
  }
};

const historyStep = (applier: AgentApplier, name: 'history.undo' | 'history.redo', expected: unknown): (() => Promise<void>) => {
  const step = name === 'history.undo' ? applier.undo : applier.redo;

  if (step === undefined) {
    throw failure('COMMAND_UNAVAILABLE', `${name} is not available here.`, {
      commandIndex: 0, details: { reason: 'runtime' },
    });
  }

  const marks = marksOf(applier);

  const last = marks.past.at(-1);

  if (name === 'history.undo' && last === 'other') {
    throw failure('UNDO_OTHER_DOCUMENT', 'The last batch wrote another document (a sub-page title or icon). history.undo cannot undo it. To revert it, run that command again with the old value.', {
      commandIndex: 0,
    });
  }
  if (typeof last === 'object') {
    // The applier's own redo step is from before the restore: replaying it would rewrite what the restore wrote.
    if (name === 'history.redo') {
      throw failure('NOTHING_TO_REDO', 'The last batch restored a version. There is nothing to redo after it.', { commandIndex: 0 });
    }
    throw failure('UNDO_RESTORED', `The last batch restored a version. history.undo cannot undo a restore.${
      last.restored === undefined ? '' : ` To go back, history.restore "${last.restored}", the version that was current before.`}`, {
      commandIndex: 0,
    });
  }

  return async () => {
    await step.call(applier, { expected });
    const [from, to] = name === 'history.undo' ? [marks.past, marks.future] : [marks.future, marks.past];

    to.push(from.pop() ?? 'own');
  };
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

type PlanningInput = Omit<BatchInput, 'log' | 'batchNo'>;

export type HostBatchPlan =
  | { result: Extract<AgentResult, { ok: false }> }
  | { result: Extract<AgentResult, { ok: true }>; plan: Plan; batch: AgentBatch; snapshot: DocSnapshot };

const checkCancel = (signal: AbortSignal | undefined, orphaned: HostReceipt[] = []): void => {
  if (signal?.aborted === true) {
    throw failure('CANCELLED', 'The turn was stopped before anything was written.',
      orphaned.length > 0 ? { details: { orphaned } } : {});
  }
};

const checkRevision = (
  checked: AgentBatch,
  revision: string,
  snapshot: () => DocSnapshot,
  ctx: BatchInput['ctx']
): void => {
  if (checked.expectRevision !== undefined && checked.expectRevision !== revision) {
    throw failure('STALE', 'The document changed since you read it. Read it again, then retry.', {
      details: { revision, current: staleContext(checked, snapshot(), ctx) },
    });
  }
};

const checkSource = (input: PlanningInput, checked: ReturnType<typeof checkEnvelope>): AgentBatch => {
  const batch = checked.batch;

  if (checked.writes && input.applier.isReadOnly()) {
    throw failure('READ_ONLY', 'The document is read-only now. Reads still work.');
  }
  checkRevision(batch, input.applier.revision(), () => input.applier.snapshot(), input.ctx);

  return batch;
};

/**
 * What a step changes in sharing each way. The write already landed, so a value that cannot be shown
 * (a person's own unreadable setting coming back on undo) leaves it unknown: undo and redo then refuse.
 */
const stepShares = (before: DocSnapshot, after: DocSnapshot): StepUnlocks['shares'] => {
  try {
    return { forward: sharedBetween(before, after), backward: sharedBetween(after, before) };
  } catch {
    return undefined;
  }
};

/**
 * Any command that changes who can see or fill out a view (not only updateView: a duplicate, an insert)
 * needs the person's yes for exactly that change, named from the document before the batch.
 */
const requireShareApprovals = (snapshot: DocSnapshot, draft: DocSnapshot, approved: ReadonlySet<string>, services: Partial<Record<string, unknown>>): void => {
  const steps = sharedBetween(snapshot, draft);

  checkShareReachable(steps, services);
  for (const step of steps) {
    const request = shareRequest(step, snapshot);

    if (!approved.has(approvalKey(request))) {
      throw approvalNeeded(request);
    }
  }
};

const pendingPlan = (
  input: PlanningInput,
  batch: AgentBatch,
  warnings: AgentWarning[],
  approved: ReadonlySet<string> = new Set()
): { plan: Plan; draft: DocSnapshot; snapshot: DocSnapshot; stamp: EditStamp; pending: boolean } => {
  const { by, with: coAuthor } = agentAttribution(input.actor);
  const stamp = { actorId: by ?? '', ...(coAuthor !== undefined && { with: coAuthor }), at: (input.now ?? Date.now)() };
  const pending = new Map<number, unknown>();

  batch.commands.forEach((command, index) => {
    const requires = typeof command.args.type === 'string'
      ? input.ctx.tools.get(command.args.type)?.entry.insertRequires : undefined;
    const insertPending = command.name === 'block.insert'
      && (command.args.demote === true || (requires?.length ?? 0) > 0);

    if (command.name === 'markdown.insert' || command.name === 'html.insert' || actionFor(input.ctx, command.name)?.prepare !== undefined || insertPending) {
      pending.set(index, PREPARE_PENDING);
    }
  });
  const snapshot = input.applier.snapshot();
  const { plan, draft } = planBatch({
    snapshot, batch, ctx: { ...input.ctx, prepared: pending, approved, committedTitle: id => savedTitle(snapshot.get(id)?.data) }, stamp, warnings,
  });

  requireShareApprovals(snapshot, draft, approved, input.ctx.services);

  return { plan, draft, snapshot, stamp, pending: pending.size > 0 };
};

// Enough rows to check a section; a bulk edit reads the rest with blok_read.
const CHANGED_ROWS_LIMIT = 50;

/** How the changed blocks read after the batch, so the model need not read again to check. */
const changedRows = (input: BatchInput, plan: Plan): Pick<Extract<AgentResult, { ok: true }>, 'blocks' | 'moreBlocks'> => {
  const { created, updated, moved } = plan.changed;
  const ids = new Set([...created, ...updated, ...moved]);

  if (ids.size === 0) {
    return {};
  }
  const { rows, more } = viewRows(input.applier.snapshot(), ids, input.ctx, CHANGED_ROWS_LIMIT);

  return { blocks: rows, ...(more > 0 && { moreBlocks: more }) };
};

const planResult = (
  batch: AgentBatch,
  plan: Plan,
  revision: string,
  warnings: AgentWarning[],
  rows: Pick<Extract<AgentResult, { ok: true }>, 'blocks' | 'moreBlocks'> = {}
): Extract<AgentResult, { ok: true }> => ({
  ok: true, revision,
  results: plan.results.map((result, index) =>
    batch.commands[index]?.name === 'doc.read' && isRecord(result) ? { ...result, revision } : result),
  refs: plan.refs, changed: plan.changed, ...rows,
  ...(plan.lastRange !== undefined && { lastRange: plan.lastRange }), warnings,
});

// Problems in the batch itself. A stale, read-only or runtime failure says nothing about the other commands.
const BATCH_PROBLEM_CODES: ReadonlySet<AgentErrorCode> = new Set<AgentErrorCode>([
  'INVALID_ARGS', 'UNKNOWN_COMMAND', 'COMMAND_UNAVAILABLE', 'BLOCK_NOT_FOUND', 'ANNOTATION_BLOCK', 'UNKNOWN_TOOL',
  'PLACEMENT_REFUSED', 'FIELD_NOT_WRITABLE', 'CONVERSION_UNSUPPORTED', 'DATA_REJECTED',
]);

/** The first error plus every other problem the batch is known to have, so one retry can fix them all. */
const withBatchProblems = (cause: AgentError, input: PlanningInput): AgentError => {
  if (!BATCH_PROBLEM_CODES.has(cause.code)) {
    return cause;
  }
  const others = [...cause.others ?? []];

  // DATA_REJECTED means every command planned and every write was checked, so nothing is left to find.
  if (cause.code !== 'DATA_REJECTED') {
    try {
      others.push(...preflightProblems(input.batch, input.ctx, () => input.applier.snapshot()));
    } catch {
      // The extra problems are a courtesy: never let them replace the real error.
    }
  }

  return withOthers(cause, others.sort((left, right) => (left.commandIndex ?? 0) - (right.commandIndex ?? 0)));
};

const batchFailure = (
  error: unknown,
  input: PlanningInput,
  warnings: AgentWarning[],
  orphaned: HostReceipt[] = []
): Extract<AgentResult, { ok: false }> => {
  const cause = error instanceof AgentFailure ? error.error
    : failure('APPLY_FAILED', `The document runtime failed: ${error instanceof Error ? error.message : String(error)}. The document may be partly changed; read it again.`).error;
  const failed = orphaned.length > 0 && cause.code !== 'CANCELLED'
    ? failure('ORPHANED_SIDE_EFFECT', `The batch failed after the host did work for it (${cause.message}). Clean up the listed items.`, {
      ...(cause.commandIndex !== undefined && { commandIndex: cause.commandIndex }),
      details: { orphaned, cause },
    }).error
    : withBatchProblems(cause, input);
  const revision = failureRevision(input.applier);

  return { ok: false, ...(revision !== undefined && { revision }), error: failed, warnings };
};

/** The last plan runs in the apply's turn, so it cannot stop to ask: a new ask means someone locked a database meanwhile. */
const finalPlan = <T>(plan: () => T, batch: AgentBatch, revision: string, snapshot: DocSnapshot, ctx: BatchInput['ctx']): T => {
  try {
    return plan();
  } catch (error) {
    if (error instanceof AgentFailure && error.error.code === 'APPROVAL_REQUIRED') {
      throw failure('STALE', 'The document changed while this batch waited. Read it again, then retry.', {
        details: { revision, current: staleContext(batch, snapshot, ctx) },
      });
    }
    throw error;
  }
};

/** Upload bytes run to ~133 MB a batch and the log is never trimmed, so it keeps their length only. Nothing replays from it. */
const withoutUploadBytes = (name: unknown, args: unknown): unknown => {
  if (typeof name !== 'string' || splitCommandName(name)?.action !== FILE_UPLOAD_ACTION || !isRecord(args) || typeof args.data !== 'string') {
    return args;
  }

  return { ...args, data: `<${args.data.length} base64 characters, not logged>` };
};

const loggedBatch = (batch: unknown): unknown => isRecord(batch) && Array.isArray(batch.commands)
  ? { ...batch, commands: batch.commands.map((command: unknown) =>
    isRecord(command) ? { ...command, args: withoutUploadBytes(command.name, command.args) } : command) }
  : batch;

export const runBatch = async (input: BatchInput): Promise<AgentResult> => {
  const warnings: AgentWarning[] = [];
  const orphaned: HostReceipt[] = [];
  const state: { batch?: AgentBatch } = {};

  const record = (results: unknown[] | null, error: AgentError | null): void => {
    const commands = state.batch?.commands;

    if (commands === undefined) {
      input.log.push({
        batch: input.batchNo, index: error?.commandIndex ?? 0, name: '', args: loggedBatch(input.batch),
        ...(error !== null && { error }), actorId: input.actor.id,
      });

      return;
    }
    commands.forEach((command, index) => input.log.push({
      batch: input.batchNo, index, name: command.name, args: withoutUploadBytes(command.name, command.args),
      ...(results !== null && { result: results[index] }),
      ...(error !== null && (error.commandIndex ?? 0) === index && { error }),
      actorId: input.actor.id,
    }));
  };

  try {
    checkCancel(input.signal);
    const checked = checkEnvelope(input.batch, input.ctx.commands, input.ctx.validate);
    const corrected = checked.warnings ?? [];

    warnings.push(...corrected);
    state.batch = checked.batch;
    const batch = checkSource(input, checked);

    const first = batch.commands[0];

    if (first?.name === 'history.undo' || first?.name === 'history.redo') {
      // The step checked, asked about and run is this one; the applier refuses another (STALE).
      const expected = input.applier.historyStepId?.(first.name);

      historyStep(input.applier, first.name, expected);
      await approveHistoryStep(input, first.name, expected);
      // Again after the question: a restore or another document's write may have landed meanwhile.
      const step = historyStep(input.applier, first.name, expected);

      checkCancel(input.signal, orphaned);
      await step();
      const revision = input.applier.revision();

      record([{}], null);

      return {
        ok: true, revision, results: [{}], refs: {},
        changed: { created: [], updated: [], moved: [], removed: [] }, warnings,
      };
    }

    const atCommand = (error: unknown): never => {
      throw error instanceof AgentFailure && error.error.commandIndex === undefined
        ? new AgentFailure({ ...error.error, commandIndex: 0, path: `/commands/0/args${error.error.path ?? ''}` })
        : error;
    };

    if (first?.name === 'history.restore') {
      const restored = await runRestore(first.args, input.ctx, () => input.applier.snapshot(), () => checkCancel(input.signal), input.approve)
        .catch(atCommand);
      const marks = marksOf(input.applier);

      marks.past.push({ restored: restored.result.previous });
      marks.future = [];
      await input.applier.settle?.();
      record([restored.result], null);

      return {
        ok: true, revision: input.applier.revision(), results: [restored.result], refs: {}, changed: restored.changed, warnings,
      };
    }

    if (first !== undefined && isVersionRead(first.name)) {
      const result = await runVersionCommand(first.name, first.args, input.ctx, () => input.applier.snapshot(), () => checkCancel(input.signal))
        .catch(atCommand);

      checkCancel(input.signal);
      record([result], null);

      return {
        ok: true, revision: input.applier.revision(), results: [result], refs: {},
        changed: { created: [], updated: [], moved: [], removed: [] }, warnings,
      };
    }

    // Asked before any prepare step, so a no leaves no host work behind. Kept for this batch only.
    const approved = new Set<string>();
    const pre = await planWithApprovals(granted => {
      warnings.splice(0, warnings.length, ...corrected);

      return pendingPlan(input, batch, warnings, granted);
    }, approved, input.approve, () => checkCancel(input.signal));
    const { plan: prePlan, stamp } = pre;
    const insertTypes = new Map<number, string>();
    const preparations = preparationsFor(input, batch, prePlan, orphaned, insertTypes);
    const prepared = new Map<number, unknown>();

    for (const [index, prepare] of preparations) {
      prepared.set(index, await prepareAt(prepare, index));
    }

    checkCancel(input.signal, orphaned);
    await input.applier.settle?.();

    // Keep the fresh snapshot and apply in the same synchronous turn.
    const snapshot = input.applier.snapshot();
    const current = input.applier.revision();

    checkRevision(batch, current, () => snapshot, input.ctx);

    // Only concrete warnings refer to the IDs that will be applied.
    // A read with nothing prepared, on the same snapshot object, would plan the same again, and a read
    // computes every row of a database. Relies on appliers never editing a snapshot in place
    // (document-session.ts); appliers that build a new snapshot per call always plan again.
    const reused = !checked.writes && !pre.pending && preparations.size === 0 && snapshot === pre.snapshot;

    if (!reused) {
      warnings.splice(0, warnings.length, ...corrected);
    }
    const { plan, draft } = reused ? pre : finalPlan(() => {
      const planned = planBatch({
        snapshot, batch, ctx: { ...input.ctx, prepared, approved, committedTitle: id => savedTitle(snapshot.get(id)?.data) }, stamp, warnings,
      });

      requireShareApprovals(snapshot, planned.draft, approved, input.ctx.services);

      return planned;
    }, batch, current, snapshot, input.ctx);

    checkCancel(input.signal, orphaned);
    batch.commands.forEach((command, index) => {
      if (command.name !== 'block.insert') {
        return;
      }
      const type = insertedBlock(plan, index).type;
      const preparedType = insertTypes.get(index);
      const requires = input.ctx.tools.get(type)?.entry.insertRequires;

      if (preparedType !== type && (preparedType !== undefined || (requires?.length ?? 0) > 0)) {
        throw failure('STALE', 'The insertion type changed during preparation. Read the document again, then retry.', {
          commandIndex: index, details: { revision: current, current: staleContext(batch, snapshot, input.ctx) },
        });
      }
    });
    const hostEffects = plan.hostEffects ?? [];

    // Fails closed: a write whose host hook cannot run here would land half of what the person's does.
    if (hostEffects.length > 0 && input.applier.runHostEffects === undefined) {
      throw failure('COMMAND_UNAVAILABLE', 'This command runs host hooks, which only the editor runs.', { details: { reason: 'runtime' } });
    }
    if (plan.edits.length > 0) {
      await input.applier.apply(plan, draft);
      const marks = marksOf(input.applier);

      marks.past.push('own');
      marks.future = [];
      const shares = stepShares(snapshot, draft);

      input.applier.recordUnlocks?.({
        forward: unlockedBetween(snapshot, draft),
        backward: unlockedBetween(draft, snapshot),
        ...(shares !== undefined && { shares }),
      });
    } else if (batch.commands.some(command => input.ctx.commands.get(command.name)?.effects === 'host')) {
      marksOf(input.applier).past.push('other');
    }
    // After the writes landed, as the person's click runs them; a turn stopped meanwhile runs none.
    if (hostEffects.length > 0 && input.signal?.aborted !== true) {
      input.applier.runHostEffects?.(hostEffects);
    }

    const result = planResult(batch, plan, input.applier.revision(), warnings, changedRows(input, plan));

    record(result.results, null);

    return result;
  } catch (error) {
    const result = batchFailure(error, input, warnings, orphaned);

    record(null, result.error);

    return result;
  }
};

export const planHostBatch = async (input: PlanningInput): Promise<HostBatchPlan> => {
  const warnings: AgentWarning[] = [];

  try {
    checkCancel(input.signal);
    const checked = checkEnvelope(input.batch, input.ctx.commands, input.ctx.validate);

    warnings.push(...checked.warnings ?? []);
    const batch = checkSource(input, checked);
    const command = batch.commands[0];
    const entry = command === undefined ? undefined : input.ctx.commands.get(command.name);

    // Only pending block actions bypass their run handler.
    if (command === undefined || entry === undefined || entry.effects !== 'host'
      || typeof entry.source !== 'object' || entry.source.target !== 'block'
      || actionFor(input.ctx, command.name)?.prepare === undefined) {
      throw failure('INVALID_ARGS', 'Host planning requires one prepared host action on a block.', {
        commandIndex: 0, path: '/commands/0/name',
      });
    }
    const { plan, snapshot } = pendingPlan(input, batch, warnings);

    checkCancel(input.signal);

    return { result: planResult(batch, plan, input.applier.revision(), warnings), plan, batch, snapshot };
  } catch (error) {
    return { result: batchFailure(error, input, warnings) };
  }
};

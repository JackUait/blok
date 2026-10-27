import { validateAgainst } from '../schema/validate';
import { agentAttribution } from './attribution';
import { plannerContextFrom } from './context';
import { describeContract } from './describe';
import { buildDocumentView } from './document-view';
import { checkEnvelope } from './envelope';
import { AgentFailure, failure, notPreparedHere } from './errors';
import { marksOf, planHostBatch, runBatch, type HistoryMark } from './executor';
import { contentRevision } from './revision';
import { DocSnapshot } from './snapshot';

import type { AgentActor, AgentExecuteOptions, AgentResult, AgentSession, CommandLogEntry, DocumentView, Edit, ViewArgs } from '../../../types/agent';
import type { OutputData } from '../../../types/data-formats/output-data';
import type { AgentContract } from '../../../types/tool-manifest';
import type { ToolRuntimeRegistry } from '../tool-actions/runtime';
import type { PageBackendService } from '../tool-actions/services';
import type { AgentApplier, HistoryBound, HostBatchPlan } from './executor';
import type { AgentPorts, SchemaValidator } from './types';

type ReadBlock = (blockId: string) => { type: string; data: Record<string, unknown> } | undefined;

export const createPageMapBackend = (
  open: NonNullable<AgentPorts['openPageDocument']>,
  actor: AgentActor,
  readBlock: ReadBlock
): PageBackendService => {
  const pageIdOf = (blockId: string): string => {
    const block = readBlock(blockId);

    if (block === undefined) {
      throw failure('BLOCK_NOT_FOUND', `No block "${blockId}".`, { details: { blockId } });
    }
    if (block.type !== 'page' || typeof block.data.pageId !== 'string') {
      throw failure('INVALID_ARGS', `Block "${blockId}" is not a page block with a pageId.`, { details: { blockId } });
    }

    return block.data.pageId;
  };

  const write = async (
    blockId: string,
    name: 'doc.setTitle' | 'doc.setIcon',
    args: Record<string, unknown>
  ): Promise<{ pageId: string; applied: true }> => {
    const pageId = pageIdOf(blockId);
    const session = await open(pageId, actor);

    try {
      const result = await session.execute({ commands: [{ name, args }] });

      if (!result.ok) {
        throw new AgentFailure(result.error);
      }
    } catch (error) {
      throw error instanceof AgentFailure
        ? new AgentFailure({ ...error.error, details: { ...error.error.details, pageId } })
        : error;
    } finally {
      session.close();
    }

    return { pageId, applied: true };
  };

  return {
    rename: ({ blockId, title }) => write(blockId, 'doc.setTitle', { title }),
    setIcon: ({ blockId, icon }) => write(blockId, 'doc.setIcon', { icon }),
  };
};

const sessionCount = { value: 0 };

/**
 * How many undo steps an agent session keeps, and how many characters of document JSON
 * its snapshots may hold. The oldest steps go first; the newest is always kept.
 * Packages/server/dotnet BlokAgentSession.cs trims to the same numbers.
 */
export const AGENT_HISTORY_LIMITS = { steps: 100, bytes: 4 * 1024 * 1024 } as const;

type HistoryMarksList = HistoryMark[];

const lostHistory = (): Error => failure('CONFLICT', "Someone else saved this document after this session's last step, so its steps can no longer be undone or redone. Read the document again.");

/** A session's undo and redo steps, oldest first: the document before a step, or 'other' when a step wrote elsewhere. */
export interface CarriedHistory {
  past: Array<OutputData | 'other'>;
  future: Array<OutputData | 'other'>;
  /** Someone else wrote after an earlier step, so the steps before it were dropped. */
  lost?: boolean;
}

/** A headless applier's prepareInsert for a host that creates page documents. */
export const pagePrepareInsert = (
  createPage: NonNullable<AgentPorts['createPageDocument']>,
  actor: AgentActor
): NonNullable<AgentApplier['prepareInsert']> => async (type) => {
  if (type !== 'page') {
    throw failure('COMMAND_UNAVAILABLE', notPreparedHere(type, []), { details: { reason: 'runtime' } });
  }

  // Only the pageId: the planned data keeps the rest, and a host id must win over one the agent wrote.
  return { pageId: (await createPage(actor)).pageId };
};

export const createDocumentAgentSession = (input: {
  document: OutputData;
  tools: ToolRuntimeRegistry;
  contract: AgentContract;
  actor: AgentActor;
  ports: AgentPorts;
  services?: Partial<Record<string, unknown>>;
  pageTitles?: 'page-map';
  validate?: SchemaValidator;
  runtime?: 'node' | 'jint';
  /** Steps an earlier session of this agent left. */
  history?: CarriedHistory;
}): AgentSession & {
  output(): OutputData;
  revision(): string;
  lastEdits(): readonly Edit[];
  history(): CarriedHistory;
  execute(batch: unknown, options?: AgentExecuteOptions): Promise<AgentResult>;
  planHost(batch: unknown, options?: { signal?: AbortSignal }): Promise<HostBatchPlan & { view?: DocumentView }>;
} => {
  const id = `doc-session-${++sessionCount.value}`;
  const log: CommandLogEntry[] = [];
  const past: DocSnapshot[] = [];
  const future: DocSnapshot[] = [];
  const applied: { edits: readonly Edit[] } = { edits: [] };
  const state = {
    current: DocSnapshot.fromOutput(input.document),
    closed: false,
    batchNo: 0,
  };
  const hashed: { snapshot: DocSnapshot | null; revision: string } = { snapshot: null, revision: '' };
  const services: Partial<Record<string, unknown>> = { ...(input.services ?? {}) };

  if (input.pageTitles === 'page-map' && input.ports.openPageDocument !== undefined) {
    services.pageBackend = createPageMapBackend(input.ports.openPageDocument, input.actor, blockId => state.current.get(blockId));
  }
  const ctx = plannerContextFrom(input.contract, input.tools, input.ports, input.validate ?? validateAgainst, services);
  const createPage = input.pageTitles === 'page-map' ? input.ports.createPageDocument : undefined;

  const applier: AgentApplier = {
    runtime: input.runtime ?? 'node',
    isReadOnly: () => state.closed,
    snapshot: () => state.current,
    // Planning, validation and document views edit clones, so state.current never changes in place
    // and its hash holds until it is replaced. Execute result rows share block data by reference:
    // callers must not change them.
    revision: () => {
      if (hashed.snapshot !== state.current) {
        hashed.revision = contentRevision(state.current.toOutput());
        hashed.snapshot = state.current;
      }

      return hashed.revision;
    },
    ...(createPage !== undefined && { prepareInsert: pagePrepareInsert(createPage, input.actor) }),
    apply: (plan, draft) => {
      // Undo here restores a whole earlier document, which would take the comments with it.
      if (plan.commentsOnly === true) {
        past.length = 0;
      } else {
        past.push(state.current);
      }
      future.length = 0;
      state.current = draft;
      applied.edits = plan.edits;

      return Promise.resolve();
    },
    historyStepId: name => (name === 'history.undo' ? past.at(-1) : future.at(-1)),
    undo: (bound?: HistoryBound) => {
      if (bound !== undefined && past.at(-1) !== bound.expected) {
        return Promise.reject(failure('STALE', 'Another step is the last one now, so nothing was undone. Read the document again, then retry.'));
      }
      const previous = past.pop();

      if (previous === undefined) {
        return Promise.reject(input.history?.lost === true ? lostHistory() : failure('NOTHING_TO_UNDO', 'This session has no step to undo.'));
      }
      future.push(state.current);
      state.current = previous;

      return Promise.resolve();
    },
    historyTarget: name => (name === 'history.undo' ? past.at(-1) : future.at(-1)),
    redo: (bound?: HistoryBound) => {
      if (bound !== undefined && future.at(-1) !== bound.expected) {
        return Promise.reject(failure('STALE', 'Another step is next now, so nothing was redone. Read the document again, then retry.'));
      }
      const next = future.pop();

      if (next === undefined) {
        return Promise.reject(input.history?.lost === true ? lostHistory() : failure('NOTHING_TO_REDO', 'This session has no undone step to redo.'));
      }
      past.push(state.current);
      state.current = next;

      return Promise.resolve();
    },
  };

  if (input.history !== undefined) {
    const marks = marksOf(applier);
    const seed = (entries: CarriedHistory['past'], snapshots: DocSnapshot[], kinds: HistoryMarksList): void => {
      for (const entry of entries) {
        kinds.push(entry === 'other' ? 'other' : 'own');
        if (entry !== 'other') {
          snapshots.push(DocSnapshot.fromOutput(entry));
        }
      }
    };

    seed(input.history.past, past, marks.past);
    seed(input.history.future, future, marks.future);
  }

  const sizes = new WeakMap<DocSnapshot, number>();
  const sizeOf = (snapshot: DocSnapshot): number => {
    const known = sizes.get(snapshot);

    if (known !== undefined) {
      return known;
    }
    const size = JSON.stringify(snapshot.toOutput()).length;

    sizes.set(snapshot, size);

    return size;
  };
  // Runs after the executor marked the batch, so marks and snapshots move together.
  const trimHistory = (): void => {
    const marks = marksOf(applier);
    const steps = (): number => marks.past.length + marks.future.length;
    const bytes = (): number => [...past, ...future].reduce((sum, snapshot) => sum + sizeOf(snapshot), 0);

    while (steps() > AGENT_HISTORY_LIMITS.steps || (steps() > 1 && bytes() > AGENT_HISTORY_LIMITS.bytes)) {
      const [kinds, snapshots] = marks.past.length > 0 ? [marks.past, past] : [marks.future, future];

      if (kinds.shift() === 'own') {
        snapshots.shift();
      }
    }
  };

  trimHistory();

  const carried = (kinds: HistoryMarksList, snapshots: readonly DocSnapshot[]): CarriedHistory['past'] => {
    const next = { index: 0 };

    return kinds.map(kind => {
      // A restore keeps no snapshot; carried on, it refuses undo as any write elsewhere does.
      const snapshot = kind === 'own' ? snapshots[next.index++] : undefined;

      if (kind === 'own' && snapshot === undefined) {
        throw new Error('Each own step has a snapshot.');
      }

      return snapshot?.toOutput() ?? 'other';
    });
  };

  return {
    id,
    actor: input.actor,
    read: async (args: ViewArgs = {}): Promise<DocumentView> => {
      checkEnvelope({ commands: [{ name: 'doc.read', args: { ...args } }] }, ctx.commands, ctx.validate);

      return buildDocumentView(state.current, args, ctx, applier.revision(), agentAttribution(input.actor).by);
    },
    history: () => {
      const marks = marksOf(applier);

      return {
        past: carried(marks.past, past), future: carried(marks.future, future),
        ...(input.history?.lost === true && { lost: true }),
      };
    },
    describe: query => describeContract(input.contract, query),
    execute: async (batch: unknown, options: AgentExecuteOptions = {}) => {
      applied.edits = [];
      const result = await runBatch({
        batch, ctx, applier, actor: input.actor, signal: options.signal, approve: options.approve, log, batchNo: ++state.batchNo,
      });

      trimHistory();

      return result;
    },
    planHost: async (batch: unknown, options: { signal?: AbortSignal } = {}) => {
      const planned = await planHostBatch({
        batch, ctx, applier, actor: input.actor, signal: options.signal,
      });

      if (!('plan' in planned)) {
        return planned;
      }
      const id = planned.batch.commands[0]?.args.id;

      if (typeof id !== 'string') {
        throw new Error('The validated host plan has no block ID.');
      }

      return {
        ...planned,
        view: buildDocumentView(planned.snapshot, { ids: [id], detail: 'full' }, ctx, planned.result.revision),
      };
    },
    log: () => [...log],
    close: () => {
      state.closed = true;
    },
    output: () => state.current.toOutput(),
    revision: () => applier.revision(),
    lastEdits: () => applied.edits,
  };
};

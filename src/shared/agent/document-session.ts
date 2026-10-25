import { validateAgainst } from '../schema/validate';
import { plannerContextFrom } from './context';
import { describeContract } from './describe';
import { buildDocumentView } from './document-view';
import { checkEnvelope } from './envelope';
import { AgentFailure, failure, notPreparedHere } from './errors';
import { planHostBatch, runBatch } from './executor';
import { contentRevision } from './revision';
import { DocSnapshot } from './snapshot';

import type { AgentActor, AgentResult, AgentSession, CommandLogEntry, DocumentView, Edit, ViewArgs } from '../../../types/agent';
import type { OutputData } from '../../../types/data-formats/output-data';
import type { AgentContract } from '../../../types/tool-manifest';
import type { ToolRuntimeRegistry } from '../tool-actions/runtime';
import type { PageBackendService } from '../tool-actions/services';
import type { AgentApplier, HostBatchPlan } from './executor';
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
}): AgentSession & {
  output(): OutputData;
  revision(): string;
  lastEdits(): readonly Edit[];
  execute(batch: unknown, options?: { signal?: AbortSignal }): Promise<AgentResult>;
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
    ...(createPage !== undefined && {
      // Only the pageId: the planned data keeps the rest, and a host id must win over one the agent wrote.
      prepareInsert: async (type: string) => {
        if (type !== 'page') {
          throw failure('COMMAND_UNAVAILABLE', notPreparedHere(type), { details: { reason: 'runtime' } });
        }

        return { pageId: (await createPage(input.actor)).pageId };
      },
    }),
    apply: (plan, draft) => {
      past.push(state.current);
      future.length = 0;
      state.current = draft;
      applied.edits = plan.edits;

      return Promise.resolve();
    },
    undo: () => {
      const previous = past.pop();

      if (previous === undefined) {
        return Promise.reject(failure('NOTHING_TO_UNDO', 'This session has no step to undo.'));
      }
      future.push(state.current);
      state.current = previous;

      return Promise.resolve();
    },
    redo: () => {
      const next = future.pop();

      if (next === undefined) {
        return Promise.reject(failure('NOTHING_TO_UNDO', 'This session has no undone step to redo.'));
      }
      past.push(state.current);
      state.current = next;

      return Promise.resolve();
    },
  };

  return {
    id,
    actor: input.actor,
    read: async (args: ViewArgs = {}): Promise<DocumentView> => {
      checkEnvelope({ commands: [{ name: 'doc.read', args: { ...args } }] }, ctx.commands, ctx.validate);

      return buildDocumentView(state.current, args, ctx, applier.revision());
    },
    describe: query => describeContract(input.contract, query),
    execute: (batch: unknown, options: { signal?: AbortSignal } = {}) => {
      applied.edits = [];

      return runBatch({
        batch, ctx, applier, actor: input.actor, signal: options.signal, log, batchNo: ++state.batchNo,
      });
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

import { validateAgainst } from '../schema/validate';
import { plannerContextFrom } from './context';
import { describeContract } from './describe';
import { buildDocumentView } from './document-view';
import { checkEnvelope } from './envelope';
import { AgentFailure, failure } from './errors';
import { runBatch } from './executor';
import { contentRevision } from './revision';
import { DocSnapshot } from './snapshot';

import type { AgentActor, AgentSession, CommandLogEntry, DocumentView, ViewArgs } from '../../../types/agent';
import type { OutputData } from '../../../types/data-formats/output-data';
import type { AgentContract } from '../../../types/tool-manifest';
import type { ToolRuntimeRegistry } from '../tool-actions/runtime';
import type { PageBackendService } from '../tool-actions/services';
import type { AgentApplier } from './executor';
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
}): AgentSession & { output(): OutputData } => {
  const id = `doc-session-${++sessionCount.value}`;
  const log: CommandLogEntry[] = [];
  const past: DocSnapshot[] = [];
  const future: DocSnapshot[] = [];
  const state = {
    current: DocSnapshot.fromOutput(input.document),
    closed: false,
    batchNo: 0,
  };
  const services: Partial<Record<string, unknown>> = { ...(input.services ?? {}) };

  if (input.pageTitles === 'page-map' && input.ports.openPageDocument !== undefined) {
    services.pageBackend = createPageMapBackend(input.ports.openPageDocument, input.actor, blockId => state.current.get(blockId));
  }
  const ctx = plannerContextFrom(input.contract, input.tools, input.ports, input.validate ?? validateAgainst, services);

  const applier: AgentApplier = {
    runtime: input.runtime ?? 'node',
    isReadOnly: () => state.closed,
    snapshot: () => state.current,
    revision: () => contentRevision(state.current.toOutput()),
    apply: (_plan, draft) => {
      past.push(state.current);
      future.length = 0;
      state.current = draft;

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
    execute: (batch, options = {}) => runBatch({
      batch, ctx, applier, actor: input.actor, signal: options.signal, log, batchNo: ++state.batchNo,
    }),
    log: () => [...log],
    close: () => {
      state.closed = true;
    },
    output: () => state.current.toOutput(),
  };
};

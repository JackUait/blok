import type { AgentBatch, AgentSession } from '../../types/agent';
import type { OutputData } from '../../types/data-formats/output-data';
import type { AgentContract } from '../../types/tool-manifest';

import { failedResult, isMcpSurfaceError, isWriteBatch, NO_DELIVERY, surfaceError } from './errors';
import type { HandleSession, McpExecuteResult } from './session';
import type { DocumentSource } from './sources/types';

type StoredAgent = AgentSession & { output(): OutputData; revision(): string };

export interface StoredSessionInput {
  documentId: string;
  write: boolean;
  source: DocumentSource;
  contract: AgentContract;
  /** 01's loader: rich fields holding HTML become segments (src/html). */
  loadDocument(raw: unknown): OutputData;
  /** 01's createDocumentAgentSession, bound to tools, contract, actor and ports. */
  createAgentSession(document: OutputData): StoredAgent;
}

export const openStoredSession = async (input: StoredSessionInput): Promise<HandleSession> => {
  const readOnlyByName = new Map(input.contract.commands.map((entry) => [entry.name, entry.readOnly]));
  const writes = (batch: AgentBatch): boolean => isWriteBatch(batch, readOnlyByName);

  const load = async (): Promise<{ agent: StoredAgent; version: string | null; missing: boolean }> => {
    const loaded = await input.source.load(input.documentId);

    return {
      agent: input.createAgentSession(input.loadDocument(loaded.raw)),
      version: loaded.version,
      missing: loaded.missing === true,
    };
  };
  const first = await load();
  const state: { agent: StoredAgent; version: string | null; stale: boolean } = { agent: first.agent, version: first.version, stale: false };

  const reload = async (): Promise<void> => {
    const loaded = await load();

    state.agent = loaded.agent;
    state.version = loaded.version;
    state.stale = false;
  };

  return {
    mode: 'stored',
    write: input.write,
    durability: 'saved-on-execute',
    contractRevision: input.contract.revision,
    exists: !first.missing,
    read: async (args) => {
      if (state.stale) {
        await reload();
      }

      return state.agent.read(args);
    },
    describe: (query) => state.agent.describe(query),
    execute: async (batch, options = {}): Promise<McpExecuteResult> => {
      if (state.stale) {
        await reload();
      }
      const writing = writes(batch);

      if (writing && !input.write) {
        return failedResult(surfaceError('READ_ONLY', 'This handle is read-only. Open the document with write: true.').agentError);
      }
      // result.revision is the session's own hash; equal means nothing changed here.
      const before = state.agent.revision();
      const result = await state.agent.execute(batch, options);

      // An unchanged write (page.rename edits another document) has nothing to save.
      if (!result.ok || !writing || result.revision === before) {
        return { ...result, delivery: NO_DELIVERY };
      }
      try {
        const saved = await input.source.save(input.documentId, state.agent.output(), { ifVersion: state.version });

        state.version = saved.version;

        return { ...result, delivery: { durable: true, pending: false, serverSequence: null, savedVersion: saved.version } };
      } catch (thrown) {
        // Memory must match the source: drop the refused work. A failed reload retries on the next call.
        state.stale = true;
        await reload().catch(() => undefined);
        if (!isMcpSurfaceError(thrown)) {
          throw thrown;
        }

        return failedResult(thrown.agentError, result.warnings);
      }
    },
    close: async () => ({ unsavedBatches: 0, hostRecordLags: false }),
  };
};

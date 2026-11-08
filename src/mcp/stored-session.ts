import type { AgentActor, AgentBatch, AgentSession } from '../../types/agent';
import type { OutputData } from '../../types/data-formats/output-data';
import type { AgentContract } from '../../types/tool-manifest';

import { carriedHistory } from '../shared/agent/carried-history';
import type { CarriedHistory } from '../shared/agent/document-session';
import { tooDeepToSave } from '../shared/mcp/wire-json';

import { orphanedBySave, reportOrphanedPages } from './create-page';
import { failedResult, isMcpSurfaceError, isWriteBatch, NO_DELIVERY, surfaceError } from './errors';
import type { BlokMcpHandleRecord } from './options';
import type { HandleSession, McpExecuteResult } from './session';
import type { DocumentSource } from './sources/types';

type StoredAgent = AgentSession & { output(): OutputData; revision(): string; history?(): CarriedHistory; contentRevision?(): string };

/** Who opened the handle: a restored session works for them, whoever calls now. */
export interface StoredOwner {
  principal: string;
  clientName: string;
  scopes: readonly string[] | null;
  actor: AgentActor;
}

export interface StoredSessionInput {
  documentId: string;
  write: boolean;
  source: DocumentSource;
  contract: AgentContract;
  /** 01's loader: rich fields holding HTML become segments (src/html). */
  loadDocument(raw: unknown): OutputData;
  /** 01's createDocumentAgentSession, bound to tools, contract, actor and ports. */
  createAgentSession(document: OutputData, history?: CarriedHistory): StoredAgent;
  /** Set when the handle may go into a shared handle store: the session then has snapshot(). */
  owner?: StoredOwner;
  /** The page ids the agent's page port made; filled by the port, emptied here before each batch. */
  madePages?: string[];
}

interface StoredState { agent: StoredAgent; version: string | null; stale: boolean }

const isDocument = (value: unknown): value is OutputData =>
  typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'blocks'));

const loadFrom = async (input: StoredSessionInput): Promise<{ agent: StoredAgent; version: string | null; missing: boolean }> => {
  const loaded = await input.source.load(input.documentId);

  return {
    agent: input.createAgentSession(input.loadDocument(loaded.raw)),
    version: loaded.version,
    missing: loaded.missing === true,
  };
};

export const openStoredSession = async (input: StoredSessionInput): Promise<HandleSession> => {
  const first = await loadFrom(input);

  return storedSession(input, { agent: first.agent, version: first.version, stale: false }, !first.missing);
};

/**
 * A handle a shared store kept, rebuilt without a load: the record carries the document. Its steps
 * hold only while their revision is the document's, as the bundle checks them (carriedHistory).
 */
export const restoreStoredSession = (input: StoredSessionInput, record: BlokMcpHandleRecord): HandleSession => {
  const document = input.loadDocument(record.document);
  const history = carriedHistory(record.history, document, (raw) => input.loadDocument(raw), isDocument);

  return storedSession(input, { agent: input.createAgentSession(document, history), version: record.version, stale: record.stale }, true);
};

const storedSession = (input: StoredSessionInput, initial: StoredState, exists: boolean): HandleSession => {
  const state: StoredState = { ...initial };
  const readOnlyByName = new Map(input.contract.commands.map((entry) => [entry.name, entry.readOnly]));
  const writes = (batch: AgentBatch): boolean => isWriteBatch(batch, readOnlyByName);

  const reload = async (): Promise<void> => {
    const loaded = await loadFrom(input);

    state.agent = loaded.agent;
    state.version = loaded.version;
    state.stale = false;
  };

  // A save can store the parent before it breaks, so the reload shows which pages it names. Unread: report none.
  const brokenSave = (thrown: unknown, reloaded: boolean, warnings: McpExecuteResult['warnings']): McpExecuteResult => {
    const orphaned = reloaded ? orphanedBySave(input.madePages ?? [], state.agent.output(), warnings) : null;

    if (orphaned === null) {
      throw thrown;
    }
    // stdout carries the protocol, so the log goes to stderr.
    console.error('blok-mcp: a save broke after the batch made pages', thrown);

    return { ...orphaned, delivery: NO_DELIVERY };
  };

  const owner = input.owner;

  return {
    mode: 'stored',
    write: input.write,
    durability: 'saved-on-execute',
    contractRevision: input.contract.revision,
    exists,
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
      input.madePages?.splice(0);
      // result.revision is the session's own hash; equal means nothing changed here.
      const before = state.agent.revision();
      // A failed batch wrote nothing, so memory is the parent as saved.
      const result = await state.agent.execute(batch, options).then((ran) => reportOrphanedPages(ran, state.agent.output()));

      // An unchanged write (page.rename edits another document) has nothing to save.
      if (!result.ok || !writing || result.revision === before) {
        return { ...result, delivery: NO_DELIVERY };
      }
      // A file this deep is one no port could open again. Memory drops the work, as after a refused save.
      const tooDeep = tooDeepToSave(state.agent.output());

      if (tooDeep !== null) {
        state.stale = true;
        await reload().catch(() => undefined);

        return failedResult(tooDeep.agentError, result.warnings);
      }
      try {
        const saved = await input.source.save(input.documentId, state.agent.output(), { ifVersion: state.version });

        state.version = saved.version;

        return { ...result, delivery: { durable: true, pending: false, serverSequence: null, savedVersion: saved.version } };
      } catch (thrown) {
        // Memory must match the source: drop the refused work. A failed reload retries on the next call.
        state.stale = true;
        const reloaded = await reload().then(() => true, () => false);

        if (!isMcpSurfaceError(thrown)) {
          return brokenSave(thrown, reloaded, result.warnings);
        }

        return failedResult(thrown.agentError, result.warnings);
      }
    },
    close: async () => ({ unsavedBatches: 0, hostRecordLags: false }),
    ...(owner !== undefined && { snapshot: () => snapshotOf(input, owner, state) }),
  };
};

const snapshotOf = (input: StoredSessionInput, owner: StoredOwner, state: StoredState): BlokMcpHandleRecord => {
  const { history, contentRevision } = state.agent;

  if (history === undefined || contentRevision === undefined) {
    throw new Error('blok-mcp: a stored agent without history() cannot go into a handle store');
  }

  return {
    v: 1,
    contractRevision: input.contract.revision,
    principal: owner.principal,
    clientName: owner.clientName,
    scopes: owner.scopes,
    actor: owner.actor,
    documentId: input.documentId,
    write: input.write,
    version: state.version,
    stale: state.stale,
    document: state.agent.output(),
    history: { ...history.call(state.agent), revision: contentRevision.call(state.agent) },
  };
};

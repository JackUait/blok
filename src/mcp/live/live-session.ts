import type { HeadlessRoom, HeadlessRoomEnd } from '../../components/modules/collaboration/headless-session';
import type { CollabTerminalError } from '../../components/modules/collaboration/types';
import type { AgentContract } from '../../../types/tool-manifest';
import type { AgentBatch, AgentError, AgentResult, AgentSession } from '../../../types/agent';
import { failedResult, NO_DELIVERY, surfaceError } from '../errors';
import type { HandleSession, McpExecuteResult } from '../session';

export interface PresenceSink { announce(): void; afterBatch(result: AgentResult): void; clear(): void }

export interface LiveSessionInput {
  room: HeadlessRoom;
  agent: AgentSession;
  contract: AgentContract;
  presence: PresenceSink;
  write: boolean;
  ackTimeoutMs?: number;
}

const DEFAULT_ACK_TIMEOUT_MS = 10_000;

export const terminalToError = (error: CollabTerminalError | undefined): AgentError => {
  if (error === 'unsupported-format') {
    return surfaceError('VERSION_SKEW', 'The room uses a newer document format. Upgrade @bloklabs/mcp to the server family version.').agentError;
  }
  if (error === 'forbidden' || error === 'unauthorized') {
    return surfaceError('FORBIDDEN', 'The room refused this agent. Its ticket may not grant this document.').agentError;
  }

  return surfaceError('SOURCE_UNAVAILABLE', 'The room connection stopped for good. Open the document again.', { terminal: error ?? 'unknown' }).agentError;
};

export const createLiveSession = (input: LiveSessionInput): HandleSession => {
  const { room } = input;
  const ackTimeoutMs = input.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
  const readOnlyByName = new Map(input.contract.commands.map((entry) => [entry.name, entry.readOnly]));
  const state = { readOnly: !input.write, batch: 0 };
  // Batch number -> its row ids, while any row is still unacknowledged.
  const unacked = new Map<number, string[]>();

  const notSaved = (): number[] => {
    const pending = new Set(room.outbox.pendingIds());

    for (const [batch, ids] of unacked) {
      if (ids.every((id) => !pending.has(id))) {
        unacked.delete(batch);
      }
    }

    return [...unacked.keys()];
  };

  const endError = (end: HeadlessRoomEnd): AgentError => (end.reason === 'reset'
    ? surfaceError('ROOM_RESET', "The room's history was reset. Work not acknowledged is lost; open the document again.", { notSavedBatches: notSaved() }).agentError
    : terminalToError(end.error));

  input.presence.announce();

  const execute = async (batch: AgentBatch): Promise<McpExecuteResult> => {
    const end = room.ended();

    if (end !== null) {
      return failedResult(endError(end));
    }
    // Unknown names do not count as writes; 01 answers them with UNKNOWN_COMMAND.
    const writing = batch.commands.some((command) => readOnlyByName.get(command.name) === false);

    if (writing && state.readOnly) {
      return failedResult(surfaceError('READ_ONLY', 'This handle cannot write to the room.').agentError);
    }
    const mark = room.outbox.appendedCount();
    const failuresBefore = room.appendFailures();
    const result = await input.agent.execute(batch);

    if (!result.ok) {
      if (result.error.code === 'APPLY_FAILED') {
        state.readOnly = true;
      }

      return { ...result, delivery: NO_DELIVERY };
    }
    input.presence.afterBatch(result);
    if (!writing || room.protocol === 'v1') {
      return { ...result, delivery: NO_DELIVERY };
    }
    await room.flushAppends();
    // A write the tap could not journal is in our doc but will never reach the
    // room. Its row is missing from idsSince, so waitFor would call it acked.
    if (room.appendFailures() !== failuresBefore) {
      state.readOnly = true;

      return failedResult(surfaceError(
        'APPLY_FAILED',
        'The batch changed the local copy but could not be queued for the room. It was not saved; open the document again.',
        { stage: 'journal' }
      ).agentError, result.warnings);
    }
    const ids = room.outbox.idsSince(mark);

    state.batch += 1;
    const number = state.batch;

    unacked.set(number, ids);
    const fate = await room.outbox.waitFor(ids, ackTimeoutMs);

    if (fate.state === 'acked') {
      unacked.delete(number);

      return { ...result, delivery: { durable: true, pending: false, serverSequence: fate.serverSequence, savedVersion: null } };
    }
    if (fate.state === 'timeout') {
      return { ...result, delivery: { durable: false, pending: true, serverSequence: null, savedVersion: null } };
    }
    unacked.delete(number);
    if (fate.reason === 'read-only') {
      state.readOnly = true;

      return failedResult(surfaceError('READ_ONLY', 'The room refused the write: this agent may only read. The batch was not saved.').agentError, result.warnings);
    }
    if (fate.reason === 'lineage-reset') {
      return failedResult(endError({ reason: 'reset' }), result.warnings);
    }

    return failedResult(surfaceError('REJECTED', 'The room refused this batch. It was not saved.', { rejectionCode: fate.reason }).agentError, result.warnings);
  };

  return {
    mode: 'live',
    write: input.write,
    get durability() {
      return room.protocol === 'v2' ? 'acknowledged' : 'best-effort';
    },
    contractRevision: input.contract.revision,
    read: async (args) => {
      const end = room.ended();

      if (end !== null) {
        const error = endError(end);

        throw surfaceError(error.code, error.message, error.details);
      }

      return input.agent.read(args);
    },
    describe: (query) => input.agent.describe(query),
    execute,
    close: async () => {
      const summary = { unsavedBatches: notSaved().length, hostRecordLags: room.protocol === 'v2' };

      input.presence.clear();
      input.agent.close();
      await room.close();

      return summary;
    },
  };
};

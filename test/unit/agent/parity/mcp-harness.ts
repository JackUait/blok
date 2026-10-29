import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'vitest';

import { decode, encode } from '../../../../src/components/modules/collaboration/sync-wire';
import type { CollabSocketFactory, SyncWireFrame, WebSocketLike, WorkingSetTag } from '../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { readPageFields } from '../../../../src/components/modules/yjs/page-fields';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { buildMcpContracts } from '../../../../src/mcp/contract';
import type { Caller } from '../../../../src/mcp/dispatcher';
import { assembleMcp, type AssembledMcp } from '../../../../src/mcp/server';
import { loadStoredDocument } from '../../../../src/view/agent-runtime';
import { htmlToSegmentsNode } from '../../../../src/view/rich-text-node';
import type { OutputData } from '../../../../types';
import type { AgentActor } from '../../../../types/agent';
import { openJsonSession, TEST_ACTOR } from '../harness';
import { caseStrings, projectAnswers, recordAnswers, referenceAnswers } from './answers';
import type { CorpusBatch, McpRunnerName, ParityCase } from './corpus';
import { callerChosenIds, expectationFor, mcpExemption } from './corpus';
import { normalizeForParity } from './normalize';
import { compareToGolden, runCorpusCase } from './run-case';

export const MCP_CALLER: Caller = { principal: 'alice', clientName: 'parity', scopes: null };

// Files-source ids allow letters, digits, ".", "_" and "-", so corpus names cannot be the id.
const DOCUMENT_ID = 'doc';

export interface McpRun {
  /** What blok_open answered. */
  opened: Record<string, unknown>;
  /** blok_execute through the dispatcher; the answer the model sees, delivery included. */
  execute(batch: CorpusBatch): Promise<{ ok: boolean; error?: { code: string }; answer: Record<string, unknown> }>;
  /** The document the server side holds now. */
  output(): OutputData;
  close(): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const errorCodeOf = (answer: Record<string, unknown>): string | undefined =>
  isRecord(answer.error) && typeof answer.error.code === 'string' ? answer.error.code : undefined;

const runOn = async (mcp: AssembledMcp, mode: 'stored' | 'live'): Promise<Omit<McpRun, 'output' | 'close'>> => {
  const opened = (await mcp.dispatch('blok_open', { documentId: DOCUMENT_ID, mode, write: true }, MCP_CALLER)).structuredContent;
  const handle = opened.handle;

  if (typeof handle !== 'string') {
    throw new Error(`blok_open did not return a handle: ${JSON.stringify(opened)}`);
  }

  return {
    opened,
    execute: async (batch) => {
      const outcome = await mcp.dispatch('blok_execute', { handle, commands: batch.commands }, MCP_CALLER);
      const answer = outcome.structuredContent;
      const code = errorCodeOf(answer);

      return { ok: answer.ok === true, ...(code !== undefined && { error: { code } }), answer };
    },
  };
};

const isOutputData = (value: unknown): value is OutputData => isRecord(value) && Array.isArray(value.blocks);

/** blok-mcp as `blok-mcp --source files`, with the seed saved as the one document. */
export const openMcpStored = async (seed: OutputData, actor: AgentActor): Promise<McpRun> => {
  const dir = mkdtempSync(join(tmpdir(), 'blok-mcp-parity-'));
  const file = join(dir, `${DOCUMENT_ID}.json`);

  writeFileSync(file, JSON.stringify(seed));
  const mcp = assembleMcp({
    transport: { kind: 'stdio' },
    auth: { kind: 'none' },
    source: { kind: 'files', dir },
    agentActor: () => actor,
  });

  try {
    return {
      ...await runOn(mcp, 'stored'),
      output: () => {
        const saved: unknown = JSON.parse(readFileSync(file, 'utf8'));

        if (!isOutputData(saved)) {
          throw new Error('The saved document is not a Blok document.');
        }

        return saved;
      },
      close: async () => {
        try {
          await mcp.stop();
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    };
  } catch (thrown) {
    await mcp.stop();
    rmSync(dir, { recursive: true, force: true });
    throw thrown;
  }
};

const TAG: WorkingSetTag = { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' };

/** A sync server that acknowledges every operation and keeps what it received. */
class RoomSocket implements WebSocketLike {
  public binaryType = 'blob';
  public readyState = 0;
  public protocol = '';
  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  private sequence = 0;

  public constructor(private readonly server: DocumentStore) {}

  public send(data: ArrayBufferLike | ArrayBufferView): void {
    const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    const frame = decode(bytes);

    if (frame.type === 'operation') {
      this.server.applyRemoteUpdate(frame.update, 'client');
      this.sequence += 1;
      const ack: SyncWireFrame = {
        type: 'acknowledgement', lineage: frame.lineage, operationId: frame.operationId, serverSequence: String(this.sequence),
      };

      queueMicrotask(() => this.deliver(ack));
    }
    if (frame.type === 'update') {
      this.server.applyRemoteUpdate(frame.update, 'client');
    }
  }

  public close(): void {
    this.readyState = 3;
  }

  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame).slice().buffer });
  }
}

/** blok-mcp as `blok-mcp --sync-url`, joined to a room that starts with the seed. */
export const openMcpLive = async (seed: OutputData, actor: AgentActor): Promise<McpRun> => {
  const { richTextFieldsFor } = buildMcpContracts({ pageTitles: 'off' });
  // Node has no DOM: the serializer's default HTML parser needs one.
  const server = new DocumentStore(new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode, richTextFieldsFor }));
  const copy = loadStoredDocument(structuredClone(seed), richTextFieldsFor);

  server.fromJSON(copy.blocks);
  server.pageFromJSON({ title: copy.title, icon: copy.icon });
  const factory: CollabSocketFactory = () => {
    const socket = new RoomSocket(server);

    queueMicrotask(() => {
      socket.readyState = 1;
      socket.protocol = 'blok-sync.v2';
      socket.onopen?.({});
      socket.deliver({ type: 'control', tag: TAG });
      socket.deliver({ type: 'syncStep2', update: server.encodeStateAsUpdate() });
    });

    return socket;
  };
  const mcp = assembleMcp(
    { transport: { kind: 'stdio' }, auth: { kind: 'none' }, sync: { url: 'wss://sync.test/sync' }, agentActor: () => actor },
    { liveSocketFactory: factory, liveSyncTimeoutMs: 5_000 },
  );

  try {
    return {
      ...await runOn(mcp, 'live'),
      output: () => ({ ...readPageFields(server.page), blocks: server.toJSON() }),
      close: async () => {
        try {
          await mcp.stop();
        } finally {
          server.destroy();
        }
      },
    };
  } catch (thrown) {
    await mcp.stop();
    server.destroy();
    throw thrown;
  }
};

/** The handle must name a refused command up front, not only when the batch runs. */
const expectListedUnavailable = (c: ParityCase, run: McpRun, answers: Array<Record<string, unknown>>): void => {
  const listed = (Array.isArray(run.opened.unavailableCommands) ? run.opened.unavailableCommands : [])
    .map((entry: unknown) => (isRecord(entry) ? entry.name : undefined));
  const refused = answers.at(-1);
  const index = isRecord(refused?.error) ? refused.error.commandIndex : undefined;
  const command = typeof index === 'number' ? c.batches[answers.length - 1]?.commands[index]?.name : undefined;

  expect(command, `${c.name}: the refusal names no command`).toEqual(expect.any(String));
  expect(listed, `${c.name}: blok_open does not list ${command} in unavailableCommands`).toContain(command);
};

/** The case's batches in the json engine with no host services, as blok-mcp has. */
const expectServicelessJson = async (c: ParityCase, run: McpRun): Promise<void> => {
  const reference = openJsonSession(c.seed, TEST_ACTOR);

  try {
    expect(await runCorpusCase(reference, c)).toBe('ok');
    expect(normalizeForParity(run.output(), callerChosenIds(c)), `${c.name}: differs from the json engine without services`)
      .toEqual(normalizeForParity(reference.output(), callerChosenIds(c)));
  } finally {
    reference.close();
  }
};

/**
 * One corpus case through blok-mcp's dispatcher: the outcome must match the
 * case's expectation, the saved document its golden, and each batch's answer
 * the json engine's.
 */
export const checkMcpCase = async (c: ParityCase, runner: McpRunnerName): Promise<void> => {
  const run = await (runner === 'mcp-stored' ? openMcpStored : openMcpLive)(c.seed, TEST_ACTOR);

  try {
    const recorder = recordAnswers(async (batch) => (await run.execute(batch)).answer);
    const outcome = await runCorpusCase(recorder, c);
    const exemption = mcpExemption(c, runner);
    const expected = expectationFor(c, runner);

    expect(outcome).toEqual(expected);
    if (exemption !== undefined && 'errorCode' in exemption && exemption.errorCode === 'COMMAND_UNAVAILABLE') {
      expectListedUnavailable(c, run, recorder.answers);
    }
    if (exemption !== undefined && 'against' in exemption) {
      await expectServicelessJson(c, run);
    } else if (outcome === 'ok' && expectationFor(c, 'json') === 'ok') {
      compareToGolden(c, normalizeForParity(run.output(), callerChosenIds(c)));
    }
    // An exempt refusal stops where json goes on, so only matching runs compare answers.
    if (JSON.stringify(expected) === JSON.stringify(expectationFor(c, 'json'))) {
      const keep = caseStrings(c);

      expect(projectAnswers(recorder.answers, keep), `${c.name}: blok_execute answers differ from the json engine's`)
        .toEqual(projectAnswers(await referenceAnswers(c), keep));
    }
  } finally {
    await run.close();
  }
};

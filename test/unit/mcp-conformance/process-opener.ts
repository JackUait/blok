import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect } from 'vitest';

import type { OutputData } from '../../../types';
import type { AgentActor } from '../../../types/agent';
import type { McpOpener, McpRun } from '../agent/parity/mcp-harness';
import { caseEnv } from './mcp-process';

/*
 * The goldens name the in-process test actor (`agent-test`, acting for
 * `human-1`). A spawned binary names its agent `agent:<principal>:<client>`,
 * so it runs with --principal human-1 as client `parity`, and only that exact
 * id is mapped back to the golden's. Any other agent id stays as written, so a
 * port that stamps the wrong actor still fails the golden. This needs no
 * test-only flag in the ports.
 */
export const PARITY_PRINCIPAL = 'human-1';
export const PARITY_CLIENT = 'parity';
export const SPAWNED_AGENT_ID = `agent:${PARITY_PRINCIPAL}:${PARITY_CLIENT}`;
const ACTOR_FIELDS = new Set(['createdWith', 'lastEditedWith']);
const DOCUMENT_ID = 'doc';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Maps the spawned agent id to the golden actor's id in createdWith and lastEditedWith. */
export const toGoldenActor = (value: unknown, goldenId: string): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => toGoldenActor(item, goldenId));
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [
    key,
    ACTOR_FIELDS.has(key) && inner === SPAWNED_AGENT_ID ? goldenId : toGoldenActor(inner, goldenId),
  ]));
};

const structured = (result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> => {
  const content = result.structuredContent;

  if (!isRecord(content)) {
    throw new Error(`the tool answered without structuredContent: ${JSON.stringify(result)}`);
  }

  return content;
};

/** blok-mcp as a separate process, `--source files:<dir>`, driven by the SDK client over stdio. */
export const processOpener = (command: string[]): McpOpener => async (seed: OutputData, actor: AgentActor): Promise<McpRun> => {
  expect(actor.onBehalfOf, 'the goldens act for human-1').toBe(PARITY_PRINCIPAL);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'blok-mcp-corpus-')));
  const file = join(dir, `${DOCUMENT_ID}.json`);

  writeFileSync(file, JSON.stringify(seed));
  const transport = new StdioClientTransport({
    command: command[0],
    args: [...command.slice(1), '--source', `files:${dir}`, '--principal', PARITY_PRINCIPAL],
    env: Object.fromEntries(Object.entries(caseEnv({})).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    stderr: 'pipe',
  });
  const client = new Client({ name: PARITY_CLIENT, version: '1' });
  // Drained so a chatty port cannot stall on a full pipe; shown when the case fails.
  const stderr = { text: '' };

  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr.text += chunk.toString('utf8');
  });
  const close = async (): Promise<void> => {
    try {
      await client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  try {
    await client.connect(transport);
    const opened = structured(await client.callTool({ name: 'blok_open', arguments: { documentId: DOCUMENT_ID, mode: 'stored', write: true } }));
    const handle = opened.handle;

    if (typeof handle !== 'string') {
      throw new Error(`blok_open did not return a handle: ${JSON.stringify(opened)}`);
    }

    return {
      opened,
      execute: async (batch) => {
        const answer = structured(await client.callTool({ name: 'blok_execute', arguments: { handle, commands: batch.commands } }));
        const error = isRecord(answer.error) && typeof answer.error.code === 'string' ? { code: answer.error.code } : undefined;

        return { ok: answer.ok === true, ...(error !== undefined && { error }), answer: toGoldenActor(answer, actor.id) as Record<string, unknown> };
      },
      output: () => {
        const saved: unknown = JSON.parse(readFileSync(file, 'utf8'));

        if (!isRecord(saved) || !Array.isArray(saved.blocks)) {
          throw new Error('The saved document is not a Blok document.');
        }

        return toGoldenActor(saved, actor.id) as OutputData;
      },
      close,
    };
  } catch (thrown) {
    await close();
    throw new Error(`the spawned server failed: ${thrown instanceof Error ? thrown.message : String(thrown)}\nstderr:\n${stderr.text}`, { cause: thrown });
  }
};

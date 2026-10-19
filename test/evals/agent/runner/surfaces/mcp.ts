import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import type { OutputData } from '../../../../../types';
import { isSeed } from '../../../../unit/agent/parity/corpus';
import type { ChangedSet, ExecuteResult } from '../../types';
import type { EvalSchema, OpenSurface } from '../run-task';
import { asAnthropicTool, logFromExecuteCalls } from '../run-task';

const REPO_ROOT = resolve(__dirname, '../../../../..');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The bin path @bloklabs/mcp publishes, read from its package.json (04, D2). */
const mcpBin = (): string => {
  const pkg: unknown = JSON.parse(readFileSync(join(REPO_ROOT, 'packages/mcp/package.json'), 'utf8'));
  const bin = isRecord(pkg) && isRecord(pkg.bin) ? pkg.bin['blok-mcp'] : undefined;

  if (typeof bin !== 'string') {
    throw new Error('packages/mcp/package.json has no blok-mcp bin');
  }

  return join(REPO_ROOT, 'packages/mcp', bin);
};

/** 04 Task 9 `defaultAgentActor('local', safeClientName('agent-eval'))`. */
export const MCP_ACTOR_ID = 'agent:local:agent-eval';

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content.map((c) => (isRecord(c) && typeof c.text === 'string' ? c.text : '')).join('')
    : JSON.stringify(content);

const commandsOf = (input: unknown): Array<{ name: string; args: unknown }> =>
  isRecord(input) && Array.isArray(input.commands)
    ? input.commands.filter(isRecord).map((c) => ({ name: typeof c.name === 'string' ? c.name : '', args: c.args }))
    : [];

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

// The answer leaves out empty lists (src/shared/agent/model-answer.ts); a missing list is an empty one.
const changedOf = (changed: unknown): ChangedSet => {
  const list = (key: keyof ChangedSet): string[] => {
    const value = isRecord(changed) ? changed[key] : undefined;

    return isStrings(value) ? value : [];
  };

  return { created: list('created'), updated: list('updated'), moved: list('moved'), removed: list('removed') };
};

// Ids a command created, changed or moved. removedIds and liftedIds are left out: they name no block the agent wrote.
const resultIdsOf = (results: unknown): string[] => (Array.isArray(results) ? results : []).filter(isRecord).flatMap((r) => [
  ...(typeof r.id === 'string' ? [r.id] : []),
  ...(isStrings(r.ids) ? r.ids : []),
  ...(isStrings(r.childIds) ? r.childIds : []),
]);

/** Keeps the fields graders read; anything malformed is dropped, not trusted. */
export const executeResultOf = (text: string): ExecuteResult => {
  const value: unknown = JSON.parse(text);

  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new Error(`blok_execute returned no result: ${text}`);
  }

  const { changed, warnings, error, delivery } = value;
  const resultIds = value.ok ? resultIdsOf(value.results) : [];

  return {
    ok: value.ok,
    ...(value.ok && { changed: changedOf(changed) }),
    ...(resultIds.length > 0 && { resultIds }),
    ...(Array.isArray(warnings) && {
      warnings: warnings.filter(isRecord).flatMap((w) => typeof w.code === 'string'
        ? [{ code: w.code, ...(typeof w.blockId === 'string' && { blockId: w.blockId }) }]
        : []),
    }),
    ...(isRecord(error) && typeof error.code === 'string' && {
      error: {
        code: error.code,
        ...(typeof error.message === 'string' && { message: error.message }),
        ...(typeof error.commandIndex === 'number' && { commandIndex: error.commandIndex }),
      },
    }),
    ...(isRecord(delivery) && typeof delivery.durable === 'boolean' && typeof delivery.pending === 'boolean' && {
      delivery: {
        durable: delivery.durable,
        pending: delivery.pending,
        serverSequence: typeof delivery.serverSequence === 'string' ? delivery.serverSequence : null,
        savedVersion: typeof delivery.savedVersion === 'string' ? delivery.savedVersion : null,
      },
    }),
  };
};

const savedDocument = (path: string): OutputData => {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));

  if (!isSeed(value)) {
    throw new Error(`${path} is not a saved document`);
  }

  return value;
};

export const mcpArgs = (bin: string, dir: string, schema: EvalSchema, extraArgs: string[]): string[] =>
  [bin, '--source', `files:${dir}`, ...(schema === 'shipped' ? [] : ['--schema', schema]), ...extraArgs];

export const openMcpStored = (extraArgs: string[] = [], extraEnv: Record<string, string> = {}): OpenSurface => async (task, schema) => {
  const dir = mkdtempSync(join(tmpdir(), 'blok-evals-'));
  const docId = task.docId ?? task.id;

  writeFileSync(join(dir, `${docId}.json`), JSON.stringify(task.seed));

  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: mcpArgs(mcpBin(), dir, schema, extraArgs),
    env: { ...env, ...extraEnv },
  });
  // 04 has no identity flag: the actor id is `agent:local:<client name>` (04 Task 9), so this name fixes it.
  const client = new Client({ name: 'agent-eval', version: '1.0.0' });

  await client.connect(transport);

  const listed = await client.listTools();
  const tools = listed.tools.map((t) => asAnthropicTool({ name: t.name, description: t.description, schema: t.inputSchema }));
  const calls: Array<{ input: { commands: Array<{ name: string; args: unknown }> }; result: ExecuteResult }> = [];

  return {
    tools,
    execute: async (name, input) => {
      const response = await client.callTool({ name, arguments: isRecord(input) ? input : {} });
      const text = textOf(response.content);

      if (name === 'blok_execute') {
        calls.push({ input: { commands: commandsOf(input) }, result: executeResultOf(text) });
      }

      return { content: text, isError: response.isError === true };
    },
    // Each blok_execute saves the file, so this is the saved result with or without blok_close.
    finish: async () => ({
      final: savedDocument(join(dir, `${docId}.json`)),
      log: logFromExecuteCalls(calls, MCP_ACTOR_ID),
      actorId: MCP_ACTOR_ID,
      results: calls.map((c) => c.result),
    }),
    close: async () => client.close(),
  };
};

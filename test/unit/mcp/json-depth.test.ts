// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Caller } from '../../../src/mcp/dispatcher';
import { isMcpSurfaceError } from '../../../src/mcp/errors';
import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';
import { createEndpointSource } from '../../../src/mcp/sources/endpoint';
import { checkCall } from '../../../src/shared/mcp/calls';
import { parseDocumentText } from '../../../src/shared/mcp/files';
import { MAX_JSON_DEPTH } from '../../../src/shared/mcp/wire-json';
import { invoke } from '../../../src/view/server-runtime';

const caller: Caller = { principal: 'alice', clientName: 'depth', scopes: null };

/** An array nested `levels` deep around "z", built without recursion. */
const nestedArray = (levels: number): unknown => Array.from({ length: levels }).reduce<unknown>((inner) => [inner], 'z');

/** A document file whose JSON nests `depth` levels: root, blocks, block, data, then `extra`. */
const documentText = (depth: number): string =>
  `{"blocks":[{"id":"p1","type":"paragraph","data":{"text":"a","extra":${'['.repeat(depth - 4)}"z"${']'.repeat(depth - 4)}}}]}`;

const codeOf = (run: () => unknown): string | undefined => {
  try {
    run();

    return undefined;
  } catch (thrown) {
    return isMcpSurfaceError(thrown) ? thrown.agentError.code : `not a surface error: ${String(thrown)}`;
  }
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the JSON nesting limit', () => {
  it('is 48 levels, under the 64 the ports\' engines parse', () => {
    expect(MAX_JSON_DEPTH).toBe(48);
  });

  describe('for call arguments', () => {
    // arguments(1) commands(2) command(3) args(4) data(5), then `extra`.
    const execute = (depth: number): Record<string, unknown> => ({
      handle: 'h',
      commands: [{ name: 'block.update', args: { id: 'p1', data: { extra: nestedArray(depth - 5) } } }],
    });

    it('accepts arguments nested exactly 48 levels', () => {
      expect(codeOf(() => checkCall('blok_execute', execute(48), null))).toBeUndefined();
    });

    it('refuses arguments nested 49 levels as INVALID_ARGS', () => {
      expect(codeOf(() => checkCall('blok_execute', execute(49), null))).toBe('INVALID_ARGS');
    });

    it('refuses arguments nested 100000 levels without overflowing the stack', () => {
      expect(codeOf(() => checkCall('blok_execute', execute(100_000), null))).toBe('INVALID_ARGS');
    });

    // Node's SDK refuses an unknown tool before checkCall runs, whatever its arguments.
    it('names an unknown tool before it looks at the depth', async () => {
      expect(() => checkCall('nope', execute(60), null)).toThrow('Unknown tool: nope');
      const answer: unknown = JSON.parse(await invoke('mcpCheckCall', JSON.stringify({ name: 'nope', arguments: execute(60) })));

      expect(answer).toStrictEqual({ unknownTool: 'Unknown tool: nope' });
    });

    it('answers every host the same refusal through the bundle', async () => {
      const answer: unknown = JSON.parse(await invoke('mcpCheckCall', JSON.stringify({ name: 'blok_execute', arguments: execute(49) })));

      expect(answer).toMatchObject({
        answer: {
          isError: true,
          structuredContent: { ok: false, error: { code: 'INVALID_ARGS', message: 'The arguments nest deeper than 48 levels of objects and arrays. Send flatter data.' } },
        },
      });
    });
  });

  describe('for a document file', () => {
    it('opens a file nested exactly 48 levels', () => {
      expect(codeOf(() => parseDocumentText('doc', documentText(48)))).toBeUndefined();
    });

    it.each([49, 65, 100_000])('refuses a file nested %i levels before parsing it', (depth) => {
      expect(() => parseDocumentText('doc', documentText(depth))).toThrow('doc.json nests deeper than 48 levels of objects and arrays.');
    });

    it('does not count brackets inside strings', () => {
      expect(codeOf(() => parseDocumentText('doc', `{"blocks":[],"note":"${'['.repeat(200)}\\"${'{'.repeat(200)}"}`))).toBeUndefined();
    });

    it('answers every host the same refusal through the bundle', async () => {
      const answer: unknown = JSON.parse(await invoke('mcpParseDocument', JSON.stringify({ id: 'doc', text: documentText(65) })));

      expect(answer).toEqual({
        error: { code: 'SOURCE_UNAVAILABLE', message: 'doc.json nests deeper than 48 levels of objects and arrays.', retryable: true },
      });
    });
  });

  it('lists a file nested deeper than 48 levels without a title, for every host', async () => {
    const text = documentText(49).replace('{"blocks"', '{"title":"Deep","blocks"');
    const answer: unknown = JSON.parse(await invoke('mcpFilesList', JSON.stringify({ entries: [{ id: 'doc', text }], limit: 5 })));

    expect(answer).toEqual({ documents: [{ id: 'doc', title: null }], nextCursor: null });
  });

  it('refuses an endpoint answer nested deeper than 48 levels', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(documentText(49), { status: 200 }));
    const loading = createEndpointSource({ url: 'http://host/docs', endpointAuth: 'a' }, fetchImpl).load('doc');

    await expect(loading).rejects.toMatchObject({
      agentError: { code: 'SOURCE_UNAVAILABLE', message: 'The document endpoint answered JSON nested deeper than 48 levels for doc.' },
    });
  });

  describe('for the document a batch would save', () => {
    const dir = { path: '' };
    const state: { mcp?: AssembledMcp } = {};

    beforeEach(() => {
      dir.path = mkdtempSync(join(tmpdir(), 'blok-mcp-depth-'));
      state.mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir: dir.path } });
    });

    afterEach(async () => {
      await state.mcp?.stop();
      rmSync(dir.path, { recursive: true, force: true });
    });

    const mcp = (): AssembledMcp => {
      if (state.mcp === undefined) {
        throw new Error('not assembled');
      }

      return state.mcp;
    };

    /** A database whose view filter value sits one level deeper in the file than in the arguments. */
    const database = async (): Promise<{ filter: (levels: number) => Record<string, unknown> }> => {
      writeFileSync(join(dir.path, 'doc.json'), '{"blocks":[]}');
      const opened = await mcp().dispatch('blok_open', { documentId: 'doc', write: true }, caller);
      const handle = String(opened.structuredContent.handle);

      await mcp().dispatch('blok_execute', { handle, commands: [{ name: 'database.create', args: { title: 'D', view: 'table' } }] }, caller);
      const saved = JSON.parse(readFileSync(join(dir.path, 'doc.json'), 'utf-8')) as {
        blocks: Array<{ id: string; type: string; data: { views: Array<{ id: string }>; schema: Array<{ id: string }> } }>;
      };
      const db = saved.blocks.find(block => block.type === 'database');

      if (db === undefined) {
        throw new Error('no database block');
      }

      // arguments(1) commands(2) command(3) args(4) changes(5) filters(6) rule(7) value(8...)
      return {
        filter: (levels) => ({
          handle,
          commands: [{
            name: 'database.updateView',
            args: { id: db.id, viewId: db.data.views[0].id, changes: { filters: [{ propertyId: db.data.schema[0].id, operator: 'equals', value: nestedArray(levels) }] } },
          }],
        }),
      };
    };

    it('refuses a batch whose saved file would nest past 48 levels, and saves nothing', async () => {
      const { filter } = await database();
      const before = readFileSync(join(dir.path, 'doc.json'), 'utf-8');
      // Arguments nest 48 levels (allowed); the view puts the value one level deeper in the file.
      const outcome = await mcp().dispatch('blok_execute', filter(41), caller);

      expect(outcome.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGS', message: 'This batch would nest the document deeper than 48 levels of objects and arrays, so nothing was saved. Send flatter data.' },
        delivery: { durable: false },
      });
      expect(readFileSync(join(dir.path, 'doc.json'), 'utf-8')).toBe(before);
      // Memory dropped the refused work too: the next write saves without it.
      const next = await mcp().dispatch('blok_execute', filter(2), caller);

      expect(next.structuredContent).toMatchObject({ ok: true, delivery: { durable: true } });
    });

    it('saves the same batch one level flatter', async () => {
      const { filter } = await database();
      const outcome = await mcp().dispatch('blok_execute', filter(40), caller);

      expect(outcome.structuredContent).toMatchObject({ ok: true, delivery: { durable: true } });
    });
  });
});

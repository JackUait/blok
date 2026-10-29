// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStoreAgentSession } from '../../../src/components/modules/agent/store-session';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import { createDocumentAgentSession } from '../../../src/shared/agent';
import { createHeadlessAgentSetup, loadStoredDocument } from '../../../src/view/agent-runtime';
import { htmlToSegmentsNode } from '../../../src/view/rich-text-node';
import { TEST_ACTOR } from './harness';

import type { AgentBatch, AgentResult, AgentSession, OutputData } from '../../../types';
import type { AgentPorts } from '../../../src/shared/agent/types';

type Ports = Required<Pick<AgentPorts, 'createPageDocument' | 'openPageDocument'>>;
type Opened = AgentSession & { read: AgentSession['read'] };

/** Both headless appliers with a host that creates pages: the json one (MCP stored, C#) and the store one (MCP live). */
const RUNTIMES: Array<[string, (seed: OutputData, ports: Ports) => Opened]> = [
  ['json', (seed, ports) => {
    const setup = createHeadlessAgentSetup({ runtime: 'node', services: ['pageBackend'], prepares: ['page'] });

    return createDocumentAgentSession({
      document: loadStoredDocument(structuredClone(seed), setup.richTextFieldsFor),
      tools: setup.tools, contract: setup.contract, actor: TEST_ACTOR, ports: { ...setup.ports, ...ports }, pageTitles: 'page-map',
    });
  }],
  ['store', (seed, ports) => {
    const setup = createHeadlessAgentSetup({ runtime: 'node-live', services: ['pageBackend'], prepares: ['page'] });
    const store = new DocumentStore(new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode, richTextFieldsFor: setup.richTextFieldsFor }));

    store.fromJSON(loadStoredDocument(structuredClone(seed), setup.richTextFieldsFor).blocks);
    const session = createStoreAgentSession({
      store, tools: setup.tools, contract: setup.contract, actor: TEST_ACTOR, ports: { ...setup.ports, ...ports },
      pageTitles: 'page-map', richTextFieldsFor: setup.richTextFieldsFor,
    });

    return {
      ...session,
      close: async () => {
        try {
          await session.close();
        } finally {
          await store.destroy();
        }
      },
    };
  }],
];

const page = (id: string, pageId: string): OutputData['blocks'][number] => ({ id, type: 'page', data: { pageId } });

const lockedDatabase = (id: string): Array<OutputData['blocks'][number]> => [{
  id, type: 'database',
  data: {
    schema: [{ id: 'dt', name: 'Name', type: 'title', position: 'a0', databaseLocked: true }],
    views: [{ id: `${id}-v`, name: 'Table', type: 'table', position: 'a0' }],
    activeViewId: `${id}-v`,
  },
}];

const host = (): Ports & { created: string[] } => {
  const created: string[] = [];

  return {
    created,
    createPageDocument: vi.fn(async () => {
      const pageId = `host-${created.length + 1}`;

      created.push(pageId);

      return { pageId };
    }),
    openPageDocument: vi.fn(async () => {
      throw new Error('A delete never opens the page document.');
    }),
  };
};

const run = (session: AgentSession, name: string, args: Record<string, unknown>): Promise<AgentResult> =>
  session.execute({ commands: [{ name, args }] } as AgentBatch);

const blocksOf = async (session: AgentSession): Promise<Array<{ id: string; type: string; data?: Record<string, unknown> }>> =>
  (await session.read({ detail: 'full' })).blocks.map(block => ({ id: block.id, type: block.type, data: block.data }));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(RUNTIMES)('sub-pages in the %s session', (_label, open) => {
  it('deletes only the page block: the host is never asked, and undo brings back the same page without creating one', async () => {
    const ports = host();
    const session = open({ blocks: [page('pb', 'kept')] }, ports);

    try {
      expect(await run(session, 'block.delete', { id: 'pb' })).toMatchObject({ ok: true });
      expect(await blocksOf(session)).toEqual([]);
      expect(await run(session, 'history.undo', {})).toMatchObject({ ok: true });
      expect(await blocksOf(session)).toEqual([{ id: 'pb', type: 'page', data: { pageId: 'kept' } }]);
      expect(await run(session, 'history.redo', {})).toMatchObject({ ok: true });
      expect(await blocksOf(session)).toEqual([]);
      expect(ports.createPageDocument).not.toHaveBeenCalled();
      expect(ports.openPageDocument).not.toHaveBeenCalled();
    } finally {
      await session.close();
    }
  });

  it('deletes a page block whose page the actor cannot open, without opening it', async () => {
    const ports = host();
    const session = open({ blocks: [page('pb', 'private-page')] }, ports);

    try {
      expect(await run(session, 'block.delete', { id: 'pb' })).toMatchObject({ ok: true });
      expect(ports.openPageDocument).not.toHaveBeenCalled();
    } finally {
      await session.close();
    }
  });

  it('refuses to delete a block of another document, naming it as not found', async () => {
    const ports = host();
    const session = open({ blocks: [page('pb', 'kept')] }, ports);

    try {
      expect(await run(session, 'block.delete', { id: 'kept' })).toMatchObject({ ok: false, error: { code: 'BLOCK_NOT_FOUND' } });
      expect(await blocksOf(session)).toEqual([{ id: 'pb', type: 'page', data: { pageId: 'kept' } }]);
      expect(ports.openPageDocument).not.toHaveBeenCalled();
    } finally {
      await session.close();
    }
  });

  it('undo of a page insert removes the block, and redo brings back the same page without a second create', async () => {
    const ports = host();
    const session = open({ blocks: [] }, ports);

    try {
      expect(await run(session, 'block.insert', { type: 'page', id: 'np', position: 'end' })).toMatchObject({ ok: true });
      expect(await run(session, 'history.undo', {})).toMatchObject({ ok: true });
      expect(await blocksOf(session)).toEqual([]);
      expect(await run(session, 'history.redo', {})).toMatchObject({ ok: true });
      expect(await blocksOf(session)).toEqual([{ id: 'np', type: 'page', data: { pageId: 'host-1' } }]);
      expect(ports.created).toEqual(['host-1']);
    } finally {
      await session.close();
    }
  });

  it('refuses a page nested in an insert, so no page block keeps a pageId the agent wrote', async () => {
    const ports = host();
    const session = open({ blocks: [] }, ports);

    try {
      const result = await run(session, 'block.insert', {
        type: 'toggle', id: 't', data: { text: [{ text: 'Pages' }] },
        children: [{ type: 'page', id: 'nested', data: { pageId: 'someone-elses' } }],
      });

      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS', path: '/commands/0/args/children/0/type' } });
      expect(await blocksOf(session)).toEqual([]);
      expect(ports.createPageDocument).not.toHaveBeenCalled();
    } finally {
      await session.close();
    }
  });

  it('creates at most 25 pages in one batch, and a longer batch asks the host for none', async () => {
    const ports = host();
    const session = open({ blocks: [] }, ports);
    const inserts = (count: number): AgentBatch => ({
      commands: Array.from({ length: count }, () => ({ name: 'block.insert', args: { type: 'page', position: 'end' } })),
    });

    try {
      expect(await session.execute(inserts(26))).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
      expect(ports.createPageDocument).not.toHaveBeenCalled();
      expect(await session.execute(inserts(25))).toMatchObject({ ok: true });
      expect(ports.created).toHaveLength(25);
    } finally {
      await session.close();
    }
  });

  it('refuses to point a page block at another page', async () => {
    const ports = host();
    const session = open({ blocks: [page('pb', 'mine')] }, ports);

    try {
      const result = await run(session, 'block.update', { id: 'pb', data: { pageId: 'someone-elses' } });

      expect(result).toMatchObject({ ok: false });
      expect(await blocksOf(session)).toEqual([{ id: 'pb', type: 'page', data: { pageId: 'mine' } }]);
    } finally {
      await session.close();
    }
  });

  it('refuses to delete a database a person locked, a database held in it, or a block that takes one with it', async () => {
    const ports = host();
    const unlockedHeld = { ...lockedDatabase('E')[0], parent: 'D', data: { ...lockedDatabase('E')[0].data, schema: [{ id: 'et', name: 'Name', type: 'title', position: 'a0' }] } };
    const session = open({
      blocks: [
        { ...lockedDatabase('D')[0], content: ['E'] },
        unlockedHeld,
        { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['D2'] },
        { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['p2'] },
        { ...lockedDatabase('D2')[0], parent: 'c1' },
        { id: 'p2', type: 'paragraph', data: { text: [{ text: 'x' }] }, parent: 'c2' },
      ],
    }, ports);

    try {
      const before = await blocksOf(session);

      const codes: Record<string, string | undefined> = {};

      for (const id of ['D', 'E', 'cl']) {
        const result = await run(session, 'block.delete', { id });

        codes[id] = result.ok ? undefined : result.error.code;
      }
      expect(codes).toEqual({ D: 'PRECONDITION_FAILED', E: 'PRECONDITION_FAILED', cl: 'PRECONDITION_FAILED' });
      expect(await blocksOf(session)).toEqual(before);
    } finally {
      await session.close();
    }
  });

  it('deletes a page block whose page holds a locked database: the page document is not touched', async () => {
    const ports = host();
    const session = open({ blocks: [{ id: 'pb', type: 'page', data: { pageId: 'locked-page', kind: 'database' } }] }, ports);

    try {
      expect(await run(session, 'block.delete', { id: 'pb' })).toMatchObject({ ok: true });
      expect(ports.openPageDocument).not.toHaveBeenCalled();
    } finally {
      await session.close();
    }
  });
});

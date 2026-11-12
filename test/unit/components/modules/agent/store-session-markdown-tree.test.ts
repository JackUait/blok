// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStoreAgentSession } from '../../../../../src/components/modules/agent/store-session';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { createHeadlessAgentSetup } from '../../../../../src/view/agent-runtime';
import { htmlToSegmentsNode } from '../../../../../src/view/rich-text-node';

import type { AgentActor, AgentSession } from '../../../../../types/agent';

const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent' };
const stores: DocumentStore[] = [];
const sessions: AgentSession[] = [];

const open = (): { store: DocumentStore; serializer: YBlockSerializer; session: AgentSession } => {
  const setup = createHeadlessAgentSetup({ runtime: 'node-live' });
  const serializer = new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode, richTextFieldsFor: setup.richTextFieldsFor });
  const store = new DocumentStore(serializer);

  stores.push(store);
  store.fromJSON([{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }]);
  const session = createStoreAgentSession({
    store, tools: setup.tools, contract: setup.contract, actor, ports: setup.ports,
    richTextFieldsFor: setup.richTextFieldsFor,
  });

  sessions.push(session);

  return { store, serializer, session };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await Promise.resolve(session.close());
  }
  for (const store of stores.splice(0)) {
    await store.destroy();
  }
  vi.restoreAllMocks();
});

describe('markdown.insert with blocks inside a list item', () => {
  it('stores the code block and the nested item under the item', async () => {
    const { store, serializer, session } = open();
    const result = await session.execute({
      commands: [{ name: 'markdown.insert', args: { markdown: '- Item\n\n  ```\n  code\n  ```\n\n  - Child' } }],
    });

    expect(result).toMatchObject({ ok: true });

    const blocks = store.toJSON();
    const label = (id: unknown): unknown => {
      const block = blocks.find((b) => b.id === id);

      if (block === undefined) {
        return undefined;
      }

      if (block.type === 'code') {
        return block.data.code;
      }

      const segments = serializer.toRichSegments(block.data.text) ?? [];

      return segments.map((segment) => String(segment.text)).join('');
    };

    expect(blocks.filter((b) => b.id !== 'p').map((b) => ({ text: label(b.id), parent: label(b.parent), content: b.content?.map(label) })))
      .toEqual([
        { text: 'Item', parent: undefined, content: ['code', 'Child'] },
        { text: 'code', parent: 'Item', content: undefined },
        { text: 'Child', parent: 'Item', content: undefined },
      ]);
  });
});

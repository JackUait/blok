// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as DocumentSessionModule from '../../../src/shared/agent/document-session';

const output = vi.hoisted(() => vi.fn());

vi.mock('../../../src/shared/agent/document-session', async importOriginal => {
  const actual = await importOriginal<typeof DocumentSessionModule>();

  return {
    ...actual,
    createDocumentAgentSession: (...args: Parameters<typeof actual.createDocumentAgentSession>) => {
      const session = actual.createDocumentAgentSession(...args);

      return {
        ...session,
        output: () => {
          output();

          return session.output();
        },
      };
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('server runtime serialized write output', () => {
  it('copies the final document once for depth checking, compact save text and the response', async () => {
    const { invoke } = await import('../../../src/view/server-runtime');
    const result = JSON.parse(await invoke('agentExecute', JSON.stringify({
      mcp: { source: true, write: true },
      document: { title: 'Before', blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Preserved' } }] },
      actor: { id: 'agent', name: 'Agent', kind: 'agent' },
      batch: { commands: [{ name: 'doc.setTitle', args: { title: 'After' } }] },
      documentText: 'compact',
    }))) as { result: { ok: boolean }; save: boolean; document: { title: string }; documentText: string };

    expect(output).toHaveBeenCalledTimes(1);
    expect(result.result.ok).toBe(true);
    expect(result.save).toBe(true);
    expect(result.document.title).toBe('After');
    expect(JSON.parse(result.documentText)).toEqual(result.document);
  });
});

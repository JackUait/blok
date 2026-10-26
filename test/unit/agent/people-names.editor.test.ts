// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Database, DatabaseRow, Paragraph } from '../../../src/tools';

import type { Agent, OutputData } from '../../../types';
import type { DatabasePerson } from '../../../types/tools/database';

interface TestEditor { isReady: Promise<unknown>; destroy: () => void; agent: Agent }

const editors: TestEditor[] = [];

const SEED: OutputData = {
  blocks: [
    { id: 'p', type: 'paragraph', data: { text: 'Hello' }, lastEditedAt: Date.UTC(2026, 0, 9), lastEditedBy: 'human-1' },
    {
      id: 'db',
      type: 'database',
      data: {
        title: 'Tasks',
        schema: [
          { id: 't', name: 'Name', type: 'title', position: 'a0' },
          { id: 'cb', name: 'Creator', type: 'createdBy', position: 'a1' },
          { id: 'lb', name: 'Editor', type: 'lastEditedBy', position: 'a2' },
        ],
        views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', filters: [], sorts: [], visibleProperties: [] }],
        activeViewId: 'v1',
      },
      content: ['r1'],
    },
    {
      id: 'r1', type: 'database-row', parent: 'db',
      data: { title: 'One', properties: { t: 'One' }, position: 'a0' },
      createdAt: Date.UTC(2026, 0, 2), createdBy: 'u1', lastEditedAt: Date.UTC(2026, 0, 3), lastEditedBy: 'u2',
    },
  ],
};

// An email the directory holds but no cell shows must never reach the model.
const PEOPLE = [
  { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', avatarUrl: 'https://example.com/ada.png' },
  { id: 'u2', name: '‮Grace​\nHopper' },
] as DatabasePerson[];

const boot = async (): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    data: SEED,
    user: { id: 'human-1', name: 'Human One' },
    tools: {
      paragraph: { class: Paragraph },
      database: { class: Database, config: { people: { list: () => Promise.resolve(PEOPLE) } } },
      'database-row': { class: DatabaseRow },
    },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;
  // The tool loads its directory after render; read once its cells show the names.
  await vi.waitFor(() => {
    expect(document.querySelector('[data-blok-database-person-chip][data-person-id="u1"]')?.textContent).toContain('Ada Lovelace');
  });

  return editor;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the editor agent names people as the editor UI does', () => {
  it('names Created by and Last edited by cells from the database people directory', async () => {
    const editor = await boot();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    try {
      const [row] = (await turn.read({ ids: ['r1'] })).blocks;

      expect(row?.computed).toEqual({ cb: [{ id: 'u1', name: 'Ada Lovelace' }], lb: [{ id: 'u2', name: 'Grace Hopper' }] });
      expect(JSON.stringify(row)).not.toContain('ada@example.com');
      expect(JSON.stringify(row)).not.toContain('ada.png');
    } finally {
      turn.end();
    }
  });

  it('names the block menu\'s Last edited by from the editor user directory', async () => {
    const editor = await boot();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    try {
      const [paragraph] = (await turn.read({ ids: ['p'] })).blocks;

      expect(paragraph?.meta).toEqual({ lastEditedAt: '2026-01-09T00:00:00.000Z', lastEditedBy: { id: 'human-1', name: 'Human One' } });
    } finally {
      turn.end();
    }
  });
});

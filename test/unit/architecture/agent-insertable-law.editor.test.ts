import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import {
  Audio, Bookmark, Callout, Code, Column, ColumnList, Database, DatabaseComment, DatabaseRow, Divider, Embed, File,
  Header, Image, List, Page, PageLink, Paragraph, Quote, Spacer, Table, TableOfContents, TabsTool, TabTool, Toggle, Video,
} from '../../../src/tools';
import { insertOutcome } from './agent-insertable-fixtures';

import type { Agent } from '../../../types';
import type { AgentSession } from '../../../types/agent';
import type { PageConfig } from '../../../types/tools/page';

/** The editor half of agent-insertable-law: the editor runs prepareInsert, so a page inserts here. */

interface TestEditor { isReady: Promise<unknown>; destroy: () => void; agent: Agent }

/** A host tool with its own prepareInsert, as a host writes one. */
class PreparedTool extends Paragraph {
  public static async prepareInsert(): Promise<Record<string, unknown>> {
    return { text: [] };
  }
}

const editors: TestEditor[] = [];

const boot = async (page: PageConfig & Record<string, unknown>): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    tools: {
      paragraph: { class: Paragraph }, header: { class: Header }, list: { class: List }, table: { class: Table },
      toggle: { class: Toggle }, callout: { class: Callout }, database: { class: Database },
      'database-row': { class: DatabaseRow }, 'database-comment': { class: DatabaseComment },
      divider: { class: Divider }, spacer: { class: Spacer }, table_of_contents: { class: TableOfContents },
      quote: { class: Quote }, code: { class: Code }, image: { class: Image }, file: { class: File },
      audio: { class: Audio }, video: { class: Video }, column_list: { class: ColumnList }, column: { class: Column },
      tabs: { class: TabsTool }, tab: { class: TabTool }, embed: { class: Embed }, bookmark: { class: Bookmark },
      page: { class: Page, config: page }, 'page-link': { class: PageLink }, prepared: { class: PreparedTool },
    },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const toolsOf = (session: AgentSession): Array<{ name: string; insertable: boolean }> => {
  const index = session.describe();
  const names = 'index' in index ? index.index.tools.map(tool => tool.name) : [];

  return names.map((name) => {
    const entry = session.describe({ tool: name });

    return { name, insertable: 'tool' in entry && entry.tool.insertable };
  });
};

const SERVICE_CONFIGS: Array<{ label: string; page: PageConfig & Record<string, unknown> }> = [
  { label: 'none', page: {} },
  { label: 'pageBackend', page: { rename: () => undefined, setIcon: () => undefined } },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe.each(SERVICE_CONFIGS)('editor runtime, services $label', ({ page }) => {
  it('inserts every type its contract lists as insertable, and refuses the rest', async () => {
    const editor = await boot(page);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    // No agent config: the agent code loads with the turn's first call, and describe() waits for it.
    await turn.read();
    const tools = toolsOf(turn);
    const outcomes: Record<string, string> = {};

    try {
      for (const { name } of tools) {
        outcomes[name] = await insertOutcome(turn, name);
      }
    } finally {
      turn.end();
    }

    expect(tools.find(tool => tool.name === 'page')?.insertable).toBe(true);
    expect(tools.find(tool => tool.name === 'prepared')?.insertable).toBe(true);
    expect(outcomes).toEqual(Object.fromEntries(tools.map(tool => [tool.name, tool.insertable ? 'ok' : 'COMMAND_UNAVAILABLE'])));
  }, 60_000);
});

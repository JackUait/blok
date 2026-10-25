import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Header, Image, Page, Paragraph } from '../../../src/tools';
import type { Agent, BlokConfig, OutputData } from '../../../types';
import type { AgentModel, AgentModelResponse } from '../../../types/api';
import type { PageConfig } from '../../../types/tools/page';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  agent: Agent;
  save: () => Promise<OutputData>;
  readOnly: { toggle(state?: boolean): Promise<boolean> };
}

const editors: TestEditor[] = [];

/** A host that keeps each page's document in a map. */
const host = (pages: Map<string, OutputData>): PageConfig & Record<string, unknown> => ({
  create: ({ pageId }) => {
    pages.set(pageId, { blocks: [] });
  },
  loadDocument: (pageId) => structuredClone(pages.get(pageId) ?? null),
  saveDocument: (pageId, data) => {
    pages.set(pageId, structuredClone(data));
  },
});

const sub = (pages: Map<string, OutputData>): OutputData => pages.get('sub') ?? { blocks: [] };

const boot = async (page: PageConfig & Record<string, unknown>, model?: AgentModel, extra: Partial<BlokConfig> = {}): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    data: { blocks: [{ id: 'pg', type: 'page', data: { pageId: 'sub' } }, { id: 'p', type: 'paragraph', data: { text: 'Main' } }] },
    tools: { paragraph: { class: Paragraph }, header: { class: Header }, image: { class: Image }, page: { class: Page, config: page } },
    ...extra,
    agent: { ...extra.agent, ...(model === undefined ? {} : { assistant: { model } }) },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the agent edits a sub-page through the host page documents', () => {
  it('page.rename and page.setIcon write the sub-page document when the host has no rename or setIcon hook', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }]]);
    const editor = await boot(host(pages));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    // Each page action must be alone in its batch.
    const renamed = await turn.execute({ commands: [{ name: 'page.rename', args: { id: 'pg', title: 'Sub page' } }] });
    const iconed = await turn.execute({ commands: [{ name: 'page.setIcon', args: { id: 'pg', icon: { type: 'emoji', value: '🍕' } } }] });

    turn.end();
    expect([renamed.ok, iconed.ok]).toEqual([true, true]);
    expect(sub(pages).title).toBe('Sub page');
    expect(sub(pages).icon).toEqual({ type: 'emoji', value: '🍕' });
  });

  it('the host rename hook still wins over the document', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }]]);
    const rename = vi.fn();
    const editor = await boot({ ...host(pages), rename });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.execute({ commands: [{ name: 'page.rename', args: { id: 'pg', title: 'Named' } }] });

    turn.end();
    expect(result.ok).toBe(true);
    expect(rename).toHaveBeenCalledWith('sub', 'Named');
    expect(sub(pages).title).toBeUndefined();
  });

  it('a tool call with page writes the sub-page body and title, and leaves this document alone', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }]]);
    const editor = await boot(host(pages));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const written = await turn.call('blok_execute', { page: 'pg', commands: [
      { name: 'doc.setTitle', args: { title: 'Origins' } },
      { name: 'block.insert', args: { type: 'paragraph', data: { text: 'Body text' }, position: 'end' } },
    ] });
    const read = await turn.call('blok_read', { page: 'pg' });

    turn.end();
    expect(written.isError).toBe(false);
    expect(sub(pages).title).toBe('Origins');
    expect(sub(pages).blocks.map((block) => block.data.text)).toEqual([[{ text: 'Body text' }]]);
    expect(read.isError).toBe(false);
    expect(read.content).toContain('Body text');
    expect((await editor.save()).blocks.map((block) => block.id)).toEqual(['pg', 'p']);
  });

  it('a sub-page follows the agent.overrides of this editor', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }]]);
    const editor = await boot(host(pages), undefined, { agent: { overrides: { header: { hidden: true } } } });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const insert = { name: 'block.insert', args: { type: 'header', data: { text: 'Hidden', level: 2 }, position: 'end' } };
    const main = await turn.execute({ commands: [insert] });
    const inSub = await turn.call('blok_execute', { page: 'pg', commands: [insert] });

    turn.end();
    expect(main).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TOOL' } });
    expect(inSub.isError).toBe(true);
    expect(inSub.content).toContain('UNKNOWN_TOOL');
    expect(sub(pages).blocks).toEqual([]);
  });

  it('a sub-page re-hosts media through the host uploader', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [{ id: 'img', type: 'image', data: { url: 'https://old.example/a.png' } }] }]]);
    const uploadByUrl = vi.fn(async (url: string) => ({ url: `https://cdn.example/${url.split('/').pop() ?? ''}` }));
    const editor = await boot(host(pages), undefined, { uploader: { uploadByUrl } });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.call('blok_execute', { page: 'pg', commands: [
      { name: 'image.setSource', args: { id: 'img', url: 'https://elsewhere.example/b.png' } },
    ] });

    turn.end();
    expect(result.isError).toBe(false);
    expect(sub(pages).blocks[0]?.data.url).toBe('https://cdn.example/b.png');
  });

  it('page.rename works on a page block inside a sub-page', async () => {
    const pages = new Map<string, OutputData>([
      ['sub', { blocks: [{ id: 'deep', type: 'page', data: { pageId: 'nested' } }] }],
      ['nested', { blocks: [] }],
    ]);
    const editor = await boot(host(pages));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.call('blok_execute', { page: 'pg', commands: [
      { name: 'page.rename', args: { id: 'deep', title: 'Deep' } },
    ] });

    turn.end();
    expect(result.isError).toBe(false);
    expect(pages.get('nested')?.title).toBe('Deep');
  });

  it('page.rename in a sub-page does not reach a pageId the agent wrote there in the same call', async () => {
    const pages = new Map<string, OutputData>([
      ['sub', { blocks: [{ id: 'deep', type: 'page', data: { pageId: 'nested' } }] }],
      ['nested', { blocks: [] }],
      ['other', { title: 'Private', blocks: [] }],
    ]);
    const editor = await boot(host(pages));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.call('blok_execute', { page: 'pg', commands: [{ name: 'block.update', args: { id: 'deep', data: { pageId: 'other' } } }] });
    const renamed = await turn.call('blok_execute', { page: 'pg', commands: [{ name: 'page.rename', args: { id: 'deep', title: 'Taken' } }] });

    turn.end();
    expect(renamed.isError).toBe(true);
    expect(pages.get('other')?.title).toBe('Private');
  });

  it('page.rename in a sub-page does not reach a pageId the agent wrote there in an earlier turn', async () => {
    const pages = new Map<string, OutputData>([
      ['sub', { blocks: [{ id: 'deep', type: 'page', data: { pageId: 'nested' } }] }],
      ['nested', { blocks: [] }],
      ['other', { title: 'Private', blocks: [] }],
    ]);
    const editor = await boot(host(pages));
    const first = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await first.call('blok_execute', { page: 'pg', commands: [{ name: 'block.update', args: { id: 'deep', data: { pageId: 'other' } } }] });
    first.end();
    const second = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const renamed = await second.call('blok_execute', { page: 'pg', commands: [{ name: 'page.rename', args: { id: 'deep', title: 'Taken' } }] });

    second.end();
    expect(renamed.isError).toBe(true);
    expect(pages.get('other')?.title).toBe('Private');
  });

  it('page must name a page block', async () => {
    const editor = await boot(host(new Map([['sub', { blocks: [] }]])));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.call('blok_read', { page: 'p' });

    turn.end();
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not a page block');
  });

  it('offers page on blok_read and blok_execute only when the host has both document hooks', async () => {
    const withHooks = await boot(host(new Map([['sub', { blocks: [] }]])));
    const offered = await withHooks.agent.tools({ format: 'anthropic' });
    const plain = await boot({ create: () => undefined });
    const without = await plain.agent.tools({ format: 'anthropic' });
    const pageField = (tools: Array<{ name: string; input_schema: Record<string, unknown> }>): string[] =>
      tools.filter(({ input_schema: { properties } }) => typeof properties === 'object' && properties !== null && 'page' in properties)
        .map((tool) => tool.name);

    expect(pageField(offered)).toEqual(['blok_read', 'blok_execute']);
    expect(pageField(without)).toEqual([]);
  });

  it('discarding an Ask AI run puts each sub-page it wrote back the way it was', async () => {
    const before: OutputData = { title: 'Before', blocks: [{ id: 'old', type: 'paragraph', data: { text: [{ text: 'Old' }] } }] };
    const pages = new Map<string, OutputData>([['sub', structuredClone(before)]]);
    const replies: AgentModelResponse[] = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'blok_execute', input: { page: 'pg', commands: [
        { name: 'doc.setTitle', args: { title: 'After' } },
        { name: 'block.insert', args: { type: 'paragraph', data: { text: 'New' }, position: 'end' } },
      ] } }] },
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c2', name: 'blok_execute', input: { page: 'pg', commands: [
        { name: 'block.insert', args: { type: 'paragraph', data: { text: 'Newer' }, position: 'end' } },
      ] } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] },
    ];
    const editor = await boot(host(pages), async () => {
      const next = replies.shift();

      if (next === undefined) {
        throw new Error('unscripted model call');
      }

      return next;
    });
    const run = editor.agent.ask('Fill the sub-page');

    expect((await run.result).status).toBe('done');
    expect(sub(pages).title).toBe('After');
    expect(sub(pages).blocks).toHaveLength(3);

    await run.discard();

    expect(sub(pages)).toEqual(before);
  });

  it('a read-only editor reads a sub-page but does not write it', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }]]);
    const editor = await boot(host(pages));

    await editor.readOnly.toggle(true);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const read = await turn.call('blok_read', { page: 'pg' });
    const written = await turn.call('blok_execute', { page: 'pg', commands: [{ name: 'doc.setTitle', args: { title: 'Nope' } }] });

    turn.end();
    expect(read.isError).toBe(false);
    expect(written.isError).toBe(true);
    expect(written.content).toContain('READ_ONLY');
    expect(sub(pages).title).toBeUndefined();
  });

  it('a page block the agent pointed somewhere else in this turn does not open that document', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }], ['other', { title: 'Private', blocks: [] }]]);
    const editor = await boot(host(pages));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute({ commands: [{ name: 'block.update', args: { id: 'pg', data: { pageId: 'other' } } }] });
    const read = await turn.call('blok_read', { page: 'pg' });
    const written = await turn.call('blok_execute', { page: 'pg', commands: [{ name: 'doc.setTitle', args: { title: 'Taken' } }] });

    turn.end();
    expect(read.content).not.toContain('Private');
    expect(written.isError).toBe(true);
    expect(pages.get('other')?.title).toBe('Private');
  });

  it('a page the agent inserted in this turn opens, under the id the host gave it', async () => {
    const pages = new Map<string, OutputData>();
    const editor = await boot({ ...host(pages), create: () => {
      pages.set('made', { blocks: [] });

      return { pageId: 'made' };
    } });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const inserted = await turn.execute({ commands: [{ name: 'block.insert', args: { type: 'page', id: 'np', position: 'end' } }] });
    const written = await turn.call('blok_execute', { page: 'np', commands: [{ name: 'doc.setTitle', args: { title: 'Fresh' } }] });

    turn.end();
    expect(inserted.ok).toBe(true);
    expect(written.isError).toBe(false);
    expect(pages.get('made')?.title).toBe('Fresh');
  });

  it('a pageId the agent wrote in an earlier turn still does not open that document', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }], ['other', { title: 'Private', blocks: [] }]]);
    const editor = await boot(host(pages));
    const first = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await first.execute({ commands: [{ name: 'block.update', args: { id: 'pg', data: { pageId: 'other' } } }] });
    first.end();
    const second = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const read = await second.call('blok_read', { page: 'pg' });
    const written = await second.call('blok_execute', { page: 'pg', commands: [{ name: 'doc.setTitle', args: { title: 'Taken' } }] });

    second.end();
    expect(read.content).not.toContain('Private');
    expect(written.isError).toBe(true);
    expect(pages.get('other')?.title).toBe('Private');
  });

  it('a page the agent inserts with a pageId of its own does not open that document, now or later', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }], ['other', { title: 'Private', blocks: [] }]]);
    const editor = await boot({ ...host(pages), create: () => ({ pageId: 'fresh' }) });
    const first = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await first.execute({ commands: [{ name: 'block.insert', args: { type: 'page', id: 'np', data: { pageId: 'other' }, position: 'end' } }] });
    const now = await first.call('blok_read', { page: 'np' });

    first.end();
    const second = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const later = await second.call('blok_read', { page: 'np' });

    second.end();
    expect(now.content).not.toContain('Private');
    expect(later.content).not.toContain('Private');
  });

  it('a page block the agent only restyled still opens in a later turn', async () => {
    const pages = new Map<string, OutputData>([['sub', { title: 'Sub', blocks: [] }]]);
    const editor = await boot(host(pages));
    const first = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const styled = await first.execute({ commands: [{ name: 'block.update', args: { id: 'pg', data: { textColor: 'red' } } }] });

    first.end();
    const second = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const read = await second.call('blok_read', { page: 'pg' });

    second.end();
    expect(styled.ok).toBe(true);
    expect(read.isError).toBe(false);
  });
});

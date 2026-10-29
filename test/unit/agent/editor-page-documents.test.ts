import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import type { Core } from '../../../src/components/core';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import { Header, Image, Page, Paragraph } from '../../../src/tools';
import type { Agent, API, BlokConfig, OutputData } from '../../../types';
import type { AgentModel, AgentModelResponse } from '../../../types/api';
import type { PageConfig, PageIcon } from '../../../types/tools/page';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  agent: Agent;
  save: () => Promise<OutputData>;
  blocks: API['blocks'];
  readOnly: { toggle(state?: boolean): Promise<boolean> };
  history: API['history'];
}

const editors: TestEditor[] = [];

/** Exposes the modules, so a test can start a user gesture. */
class BootedEditor extends Blok {
  public moduleGraph: BlokModules | undefined;

  public override exportAPI(core: Core): void {
    this.moduleGraph = core.moduleInstances;
    super.exportAPI(core);
  }
}

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
  const editor = new BootedEditor({
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

  it('a sub-page document is sanitized as it loads, as render sanitizes this one', async () => {
    const unknownBlock = { id: 'u1', type: 'mystery', data: { html: '<img src=x onerror="alert(2)">' } };
    const pages = new Map<string, OutputData>([['sub', { blocks: [
      { id: 's1', type: 'paragraph', data: { text: 'secret <img src=x onerror="alert(1)">' } },
      unknownBlock,
    ] }]]);
    const editor = await boot(host(pages));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const read = await turn.call('blok_read', { page: 'pg' });
    const written = await turn.call('blok_execute', { page: 'pg', commands: [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: 'More' }, position: 'end' } },
    ] });

    turn.end();
    expect(read.content).not.toContain('alert(1)');
    expect(written.isError).toBe(false);
    expect(JSON.stringify(sub(pages).blocks.find((block) => block.id === 's1'))).not.toContain('onerror');
    // An unregistered tool's data is not ours to clean: the save would lose it on the host.
    expect(sub(pages).blocks.find((block) => block.id === 'u1')).toEqual(unknownBlock);
  });

  it('a sub-page follows the agent.overrides of this editor', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }]]);
    const editor = await boot(host(pages), undefined, { agent: { overrides: { header: { hidden: true } } } });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const insert = { name: 'block.insert', args: { type: 'header', data: { text: 'Hidden', level: 2 }, position: 'end' } } as const;
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

  it('page.rename in a sub-page reaches only the page its block was given, in the same call', async () => {
    const pages = new Map<string, OutputData>([
      ['sub', { blocks: [{ id: 'deep', type: 'page', data: { pageId: 'nested' } }] }],
      ['nested', { blocks: [] }],
      ['other', { title: 'Private', blocks: [] }],
    ]);
    const editor = await boot(host(pages));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    const repointed = await turn.call('blok_execute', { page: 'pg', commands: [{ name: 'block.update', args: { id: 'deep', data: { pageId: 'other' } } }] });
    await turn.call('blok_execute', { page: 'pg', commands: [{ name: 'page.rename', args: { id: 'deep', title: 'Taken' } }] });

    turn.end();
    expect(repointed.isError).toBe(true);
    expect(pages.get('other')?.title).toBe('Private');
    expect(pages.get('nested')?.title).toBe('Taken');
  });

  it('page.rename in a sub-page reaches only the page its block was given, in a later turn', async () => {
    const pages = new Map<string, OutputData>([
      ['sub', { blocks: [{ id: 'deep', type: 'page', data: { pageId: 'nested' } }] }],
      ['nested', { blocks: [] }],
      ['other', { title: 'Private', blocks: [] }],
    ]);
    const editor = await boot(host(pages));
    const first = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    const repointed = await first.call('blok_execute', { page: 'pg', commands: [{ name: 'block.update', args: { id: 'deep', data: { pageId: 'other' } } }] });
    first.end();
    const second = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    await second.call('blok_execute', { page: 'pg', commands: [{ name: 'page.rename', args: { id: 'deep', title: 'Taken' } }] });

    second.end();
    expect(repointed.isError).toBe(true);
    expect(pages.get('other')?.title).toBe('Private');
    expect(pages.get('nested')?.title).toBe('Taken');
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

  const scriptedModel = (replies: AgentModelResponse[]): AgentModel => async () => {
    const next = replies.shift();

    if (next === undefined) {
      throw new Error('unscripted model call');
    }

    return next;
  };
  const subInsert = (id: string, text: string): AgentModelResponse => ({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id, name: 'blok_execute', input: { page: 'pg', commands: [
      { name: 'block.insert', args: { type: 'paragraph', data: { text }, position: 'end' } },
    ] } }],
  });
  const done: AgentModelResponse = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] };
  const texts = (data: OutputData): unknown[] => data.blocks.map((block) => block.data.text);
  const userTypes = (pages: Map<string, OutputData>, text: string): void => {
    const current = sub(pages);

    pages.set('sub', { ...current, blocks: [...current.blocks, { id: `u-${text}`, type: 'paragraph', data: { text: [{ text }] } }] });
  };

  it('history.undo after page.rename refuses with UNDO_OTHER_DOCUMENT and keeps the batch before it', async () => {
    const pages = new Map<string, OutputData>([['sub', { title: 'Old', blocks: [] }]]);
    const editor = await boot(host(pages));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute({ commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'A' }, position: 'end' } }] });
    expect(await turn.execute({ commands: [{ name: 'page.rename', args: { id: 'pg', title: 'New' } }] })).toMatchObject({ ok: true });

    expect(await turn.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: false, error: { code: 'UNDO_OTHER_DOCUMENT' } });
    turn.end();
    expect((await editor.save()).blocks).toHaveLength(3);
    expect(sub(pages).title).toBe('New');
  });

  it('history.undo undoes a batch after page.rename, then refuses at the rename', async () => {
    const pages = new Map<string, OutputData>([['sub', { title: 'Old', blocks: [] }]]);
    const editor = await boot(host(pages));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const insert = (text: string): Parameters<typeof turn.execute>[0] => ({ commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text }, position: 'end' } }] });

    await turn.execute(insert('A'));
    await turn.execute({ commands: [{ name: 'page.rename', args: { id: 'pg', title: 'New' } }] });
    await turn.execute(insert('B'));

    expect(await turn.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: true });
    expect(await turn.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: false, error: { code: 'UNDO_OTHER_DOCUMENT' } });
    turn.end();
    expect((await editor.save()).blocks).toHaveLength(3);
  });

  it('discard keeps a sub-page someone edited after the agent last saved it', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [{ id: 'old', type: 'paragraph', data: { text: [{ text: 'Old' }] } }] }]]);
    const editor = await boot(host(pages), scriptedModel([subInsert('c1', 'SubNew'), done]));
    const run = editor.agent.ask('Fill the sub-page');

    await run.result;
    userTypes(pages, 'UserTyped');

    await expect(run.discard()).resolves.toBe(false);
    expect(texts(sub(pages))).toEqual([[{ text: 'Old' }], [{ text: 'SubNew' }], [{ text: 'UserTyped' }]]);
  });

  it('discard keeps a sub-page someone edited between two agent writes', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [{ id: 'old', type: 'paragraph', data: { text: [{ text: 'Old' }] } }] }]]);
    const replies = [subInsert('c1', 'First'), done, subInsert('c2', 'Second'), done];
    const editor = await boot(host(pages), scriptedModel(replies));
    const run = editor.agent.ask('Fill the sub-page');

    await run.result;
    userTypes(pages, 'UserTyped');
    await run.followUp('More');

    await expect(run.discard()).resolves.toBe(false);
    expect(texts(sub(pages))).toEqual([[{ text: 'Old' }], [{ text: 'First' }], [{ text: 'UserTyped' }], [{ text: 'Second' }]]);
  });

  it('discard is false when the user typed after the agent in the main document, though the sub-page is restored', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [{ id: 'old', type: 'paragraph', data: { text: [{ text: 'Old' }] } }] }]]);
    const mainInsert: AgentModelResponse = {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'm1', name: 'blok_execute', input: { commands: [
        { name: 'block.insert', args: { type: 'paragraph', data: { text: 'MainNew' }, position: 'end' } },
      ] } }],
    };
    const editor = await boot(host(pages), scriptedModel([subInsert('c1', 'SubNew'), mainInsert, done]));
    const run = editor.agent.ask('Write both');

    await run.result;
    // A user edit: its own undo step.
    (editor as unknown as BootedEditor).moduleGraph?.YjsManager.beginGesture('discrete');
    editor.blocks.insert('paragraph', { text: 'UserTyped' });
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    await expect(run.discard()).resolves.toBe(false);
    expect(texts(sub(pages))).toEqual([[{ text: 'Old' }]]);
    expect((await editor.save()).blocks.map((block) => block.data.text)).toContainEqual([{ text: 'MainNew' }]);
  });

  it('Cmd+Z in this editor leaves the agent\'s sub-page write in place, and Discard reverts it', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [{ id: 'old', type: 'paragraph', data: { text: [{ text: 'Old' }] } }] }]]);
    const mainInsert: AgentModelResponse = {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'm1', name: 'blok_execute', input: { commands: [
        { name: 'block.insert', args: { type: 'paragraph', data: { text: 'MainNew' }, position: 'end' } },
      ] } }],
    };
    const editor = await boot(host(pages), scriptedModel([subInsert('c1', 'SubNew'), mainInsert, done]));
    const run = editor.agent.ask('Write both');

    await run.result;
    editor.history.undo();

    expect(texts(sub(pages))).toEqual([[{ text: 'Old' }], [{ text: 'SubNew' }]]);
    expect((await editor.save()).blocks.map((block) => block.data.text)).not.toContainEqual([{ text: 'MainNew' }]);

    await run.discard();

    expect(texts(sub(pages))).toEqual([[{ text: 'Old' }]]);
  });

  it('discard restores a sub-page the host stored as HTML and nobody touched after the agent', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [{ id: 'old', type: 'paragraph', data: { text: 'Old' } }] }]]);
    const editor = await boot(host(pages), scriptedModel([subInsert('c1', 'SubNew'), done]));
    const run = editor.agent.ask('Fill the sub-page');

    await run.result;

    await expect(run.discard()).resolves.toBe(true);
    expect(texts(sub(pages))).toEqual(['Old']);
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

  it('an agent cannot point a page block somewhere else, so this turn opens only the real page', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }], ['other', { title: 'Private', blocks: [] }]]);
    const editor = await boot(host(pages));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    const repointed = await turn.execute({ commands: [{ name: 'block.update', args: { id: 'pg', data: { pageId: 'other' } } }] });
    const read = await turn.call('blok_read', { page: 'pg' });
    await turn.call('blok_execute', { page: 'pg', commands: [{ name: 'doc.setTitle', args: { title: 'Taken' } }] });

    turn.end();
    expect(repointed).toMatchObject({ ok: false, error: { code: 'FIELD_NOT_WRITABLE' } });
    expect(read.content).not.toContain('Private');
    expect(pages.get('other')?.title).toBe('Private');
    expect(pages.get('sub')?.title).toBe('Taken');
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

  it('a page the agent inserted opens and takes blocks, title and icon when the host has no create', async () => {
    const pages = new Map<string, OutputData>();
    const editor = await boot({
      loadDocument: (pageId: string) => structuredClone(pages.get(pageId) ?? null),
      saveDocument: (pageId: string, data: OutputData) => {
        pages.set(pageId, structuredClone(data));
      },
    });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const inserted = await turn.execute({ commands: [{ name: 'block.insert', args: { type: 'page', id: 'np', position: 'end' } }] });
    const written = await turn.call('blok_execute', { page: 'np', commands: [
      { name: 'doc.setTitle', args: { title: 'Fresh' } },
      { name: 'doc.setIcon', args: { icon: { type: 'emoji', value: '🌱' } } },
      { name: 'block.insert', args: { type: 'paragraph', data: { text: 'Inside' }, position: 'end' } },
    ] });

    turn.end();
    const pageId = (await editor.save()).blocks.find((block) => block.id === 'np')?.data.pageId;

    expect(written.isError, written.content).toBe(false);
    expect(inserted.ok).toBe(true);
    expect(typeof pageId).toBe('string');
    const made = pages.get(String(pageId));

    expect(made?.title).toBe('Fresh');
    expect(made?.icon).toEqual({ type: 'emoji', value: '🌱' });
    expect(made?.blocks.map((block) => block.data.text)).toEqual([[{ text: 'Inside' }]]);
  });

  it('a page the agent inserts inside a sub-page gets a document from the host create', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }]]);
    const editor = await boot({ ...host(pages), create: () => {
      pages.set('made', { blocks: [] });

      return { pageId: 'made' };
    } });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const written = await turn.call('blok_execute', { page: 'pg', commands: [
      { name: 'block.insert', args: { type: 'page', id: 'inner', position: 'end' } },
    ] });

    turn.end();
    expect(written.isError, written.content).toBe(false);
    expect(sub(pages).blocks).toMatchObject([{ id: 'inner', type: 'page', data: { pageId: 'made' } }]);
  });

  it('a page inserted inside a sub-page can be renamed there when the host has no create', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }]]);
    const editor = await boot({
      loadDocument: (pageId: string) => structuredClone(pages.get(pageId) ?? null),
      saveDocument: (pageId: string, data: OutputData) => {
        pages.set(pageId, structuredClone(data));
      },
    });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const inserted = await turn.call('blok_execute', { page: 'pg', commands: [
      { name: 'block.insert', args: { type: 'page', id: 'inner', position: 'end' } },
    ] });
    const renamed = await turn.call('blok_execute', { page: 'pg', commands: [{ name: 'page.rename', args: { id: 'inner', title: 'Deep' } }] });

    turn.end();
    const pageId = sub(pages).blocks.find((block) => block.id === 'inner')?.data.pageId;

    expect(renamed.isError, renamed.content).toBe(false);
    expect(inserted.isError).toBe(false);
    expect(pages.get(String(pageId))?.title).toBe('Deep');
  });

  it('an agent cannot point a page block somewhere else, so a later turn opens only the real page', async () => {
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }], ['other', { title: 'Private', blocks: [] }]]);
    const editor = await boot(host(pages));
    const first = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    const repointed = await first.execute({ commands: [{ name: 'block.update', args: { id: 'pg', data: { pageId: 'other' } } }] });
    first.end();
    const second = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const read = await second.call('blok_read', { page: 'pg' });
    await second.call('blok_execute', { page: 'pg', commands: [{ name: 'doc.setTitle', args: { title: 'Taken' } }] });

    second.end();
    expect(repointed).toMatchObject({ ok: false, error: { code: 'FIELD_NOT_WRITABLE' } });
    expect(read.content).not.toContain('Private');
    expect(pages.get('other')?.title).toBe('Private');
    expect(pages.get('sub')?.title).toBe('Taken');
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

describe('Discard and a page write through the host rename and setIcon hooks', () => {
  type Info = { title?: string; icon?: PageIcon };
  const ROSE: PageIcon = { type: 'emoji', value: '🌹' };
  const PIZZA: PageIcon = { type: 'emoji', value: '🍕' };
  /** A host that keeps page titles and icons itself, as a page tree does. */
  const hookHost = (info: Map<string, Info>, overrides: Partial<PageConfig> = {}): PageConfig & Record<string, unknown> => ({
    ...host(new Map([['sub', { blocks: [] }]])),
    resolve: (pageId) => structuredClone(info.get(pageId) ?? null),
    rename: (pageId, title) => {
      info.set(pageId, { ...info.get(pageId), title });
    },
    setIcon: (pageId, icon) => {
      info.set(pageId, { ...info.get(pageId), icon: icon ?? undefined });
    },
    ...overrides,
  });
  const call = (id: string, name: string, args: Record<string, unknown>): AgentModelResponse => ({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id, name: 'blok_execute', input: { commands: [{ name, args }] } }],
  });
  const done: AgentModelResponse = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] };
  const model = (replies: AgentModelResponse[]): AgentModel => async () => {
    const next = replies.shift();

    if (next === undefined) {
      throw new Error('unscripted model call');
    }

    return next;
  };

  it('calls the hooks again with the old title and icon, and resolves true', async () => {
    const info = new Map<string, Info>([['sub', { title: 'Old', icon: ROSE }]]);
    const editor = await boot(hookHost(info), model([
      call('c1', 'page.rename', { id: 'pg', title: 'New' }),
      call('c2', 'page.setIcon', { id: 'pg', icon: PIZZA }),
      done,
    ]));
    const run = editor.agent.ask('Rename the page');

    await run.result;
    expect(info.get('sub')).toEqual({ title: 'New', icon: PIZZA });

    await expect(run.discard()).resolves.toBe(true);
    expect(info.get('sub')).toEqual({ title: 'Old', icon: ROSE });
  });

  it('keeps a title someone changed after the agent, and resolves false', async () => {
    const info = new Map<string, Info>([['sub', { title: 'Old' }]]);
    const editor = await boot(hookHost(info), model([call('c1', 'page.rename', { id: 'pg', title: 'New' }), done]));
    const run = editor.agent.ask('Rename the page');

    await run.result;
    info.set('sub', { title: 'Mine' });

    await expect(run.discard()).resolves.toBe(false);
    expect(info.get('sub')).toEqual({ title: 'Mine' });
  });

  it('resolves false when the revert hook throws', async () => {
    const info = new Map<string, Info>([['sub', { title: 'Old' }]]);
    const calls = { count: 0 };
    const editor = await boot(hookHost(info, {
      rename: (pageId, title) => {
        calls.count += 1;
        if (calls.count > 1) {
          throw new Error('offline');
        }
        info.set(pageId, { title });
      },
    }), model([call('c1', 'page.rename', { id: 'pg', title: 'New' }), done]));
    const run = editor.agent.ask('Rename the page');

    await run.result;

    await expect(run.discard()).resolves.toBe(false);
    expect(info.get('sub')).toEqual({ title: 'New' });
  });

  it('resolves false when the host has no resolve hook, so the old title is unknown', async () => {
    const info = new Map<string, Info>([['sub', { title: 'Old' }]]);
    const config = hookHost(info);

    delete config.resolve;
    const editor = await boot(config, model([call('c1', 'page.rename', { id: 'pg', title: 'New' }), done]));
    const run = editor.agent.ask('Rename the page');

    await run.result;

    await expect(run.discard()).resolves.toBe(false);
    expect(info.get('sub')).toEqual({ title: 'New' });
  });
});

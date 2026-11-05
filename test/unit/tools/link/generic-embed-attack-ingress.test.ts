// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import Blok from '../../../../src/blok';
import { Core } from '../../../../src/components/core';
import { Embed } from '../../../../src/tools/link/embed';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Bookmark } from '../../../../src/tools/link/bookmark';
import { GENERIC_IFRAME_SANDBOX } from '../../../../src/shared/embed-frame';
import { normalizeEmbed, rejectEmbedWrite } from '../../../../src/shared/tool-actions/link';
import { htmlToBlocksWithReport } from '../../../../src/view/html-to-blocks';
import { markdownToBlocks } from '../../../../src/markdown';
import { loadPasteEngine } from '../../helpers/paste-engine';
import type { API, BlokConfig, OutputBlockData, OutputData } from '../../../../types';
import type { Agent, AgentCommand } from '../../../../types';

type LinkPaste = NonNullable<BlokConfig['linkPaste']>;

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  caret: API['caret'];
  blocks: API['blocks'];
  agent: Agent;
}

const ATTACKER = 'https://attacker.test/phish';
const YT = 'https://www.youtube.com/watch?v=ABC123';

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const settleMany = async (n = 6): Promise<void> => {
  for (let i = 0; i < n; i++) {
    await settle();
  }
};

// jsdom keeps contentEditable as a plain property; core queries the attribute, as in a browser.
const reflected = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'contentEditable');

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'contentEditable', {
    configurable: true,
    get(this: HTMLElement): string {
      return this.getAttribute('contenteditable') ?? 'inherit';
    },
    set(this: HTMLElement, value: string) {
      this.setAttribute('contenteditable', String(value));
    },
  });
});

afterAll(() => {
  if (reflected !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'contentEditable', reflected);
  }
});

let holder: HTMLDivElement;
let editor: TestEditor | undefined;
let core: Core | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  holder = document.createElement('div');
  document.body.append(holder);
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  core = undefined;
  holder.remove();
  vi.restoreAllMocks();
});

const boot = async (linkPaste: LinkPaste | undefined, blocks: OutputBlockData[] = [{ id: 'before', type: 'paragraph', data: { text: '' } }]): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    tools: { paragraph: Paragraph, embed: Embed, bookmark: Bookmark },
    ...(linkPaste === undefined ? {} : { linkPaste }),
    data: { blocks },
  }) as unknown as TestEditor;
  await editor.isReady;
  await settleMany();

  return editor;
};

/** Every live frame-ish sink in the editor. */
const liveSinks = (): string[] => Array.from(holder.querySelectorAll('iframe, frame, embed, object, script'))
  .map(el => `${el.tagName.toLowerCase()} ${el.getAttribute('src') ?? el.getAttribute('data') ?? ''}`);

const paste = async (instance: TestEditor, data: Record<string, string>): Promise<void> => {
  const target = Array.from(holder.querySelectorAll<HTMLElement>('[data-blok-id="before"] *'))
    .find(element => element.contentEditable === 'true');

  if (target === undefined) {
    throw new Error('no paragraph input');
  }
  target.focus();
  instance.caret.setToBlock('before', 'end');
  await loadPasteEngine();
  // Wait for the real paste to finish, not for a fixed number of timers.
  const module = (instance as unknown as { module: { paste: { processDataTransfer(...args: unknown[]): Promise<void> } } }).module.paste;
  const run = module.processDataTransfer.bind(module);
  const pasted: Array<Promise<void>> = [];

  module.processDataTransfer = (...args) => {
    const done = run(...args);

    pasted.push(done);

    return done;
  };
  target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
    clipboardData: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
  }));
  await vi.waitFor(() => expect(pasted).toHaveLength(1));
  await Promise.all(pasted);
  await settleMany(10);
};

const crafted = (data: Record<string, unknown>): string => JSON.stringify([{ id: 'x1', tool: 'embed', data }]);

describe('forged application/x-blok clipboard (also drag-drop: same processDataTransfer)', () => {
  it('a generic embed of an attacker URL does not frame when the host never opted in', async () => {
    const instance = await boot(undefined);

    await paste(instance, { 'application/x-blok': crafted({ service: '', source: ATTACKER, embed: ATTACKER, kind: 'iframe' }) });

    const saved = await instance.save();

    expect(liveSinks()).toEqual([]);
    expect(saved.blocks.some(b => b.type === 'embed')).toBe(true);
  });

  it('kind:"script" on a generic embed never loads a widget script, even with the opt-in', async () => {
    await boot({ allowGenericEmbed: true, genericEmbedClickToLoad: false });
    await paste(editor as TestEditor, { 'application/x-blok': crafted({ service: '', source: ATTACKER, embed: 'https://platform.twitter.com/widgets.js', kind: 'script' }) });

    const sinks = liveSinks();

    expect(sinks.filter(s => s.startsWith('script'))).toEqual([]);
    expect(sinks).toEqual([`iframe ${ATTACKER}`]);
    expect(holder.querySelector('iframe')?.getAttribute('sandbox')).toBe(GENERIC_IFRAME_SANDBOX);
    expect(holder.querySelector('iframe')?.hasAttribute('allow')).toBe(false);
  });

  it('a registry service with an attacker source and embed frames nothing', async () => {
    await boot({ allowGenericEmbed: true, genericEmbedClickToLoad: false });
    await paste(editor as TestEditor, { 'application/x-blok': crafted({ service: 'youtube', source: ATTACKER, embed: ATTACKER, kind: 'iframe' }) });

    expect(liveSinks()).toEqual([]);
    expect(holder.querySelectorAll('[data-blok-tool="embed"]').length).toBe(1);
  });

  it('a registry block keeps its src derived from source, never the stored embed', async () => {
    await boot(undefined);
    await paste(editor as TestEditor, { 'application/x-blok': crafted({ service: 'youtube', source: YT, embed: ATTACKER, kind: 'iframe' }) });

    expect(liveSinks()).toEqual(['iframe https://www.youtube.com/embed/ABC123']);
  });

  it('blockedEmbedOrigins and the own site still win over a pasted generic block', async () => {
    await boot({ allowGenericEmbed: true, genericEmbedClickToLoad: false, blockedEmbedOrigins: ['attacker.test'] });
    await paste(editor as TestEditor, { 'application/x-blok': JSON.stringify([
      { id: 'x1', tool: 'embed', data: { service: '', source: ATTACKER, embed: ATTACKER } },
      { id: 'x2', tool: 'embed', data: { service: '', source: `https://${location.hostname}/admin`, embed: `https://${location.hostname}/admin` } },
    ]) });

    expect(liveSinks()).toEqual([]);
    expect(holder.querySelectorAll('[data-blok-tool="embed"]').length).toBe(2);
  });

  it('prototype keys as service do not reach a registry sandbox profile', async () => {
    await boot({ allowGenericEmbed: true, genericEmbedClickToLoad: false });
    await paste(editor as TestEditor, { 'application/x-blok': JSON.stringify(['constructor', '__proto__', 'toString', 'hasOwnProperty'].map((service, i) => (
      { id: `p${i}`, tool: 'embed', data: { service, source: ATTACKER, embed: ATTACKER } }
    ))) });

    expect(holder.querySelectorAll('[data-blok-tool="embed"]').length).toBe(4);
    // Either inert or the generic profile; never a registry profile (no popup escape, no allow attr).
    for (const frame of Array.from(holder.querySelectorAll('iframe'))) {
      expect(frame.getAttribute('sandbox')).toBe(GENERIC_IFRAME_SANDBOX);
    }
    expect(holder.querySelectorAll('iframe[allow]').length).toBe(0);
  });

  it('checkEmbed is not asked for a pasted Blok block (documented: it runs only on the paste menu and URL input)', async () => {
    const checkEmbed = vi.fn(async () => ({ verdict: 'blocked' as const }));

    await boot({ allowGenericEmbed: true, genericEmbedClickToLoad: false, checkEmbed });
    await paste(editor as TestEditor, { 'application/x-blok': crafted({ service: '', source: ATTACKER, embed: ATTACKER }) });

    expect(checkEmbed).not.toHaveBeenCalled();
    expect(liveSinks()).toEqual([`iframe ${ATTACKER}`]);
  });

  it('click-to-load (the default) still gates a pasted generic block', async () => {
    await boot({ allowGenericEmbed: true });
    await paste(editor as TestEditor, { 'application/x-blok': crafted({ service: '', source: ATTACKER, embed: ATTACKER }) });

    expect(liveSinks()).toEqual([]);
    expect(holder.querySelector('[data-role="embed-load"]')).not.toBeNull();
  });
});

describe('pasted / dropped HTML and plain text', () => {
  const HTML = [
    `<iframe src="${ATTACKER}?a"></iframe>`,
    `<embed src="${ATTACKER}?b">`,
    `<object data="${ATTACKER}?c"></object>`,
    `<frameset><frame src="${ATTACKER}?d"></frameset>`,
    `<p><a href="${YT}">yt link</a> <a href="${ATTACKER}">evil link</a></p>`,
  ].join('');

  it('iframe/embed/object/frame tags never become frames or embed blocks', async () => {
    const instance = await boot({ allowGenericEmbed: true, genericEmbedClickToLoad: false });

    await paste(instance, { 'text/html': HTML, 'text/plain': 'x' });
    const saved = await instance.save();

    expect(liveSinks()).toEqual([]);
    expect(saved.blocks.filter(b => b.type === 'embed')).toEqual([]);
    expect(JSON.stringify(saved.blocks)).toContain('evil link');
  });

  it('a pasted plain attacker URL inserts a link, not an embed, until the person picks one', async () => {
    const instance = await boot({ allowGenericEmbed: true, genericEmbedClickToLoad: false });

    await paste(instance, { 'text/plain': ATTACKER });
    const saved = await instance.save();

    expect(JSON.stringify(saved.blocks)).toContain('attacker.test');
    expect(liveSinks()).toEqual([]);
    expect(saved.blocks.filter(b => b.type === 'embed')).toEqual([]);
  });

  it('Embed.pasteConfig patterns are registry-only: no pattern matches a non-registry URL', () => {
    const config = Embed.pasteConfig;
    const patterns = config === false ? [] : Object.values(config.patterns ?? {});

    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.filter(p => p.test(ATTACKER))).toEqual([]);
  });
});

describe('importers', () => {
  it('htmlToBlocks drops iframe/embed/object/frame and makes no embed block', () => {
    const result = htmlToBlocksWithReport(`<p>a</p><iframe src="${ATTACKER}"></iframe><embed src="${ATTACKER}"><object data="${ATTACKER}"></object><frameset><frame src="${ATTACKER}"></frameset>`);

    expect(result.blocks.filter(b => b.type === 'embed')).toEqual([]);
    expect(JSON.stringify(result.blocks)).not.toContain('attacker.test');
  });

  it('markdownToBlocks makes no embed block from raw iframe HTML or a bare URL', async () => {
    const blocks = await markdownToBlocks(`<iframe src="${ATTACKER}"></iframe>\n\n${ATTACKER}\n\n[x](${YT})\n`);

    expect(blocks.filter(b => b.type === 'embed')).toEqual([]);
    // The raw tag survives only as literal text, never as an html embed segment.
    expect(JSON.stringify(blocks)).not.toContain('"embed"');
    expect(JSON.stringify(blocks)).not.toContain('"html"');
  });
});

describe('public API', () => {
  it('blocks.insert of a generic embed does not frame without the opt-in', async () => {
    const instance = await boot(undefined);

    instance.blocks.insert('embed', { service: '', source: ATTACKER, embed: ATTACKER });
    await settleMany();

    expect(liveSinks()).toEqual([]);
    expect(holder.querySelectorAll('[data-blok-tool="embed"]').length).toBe(1);
  });

  it('blocks.update moving a YouTube block to an attacker source frames nothing', async () => {
    const instance = await boot(undefined, [{ id: 'yt', type: 'embed', data: { service: 'youtube', source: YT, embed: 'https://www.youtube.com/embed/ABC123' } }]);

    expect(liveSinks()).toEqual(['iframe https://www.youtube.com/embed/ABC123']);
    await instance.blocks.update('yt', { service: 'youtube', source: ATTACKER, embed: ATTACKER });
    await settleMany();

    expect(liveSinks()).toEqual([]);
  });

  it('initial data (import / server load) with a generic embed does not frame without the opt-in', async () => {
    await boot(undefined, [{ id: 'g', type: 'embed', data: { service: '', source: ATTACKER, embed: ATTACKER } }]);

    expect(liveSinks()).toEqual([]);
  });

  it('Embed has no setData, so every data change re-runs the render gate', () => {
    expect('setData' in Embed.prototype).toBe(false);
  });
});

describe('agent (Ask AI / MCP) writes', () => {
  const run = async (instance: TestEditor, commands: AgentCommand[]): Promise<unknown> => {
    const turn = instance.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.execute({ commands });

    turn.end();
    await settleMany();

    return result;
  };

  it('rejectEmbedWrite lets a generic http embed through; normalizeEmbed forces kind iframe', () => {
    expect(rejectEmbedWrite({ service: '', source: ATTACKER }, ['source'])).toBeUndefined();
    expect(normalizeEmbed({ service: '', source: ATTACKER, kind: 'script' }).kind).toBe('iframe');
  });

  it('agent block.insert of a generic embed does not frame without the host opt-in', async () => {
    const instance = await boot(undefined);

    await run(instance, [{ name: 'block.insert', args: { type: 'embed', position: 'end', data: { service: '', source: ATTACKER, embed: ATTACKER, kind: 'script' } } }]);
    const saved = await instance.save();

    expect(liveSinks()).toEqual([]);
    expect(saved.blocks.some(b => b.type === 'embed')).toBe(true);
  });

  it('agent block.insert of a generic embed frames (behind click-to-load) when the host opted in, without checkEmbed', async () => {
    const checkEmbed = vi.fn(async () => ({ verdict: 'blocked' as const }));
    const instance = await boot({ allowGenericEmbed: true, checkEmbed });

    await run(instance, [{ name: 'block.insert', args: { type: 'embed', position: 'end', data: { service: '', source: ATTACKER, embed: ATTACKER } } }]);

    expect(checkEmbed).not.toHaveBeenCalled();
    expect(liveSinks()).toEqual([]);
    expect(holder.querySelector('[data-role="embed-load"]')).not.toBeNull();
  });

  it('agent block.convert of a paragraph into a generic embed cannot frame without the opt-in', async () => {
    const instance = await boot(undefined, [{ id: 'before', type: 'paragraph', data: { text: ATTACKER } }]);
    const result = await run(instance, [{ name: 'block.convert', args: { id: 'before', type: 'embed', data: { service: '', source: ATTACKER, embed: ATTACKER } } }]);

    // Paragraph has no conversion into embed, so the agent's convert is refused.
    expect(result).toMatchObject({ ok: false });
    expect(liveSinks()).toEqual([]);
  });

  it('agent html.insert / markdown.insert with iframe tags creates no frame', async () => {
    const instance = await boot({ allowGenericEmbed: true, genericEmbedClickToLoad: false });

    await run(instance, [{ name: 'html.insert', args: { position: { after: 'before' }, html: `<p>a</p><iframe src="${ATTACKER}"></iframe><embed src="${ATTACKER}">` } }]);
    await run(instance, [{ name: 'markdown.insert', args: { position: 'end', markdown: `b\n\n<iframe src="${ATTACKER}"></iframe>\n` } }]);
    const saved = await instance.save();

    expect(liveSinks()).toEqual([]);
    expect(saved.blocks.filter(b => b.type === 'embed')).toEqual([]);
    expect(JSON.stringify(saved.blocks)).toContain('"a"');
  });

  it('agent paragraph text carrying an iframe (string or rich-text html embed) renders no frame', async () => {
    const instance = await boot({ allowGenericEmbed: true, genericEmbedClickToLoad: false });

    await run(instance, [
      { name: 'block.insert', args: { type: 'paragraph', position: 'end', data: { text: `x<iframe src="${ATTACKER}"></iframe>` } } },
      { name: 'block.insert', args: { type: 'paragraph', position: 'end', data: { text: [{ text: 'y' }, { embed: { html: `<iframe src="${ATTACKER}"></iframe>` } }] } } },
    ]);

    expect(liveSinks()).toEqual([]);
    expect(holder.textContent).toContain('x');
    expect(holder.textContent).toContain('y');
  });
});

describe('collaboration peer', () => {
  const DOC = { blocks: [{ id: 'yt', type: 'embed', data: { service: 'youtube', source: YT, embed: 'https://www.youtube.com/embed/ABC123' } }] };

  const bootCore = async (linkPaste?: LinkPaste): Promise<Core> => {
    core = new Core({ holder, tools: { paragraph: { class: Paragraph }, embed: { class: Embed } }, data: DOC, ...(linkPaste ? { linkPaste } : {}) });
    await core.isReady;
    await settleMany();

    return core;
  };

  const peerEdit = (target: Core, edit: (data: Y.Map<unknown>) => void): void => {
    const yjs = target.moduleInstances.YjsManager;
    const peer = new Y.Doc();

    Y.applyUpdate(peer, yjs.encodeStateAsUpdate());
    const data = peer.getMap<Y.Map<unknown>>('blocks').get('yt')?.get('data');

    if (!(data instanceof Y.Map)) {
      throw new Error('no embed data map in the peer doc');
    }
    edit(data);
    yjs.applyRemoteUpdate(Y.encodeStateAsUpdate(peer), { source: 'peer' });
  };

  it('a peer turning a YouTube block into a generic attacker embed frames nothing on a non-opted-in reader', async () => {
    const target = await bootCore();

    expect(liveSinks()).toEqual(['iframe https://www.youtube.com/embed/ABC123']);
    peerEdit(target, (data) => {
      data.set('service', '');
      data.set('source', ATTACKER);
      data.set('embed', ATTACKER);
    });
    await settleMany(10);

    expect(liveSinks()).toEqual([]);
  });

  it('a peer swapping only the stored embed field cannot move the frame off the provider', async () => {
    const target = await bootCore({ allowGenericEmbed: true, genericEmbedClickToLoad: false });

    peerEdit(target, (data) => {
      data.set('embed', ATTACKER);
      data.set('kind', 'script');
    });
    await settleMany(10);

    expect(liveSinks()).toEqual(['iframe https://www.youtube.com/embed/ABC123']);
  });

  it('a peer\'s generic embed on an opted-in reader respects blockedEmbedOrigins', async () => {
    const target = await bootCore({ allowGenericEmbed: true, genericEmbedClickToLoad: false, blockedEmbedOrigins: ['*.attacker.test', 'attacker.test'] });

    peerEdit(target, (data) => {
      data.set('service', '');
      data.set('source', ATTACKER);
    });
    await settleMany(10);

    expect(liveSinks()).toEqual([]);
  });
});

/**
 * Host data passed to blocks.insert / insertAt / insertMany / update reaches
 * the tool the way `render()` data does: through the tool's sanitize config
 * and the URL-scheme pass. Segments look like inert data, so hosts pass
 * untrusted ones straight in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Callout, Code, Header, List, Paragraph } from '../../../../../src/tools';
import type { BlockToolConstructable } from '../../../../../types/tools';
import type { BlokConfig, OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  blocks: {
    insert: (type?: string, data?: Record<string, unknown>) => { id: string };
    insertAt: (type?: string, data?: Record<string, unknown>, options?: { parentId?: string }) => { id: string };
    insertMany: (blocks: OutputBlockData[]) => Array<{ id: string }>;
    update: (id: string, data?: Record<string, unknown>) => Promise<{ id: string }>;
  };
  module: { yjsManager: { toJSON: () => Array<{ id: string; data: Record<string, unknown> }> } };
}

const HTML_XSS = 'a<img src=x onerror="alert(1)"><a href="javascript:alert(2)">c</a>';
const SEGMENT_XSS = [
  { text: 'a', marks: { 'tag:img': { src: 'x', onerror: 'alert(1)' } } },
  { embed: { html: '<img src=x onerror="alert(2)">' } },
  { text: 'c', marks: { link: { href: 'javascript:alert(3)' } } },
];

let holder: HTMLDivElement | undefined;
let editor: TestEditor | undefined;

const requireHolder = (): HTMLDivElement => {
  if (holder === undefined) {
    throw new Error('no holder');
  }

  return holder;
};

const boot = async (data: OutputData, config: Partial<BlokConfig> = {}): Promise<TestEditor> => {
  const instance = new Blok({
    ...config,
    holder,
    tools: {
      paragraph: Paragraph,
      header: Header as unknown as BlockToolConstructable,
      list: List as unknown as BlockToolConstructable,
      callout: Callout as unknown as BlockToolConstructable,
      code: Code as unknown as BlockToolConstructable,
    },
    data,
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const one = (): OutputData => ({ blocks: [{ id: 'p', type: 'paragraph', data: { text: 'x' } }] });

/** Nothing that runs script: no handler attribute, no javascript: href. */
const expectInert = async (instance: TestEditor): Promise<void> => {
  const root = requireHolder();

  expect(root.querySelectorAll('[onerror], [onload], [onmouseover]')).toHaveLength(0);
  expect(Array.from(root.querySelectorAll('a')).filter(a => /javascript:/i.test(a.getAttribute('href') ?? ''))).toHaveLength(0);

  const saved = JSON.stringify(await instance.save());

  expect(saved).not.toMatch(/onerror|javascript:/i);
};

describe('blocks API host input is sanitized like render()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  describe.each([['html', HTML_XSS], ['segments', SEGMENT_XSS]] as const)('%s input', (_label, text) => {
    it('blocks.insert', async () => {
      const instance = await boot(one());

      instance.blocks.insert('paragraph', { text });

      await expectInert(instance);
    });

    it('blocks.insert with the default tool', async () => {
      const instance = await boot(one());

      instance.blocks.insert(undefined, { text });

      await expectInert(instance);
    });

    it('blocks.insertAt at the root', async () => {
      const instance = await boot(one());

      instance.blocks.insertAt('paragraph', { text });

      await expectInert(instance);
    });

    it('blocks.insertAt inside a parent', async () => {
      const instance = await boot(one());

      instance.blocks.insertAt('paragraph', { text }, { parentId: 'p' });

      await expectInert(instance);
    });

    it('blocks.insertMany', async () => {
      const instance = await boot(one());

      instance.blocks.insertMany([{ id: 'n', type: 'paragraph', data: { text } }]);

      await expectInert(instance);
    });

    it('blocks.update', async () => {
      const instance = await boot(one());

      await instance.blocks.update('p', { text });

      await expectInert(instance);
    });
  });

  describe('legacy shapes', () => {
    const ITEM_HTML = '<strong>one</strong><img src=x onerror="alert(1)">';

    it.each(['insert', 'update'] as const)('a legacy list item keeps its marks and loses its handler (%s)', async (via) => {
      const instance = await boot(one());
      const legacy = { style: 'unordered', items: [{ content: ITEM_HTML, items: [{ content: ITEM_HTML }] }] };
      const id = via === 'insert'
        ? instance.blocks.insert('list', legacy).id
        : (await instance.blocks.update(instance.blocks.insert('list', { text: 'old', style: 'unordered' }).id, legacy)).id;

      const yjs = JSON.stringify(instance.module.yjsManager.toJSON().find(block => block.id === id)?.data);

      expect(yjs).not.toMatch(/onerror/);
      expect(yjs).toContain('<strong>one</strong>');
      await expectInert(instance);
    });

    it('a legacy callout body block is sanitized like a block of its own', async () => {
      const instance = await boot(one());
      const { id } = instance.blocks.insert('callout', {
        title: 't',
        body: { blocks: [{ id: 'b', type: 'paragraph', data: { text: ITEM_HTML } }] },
      });

      const yjs = JSON.stringify(instance.module.yjsManager.toJSON().find(block => block.id === id)?.data);

      expect(yjs).not.toMatch(/onerror/);
      await expectInert(instance);
    });
  });

  describe('parity with render() for data render() transforms first', () => {
    it('a host migration runs before the sanitizer, as on render()', async () => {
      // Moves an old field into `text`; the paragraph's rule has no entry for the old one.
      const migrations = { paragraph: (data: Record<string, unknown>) => ('content' in data ? { text: data.content } : data) };
      const old = { content: 'a <b>bold</b>' };
      const rendered = await boot({ blocks: [{ id: 'p', type: 'paragraph', data: old }] }, { migrations });
      const expected = (await rendered.save()).blocks[0].data.text;

      rendered.destroy();

      const instance = await boot(one(), { migrations });
      const inserted = instance.blocks.insert('paragraph', old);
      const many = instance.blocks.insertMany([{ id: 'm', type: 'paragraph', data: old }]);
      const saved = (await instance.save()).blocks;

      expect(expected).toEqual([{ text: 'a ' }, { text: 'bold', marks: { bold: true } }]);
      expect(saved.find(block => block.id === inserted.id)?.data.text).toEqual(expected);
      expect(saved.find(block => block.id === many[0].id)?.data.text).toEqual(expected);
    });

    it('a plain-text field keeps markup characters as render() does', async () => {
      const code = 'a < b && "c" <b>x</b>';
      const rendered = await boot({ blocks: [{ id: 'c', type: 'code', data: { code } }] });
      const expected = (await rendered.save()).blocks[0].data.code;

      rendered.destroy();

      const instance = await boot({ blocks: [{ id: 'c', type: 'code', data: { code: 'x' } }] });
      const inserted = instance.blocks.insert('code', { code });

      await instance.blocks.update('c', { code });

      const saved = (await instance.save()).blocks;

      expect(saved.find(block => block.id === inserted.id)?.data.code).toBe(expected);
      expect(saved.find(block => block.id === 'c')?.data.code).toBe(expected);
    });
  });

  it('keeps the marks render() keeps', async () => {
    const text = 'a <b>bold</b> <i>it</i> <a href="https://x.dev">link</a> <mark style="color: var(--blok-color-red-text);">red</mark>';
    const rendered = await boot({ blocks: [{ id: 'p', type: 'paragraph', data: { text } }] });
    const expected = (await rendered.save()).blocks[0].data.text;

    rendered.destroy();

    const instance = await boot(one());
    const inserted = instance.blocks.insert('paragraph', { text });

    await instance.blocks.update('p', { text });

    const saved = (await instance.save()).blocks;

    expect(saved.find(block => block.id === inserted.id)?.data.text).toEqual(expected);
    expect(saved.find(block => block.id === 'p')?.data.text).toEqual(expected);
  });

  it.each([
    ['segments', [{ text: 'a < b && "c"' }]],
    ['html', 'a &lt; b &amp;&amp; "c"'],
  ])('typed markup characters stay text (%s)', async (_label, text) => {
    const instance = await boot(one());
    const inserted = instance.blocks.insert('paragraph', { text });

    await instance.blocks.update('p', { text });

    const root = requireHolder();

    expect(root.querySelector(`[data-blok-id="${inserted.id}"]`)?.textContent).toBe('a < b && "c"');
    expect(root.querySelector('[data-blok-id="p"]')?.textContent).toBe('a < b && "c"');

    const saved = (await instance.save()).blocks;

    expect(saved.find(block => block.id === inserted.id)?.data.text).toEqual([{ text: 'a < b && "c"' }]);
    expect(saved.find(block => block.id === 'p')?.data.text).toEqual([{ text: 'a < b && "c"' }]);
  });
});

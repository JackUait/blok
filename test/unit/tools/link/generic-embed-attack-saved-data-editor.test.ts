/**
 * Hostile saved embed blocks reaching a FULL editor (initial data, blocks.insert,
 * blocks.render, blocks.update). Safe outcome: the editor stays usable, other
 * blocks render and save, and a generic block never frames without the opt-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import * as Tools from '../../../../src/tools';
import type { OutputData } from '../../../../types';
import type { BlokConfig } from '../../../../types/configs/blok-config';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: {
    insert: (type: string, data: unknown) => unknown;
    render: (data: OutputData) => Promise<void>;
    update: (id: string, data: unknown) => Promise<unknown>;
  };
}

const EVIL = 'https://evil.attacker.test/phish';

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputData['blocks'], linkPaste?: BlokConfig['linkPaste']): Promise<TestEditor> => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
  editor = new Blok({
    holder,
    tools: { paragraph: Tools.Paragraph as never, embed: Tools.Embed as never },
    ...(linkPaste === undefined ? {} : { linkPaste }),
    data: { blocks },
  }) as unknown as TestEditor;
  await editor.isReady;

  return editor;
};

const para = (id: string, text: string): OutputData['blocks'][number] => ({ id, type: 'paragraph', data: { text } });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  holder?.remove();
  vi.restoreAllMocks();
});

describe('non-string embed fields in a full editor', () => {
  const HOSTILE: Array<[string, Record<string, unknown>]> = [
    ['source number', { service: '', source: 123, embed: EVIL }],
    ['source object', { service: '', source: { a: 1 }, embed: EVIL }],
    ['source null', { service: '', source: null, embed: EVIL }],
    ['service {toString}', { service: { toString: 'youtube' }, source: EVIL, embed: EVIL }],
  ];

  it.each(HOSTILE)('initial data with %s: other blocks still render and save', async (_label, data) => {
    const e = await make([para('p1', 'before'), { id: 'x', type: 'embed', data }, para('p2', 'after')]);

    expect(holder?.textContent).toContain('before');
    expect(holder?.textContent).toContain('after');

    const saved = await e.save();
    const texts = saved.blocks.filter((b) => b.type === 'paragraph').map((b) => JSON.stringify(b.data.text));

    expect(texts.join()).toContain('before');
    expect(texts.join()).toContain('after');
  });

  it.each(HOSTILE)('blocks.insert with %s does not break a later save', async (_label, data) => {
    const e = await make([para('p1', 'keep me')]);

    try {
      e.blocks.insert('embed', data);
    } catch {
      // an insert refusal is fine; a broken save is not
    }

    const saved = await e.save();

    expect(saved.blocks.some((b) => b.type === 'paragraph' && JSON.stringify(b.data.text).includes('keep me'))).toBe(true);
  });
});

describe('generic block through every insert path, host without opt-in', () => {
  const generic = { service: '', source: EVIL, embed: EVIL, kind: 'iframe' };

  it('initial data → link card, no frame', async () => {
    await make([{ id: 'g', type: 'embed', data: generic }]);

    expect(holder?.querySelector('iframe')).toBeNull();
    expect(holder?.querySelector('[data-blok-testid="embed-link-card"] a')?.getAttribute('href')).toBe(EVIL);
  });

  it('blocks.insert → link card, no frame', async () => {
    const e = await make([para('p', 'x')]);

    e.blocks.insert('embed', generic);
    await new Promise((r) => setTimeout(r, 0));

    expect(holder?.querySelector('iframe')).toBeNull();
    expect(holder?.querySelector('[data-blok-testid="embed-link-card"]')).not.toBeNull();
  });

  it('blocks.render → link card, no frame', async () => {
    const e = await make([para('p', 'x')]);

    await e.blocks.render({ blocks: [{ id: 'g', type: 'embed', data: generic }] });

    expect(holder?.querySelector('iframe')).toBeNull();
    expect(holder?.querySelector('[data-blok-testid="embed-link-card"]')).not.toBeNull();
  });

  it('blocks.update turning a youtube block generic → link card, no frame', async () => {
    const e = await make([{
      id: 'y',
      type: 'embed',
      data: { service: 'youtube', source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
    }]);

    expect(holder?.querySelector('iframe')).not.toBeNull();

    await e.blocks.update('y', generic);

    expect(holder?.querySelector('iframe')).toBeNull();
    expect(holder?.querySelector('[data-blok-testid="embed-link-card"]')).not.toBeNull();
  });

  it('blocks.update keeping service youtube but pointing source at attacker → no attacker frame', async () => {
    const e = await make([{
      id: 'y',
      type: 'embed',
      data: { service: 'youtube', source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
    }], { allowGenericEmbed: true });

    await e.blocks.update('y', { service: 'youtube', source: EVIL, embed: EVIL });

    const srcs = Array.from(holder?.querySelectorAll('iframe') ?? []).map((f) => f.getAttribute('src') ?? '');

    expect(srcs.some((s) => s.includes('evil.attacker.test'))).toBe(false);
  });

  it('a peer swapping the source after the reader clicked load does not skip the click gate', async () => {
    const e = await make([{
      id: 'g',
      type: 'embed',
      data: { service: '', source: 'https://benign.example.test/', embed: 'https://benign.example.test/' },
    }], { allowGenericEmbed: true });

    holder?.querySelector<HTMLButtonElement>('button[data-role="embed-load"]')?.click();
    expect(holder?.querySelector('iframe')?.getAttribute('src')).toBe('https://benign.example.test/');

    await e.blocks.update('g', { service: '', source: EVIL, embed: EVIL });

    expect(holder?.querySelector('iframe')).toBeNull();
    expect(holder?.querySelector('button[data-role="embed-load"]')).not.toBeNull();
  });
});

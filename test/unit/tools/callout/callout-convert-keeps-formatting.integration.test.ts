import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { CalloutTool } from '../../../../src/tools/callout';
import type { API, OutputBlockData, OutputData } from '../../../../types';

/**
 * "Turn into callout" moves the source text into the callout's first child
 * paragraph. Line breaks and inline marks must survive the trip.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  blocks: API['blocks'];
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const createEditor = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      header: Header,
      callout: CalloutTool,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const calloutBodyText = async (instance: TestEditor, calloutId: string): Promise<unknown> => {
  const saved = await instance.save();
  const child = saved.blocks.find((block) => block.parent === calloutId);

  return child?.data.text;
};

describe('callout: turn into keeps line breaks and inline marks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('keeps <br> and bold when a paragraph turns into a callout', async () => {
    const instance = await createEditor([
      { id: 'p', type: 'paragraph', data: { text: 'Line one<br>Line <b>bold</b> <i>and</i> <a href="https://example.com">link</a>' } },
    ]);

    const callout = await instance.blocks.convert('p', 'callout');

    expect(await calloutBodyText(instance, callout.id))
      .toBe('Line one<br>Line <b>bold</b> <i>and</i> <a href="https://example.com">link</a>');
  }, 30_000);

  it('keeps <br> and bold when a heading turns into a callout', async () => {
    const instance = await createEditor([
      { id: 'h', type: 'header', data: { text: 'H <b>bold</b><br>two', level: 2 } },
    ]);

    const callout = await instance.blocks.convert('h', 'callout');

    expect(await calloutBodyText(instance, callout.id)).toBe('H <b>bold</b><br>two');
  }, 30_000);
  it('drops a javascript: link and a script while keeping the marks', async () => {
    const instance = await createEditor([
      { id: 'p', type: 'paragraph', data: { text: '<b>bold</b><br><a href="https://example.com">ok</a>' } },
    ]);

    // Written into the DOM after load so the paragraph's own load-time cleaning never sees it.
    // jsdom does not reflect the contentEditable property to the attribute.
    const source = Array.from(holder?.querySelectorAll<HTMLElement>('[data-blok-id="p"] *') ?? [])
      .find((element) => element.contentEditable === 'true');

    if (source === undefined) {
      throw new Error('no editable for p');
    }

    source.innerHTML = '<b>bold</b><br><a href="javascript:alert(1)">bad</a><img src="x" onerror="alert(1)">';

    const callout = await instance.blocks.convert('p', 'callout');
    const text = String(await calloutBodyText(instance, callout.id));

    expect(text).not.toContain('javascript:');
    expect(text).not.toContain('onerror');
    expect(text).toContain('<b>bold</b><br>');
  }, 30_000);
});

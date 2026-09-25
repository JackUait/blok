/**
 * Toggle text must keep the same inline marks as every other text tool, even
 * when no inline tools are enabled for it (their sanitize rules are what
 * normally widen a tool's allowlist).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { BoldInlineTool } from '../../../../src/components/inline-tools/inline-tool-bold';
import { StrikethroughInlineTool } from '../../../../src/components/inline-tools/inline-tool-strikethrough';
import { UnderlineInlineTool } from '../../../../src/components/inline-tools/inline-tool-underline';
import { Paragraph } from '../../../../src/tools/paragraph';
import { ToggleItem } from '../../../../src/tools/toggle';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  caret: API['caret'];
  module: { paste: { processText: (data: string, isHTML?: boolean) => Promise<void> } };
}

const RICH = 'a<br><strong>B</strong> <em>I</em> <u>U</u> <s>S</s> <a href="https://ex.com">L</a> <code>C</code> <mark style="color: red;">M</mark>';

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (blocks: OutputBlockData[], inlineToolbar: boolean): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      bold: BoldInlineTool,
      underline: UnderlineInlineTool,
      strikethrough: StrikethroughInlineTool,
      paragraph: { class: Paragraph, inlineToolbar },
      toggle: { class: ToggleItem, inlineToolbar },
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const textOf = async (instance: TestEditor, type: string): Promise<string | undefined> => {
  const saved = await instance.save();
  const block = saved.blocks.find(candidate => candidate.type === type);

  return block?.data.text as string | undefined;
};

describe('toggle text keeps inline marks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('survives load and save with the inline toolbar off', async () => {
    const instance = await boot([{ id: 't', type: 'toggle', data: { text: RICH } }], false);

    expect(await textOf(instance, 'toggle')).toBe(RICH);
  });

  it('survives converting a paragraph into a toggle with the inline toolbar off', async () => {
    const instance = await boot([{ id: 'p', type: 'paragraph', data: { text: RICH } }], false);

    await instance.blocks.convert('p', 'toggle');
    await settle();

    expect(await textOf(instance, 'toggle')).toBe(RICH);
  });

  // Paste keeps only the inline tools' tags, so they must be registered here.
  it('survives pasting a <details> element', async () => {
    const instance = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }], true);

    instance.caret.setToBlock('p', 'start');
    await instance.module.paste.processText(
      '<details><summary>Sum <strong>B</strong> <u>U</u> <s>S</s></summary>body</details>',
      true
    );
    await settle();

    expect(await textOf(instance, 'toggle')).toBe('Sum <strong>B</strong> <u>U</u> <s>S</s>');
  });
});

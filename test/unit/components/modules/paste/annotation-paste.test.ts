import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { EquationInlineTool } from '../../../../../src/components/inline-tools/inline-tool-equation';
import type { API, OutputData, ToolConstructable, ToolSettings } from '../../../../../types';
import { htmlOf } from '../../../helpers/saved-as-html';
import { loadPasteEngine } from '../../../helpers/paste-engine';

vi.mock('../../../../../src/shared/katex', () => ({
  renderLatex: vi.fn(async (latex: string) => `<span class="katex">rendered:${latex}</span>`),
}));

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  caret: API['caret'];
}

const HINT = '<span data-blok-annotation="A &quot;quote&quot;" data-blok-annotation-subtitle="Anna">the phrase</span>';

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  holder = document.createElement('div');
  document.body.append(holder);
});

afterEach(() => {
  vi.restoreAllMocks();
  editor?.destroy();
  editor = undefined;
  holder?.remove();
});

/**
 * Paste HTML at the end of a paragraph that holds "Before " and return what is saved.
 */
const pasteIntoParagraph = async (
  html: string,
  plain: string,
  tools: Record<string, ToolConstructable | ToolSettings>
): Promise<string> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, ...tools },
    data: { blocks: [ { id: 'before', type: 'paragraph', data: { text: 'Before ' } } ] },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  const target = Array.from(holder?.querySelectorAll<HTMLElement>('[data-blok-id="before"] *') ?? [])
    .find((element) => element.contentEditable === 'true');

  if (target === undefined) {
    throw new Error('no paragraph input');
  }

  target.setAttribute('contenteditable', 'true');
  target.focus();
  instance.caret.setToBlock('before', 'end');

  const data: Record<string, string> = { 'text/html': html, 'text/plain': plain };

  await loadPasteEngine();
  target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
    clipboardData: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
  }));
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });

  const output = await instance.save();

  return htmlOf(output.blocks.find((block) => block.id === 'before')?.data.text);
};

describe('annotation paste', () => {
  it('keeps a pasted hint with its text and subtitle', async () => {
    const saved = await pasteIntoParagraph(`found ${HINT} near`, 'found the phrase near', {});

    expect(saved).toBe(`Before found ${HINT} near`);
  });

  it('keeps a pasted hint when the equation tool also rules on span', async () => {
    const saved = await pasteIntoParagraph(`found ${HINT} near`, 'found the phrase near', { equation: EquationInlineTool });

    expect(saved).toBe(`Before found ${HINT} near`);
  });

  it('still keeps a pasted equation next to a hint', async () => {
    const saved = await pasteIntoParagraph(
      `${HINT} and <span data-latex="a^2">a^2</span>`,
      'the phrase and a^2',
      { equation: EquationInlineTool }
    );

    expect(saved).toBe(`Before ${HINT} and <span data-latex="a^2">a^2</span>`);
  });

  it('still unwraps a pasted span that is neither a hint nor an equation', async () => {
    const saved = await pasteIntoParagraph('a <span class="x" style="color: red">plain</span> b', 'a plain b', {});

    expect(saved).toBe('Before a plain b');
  });
});

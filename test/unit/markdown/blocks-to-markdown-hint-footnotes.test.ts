import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blocksToMarkdown as domBlocksToMarkdown, blocksToMarkdownWithReport } from '../../../src/markdown/blocks-to-markdown';
import { blocksToMarkdown as viewBlocksToMarkdown } from '../../../src/view/blocks-to-markdown';

const paragraph = (id: string, text: string): { id: string; type: string; data: { text: string } } =>
  ({ id, type: 'paragraph', data: { text } });

const hint = (phrase: string, text: string, subtitle?: string): string => {
  const quote = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const extra = subtitle === undefined ? '' : ` data-blok-annotation-subtitle="${quote(subtitle)}"`;

  return `<span data-blok-annotation="${quote(text)}"${extra}>${phrase}</span>`;
};

const BACKENDS: Array<[string, (blocks: ReturnType<typeof paragraph>[]) => string]> = [
  ['dom', blocks => domBlocksToMarkdown(blocks)],
  ['view', blocks => viewBlocksToMarkdown({ blocks })],
];

describe.each(BACKENDS)('hint footnotes in Markdown (%s)', (_name, toMarkdown) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a hint as a footnote at the end of the output', () => {
    const markdown = toMarkdown([
      paragraph('a', `We found ${hint('the bottleneck', 'The step that limits the chain.')} near the oven.`),
      paragraph('b', 'A second paragraph.'),
    ]);

    expect(markdown).toBe([
      'We found the bottleneck[^1] near the oven.',
      '',
      'A second paragraph.',
      '',
      '[^1]: The step that limits the chain.',
    ].join('\n'));
  });

  it('adds the subtitle after a dash', () => {
    const markdown = toMarkdown([ paragraph('a', hint('phrase', 'A quote', 'Anna, manager')) ]);

    expect(markdown).toBe('phrase[^1]\n\n[^1]: A quote — Anna, manager');
  });

  it('numbers hints from 1 in the order they appear', () => {
    const markdown = toMarkdown([
      paragraph('a', `${hint('one', 'First')} and ${hint('two', 'Second')}`),
      paragraph('b', hint('three', 'Third')),
    ]);

    expect(markdown).toBe([
      'one[^1] and two[^2]',
      '',
      'three[^3]',
      '',
      '[^1]: First',
      '[^2]: Second',
      '[^3]: Third',
    ].join('\n'));
  });

  it('keeps formatting inside the phrase and puts the marker after it', () => {
    const markdown = toMarkdown([ paragraph('a', hint('see <b>the report</b>', 'A quote')) ]);

    expect(markdown).toBe('see **the report**[^1]\n\n[^1]: A quote');
  });

  it('indents the later lines of a multi-line hint so they stay in the footnote', () => {
    const markdown = toMarkdown([ paragraph('a', hint('phrase', 'Line one\nLine two')) ]);

    expect(markdown).toBe('phrase[^1]\n\n[^1]: Line one\n    Line two');
  });

  it('escapes Markdown characters in the hint text', () => {
    const markdown = toMarkdown([ paragraph('a', hint('phrase', 'a *star* and [a bracket]')) ]);

    expect(markdown).toBe('phrase[^1]\n\n[^1]: a \\*star\\* and \\[a bracket\\]');
  });

  it('adds nothing to a document without hints', () => {
    expect(toMarkdown([ paragraph('a', 'Plain <b>text</b>.') ])).toBe('Plain **text**.');
  });

  it('treats a span with an empty annotation as plain text', () => {
    expect(toMarkdown([ paragraph('a', 'a <span data-blok-annotation="">b</span> c') ])).toBe('a b c');
  });
});

describe('hint footnotes report', () => {
  it('reports no loss for a hint', () => {
    const { warnings } = blocksToMarkdownWithReport([ paragraph('a', hint('phrase', 'A quote')) ]);

    expect(warnings).toEqual([]);
  });
});

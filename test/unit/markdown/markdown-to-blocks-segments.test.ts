// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markdownToBlocks } from '../../../src/markdown/index';
import type { InternalMarkdownImportConfig } from '../../../src/markdown/types';
import { outputBlocksToSegments } from '../../../src/shared/rich-text/block-data';
import { CURRENT_RICH_TEXT_FIELDS } from '../../../src/shared/rich-text/fields';
import { htmlToSegmentsNode } from '../../../src/view/rich-text-parse5';
import type { OutputBlockData } from '../../../types';

const fieldsOf = (type: string): string[] =>
  Object.prototype.hasOwnProperty.call(CURRENT_RICH_TEXT_FIELDS, type) ? CURRENT_RICH_TEXT_FIELDS[type] : [];

/** Ids carry a clock prefix; two imports a millisecond apart must still compare equal. */
const withoutClock = (blocks: OutputBlockData[]): unknown => JSON.parse(JSON.stringify(blocks).replace(/md-[a-z0-9]+-/g, 'md-'));

const CORPUS: string[] = [
  'a **b** *c* ~~d~~ `e < & >` f',
  '***both*** and **bold *nested* bold**',
  '[safe](https://x.dev/?a=1&b="2") [unsafe](javascript:alert(1)) [same](#top)',
  '[ref][r] and [missing][nope] and ![img ref][i] and ![gone][nope]\n\n[r]: https://r.dev\n[i]: https://i.dev/a.png',
  'text ![inline](https://x.dev/a.png "t") more',
  '![alt with "quotes" & amp](https://x.dev/a&b.png)',
  '![evil](javascript:alert(1)) after',
  'hard  \nbreak and back\\\nslash',
  'soft\nbreak',
  'raw <br> break, <br/> and <span class="x">span</span> &amp; &copy; &nbsp;',
  '<div class="note">block html</div>',
  '<br>',
  'before $x^2$ after',
  '$a$',
  '# heading with $E=mc^2$ math',
  '| a $b$ | **c** |\n| :-: | --: |\n| <br> | x |',
  '|  |  |\n| - | - |\n| a | b |',
  '- one\n- **two**\n  - nested\n\n1. first\n2. second',
  '3. three\n4. four',
  '- [ ] todo\n- [x] done *it*',
  '- item\n\n  second paragraph\n\n  ```js\n  code\n  ```',
  '> quote **one**\n>\n> quote two',
  '> quote\n> - list in quote\n> more',
  '>',
  '> [!NOTE]\n> a **b**\n> c',
  'footnote[^1]\n\n[^1]: the note',
  'line one\r\nline two\rline three',
  'tab\tand   spaces  ',
  '`code with  spaces`',
  'autolink https://example.com and <https://angle.dev>',
  '\\*escaped\\* \\<tag\\>',
  '$$\nE = mc^2\n$$',
  '---',
  '```\nplain\n```',
  'x <kbd>K</kbd> y',
  'a\u00a0b',
  'see ![no\u00a0break](https://x.dev/a.png) inline',
  '$x$ ![a](javascript:alert(1)) b',
  'a ![a](javascript:alert(1)) $y$',
  '$x$ [^1] b\n\n[^1]: n',
  'a [^1] $x$\n\n[^1]: n',
];

describe('markdownToBlocks rich text segments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns paragraph text as segments, markup characters kept as text', async () => {
    const blocks = await markdownToBlocks('a **b** & `<c>`');

    expect(blocks).toMatchObject([{
      type: 'paragraph',
      data: { text: [{ text: 'a ' }, { text: 'b', marks: { bold: true } }, { text: ' & ' }, { text: '<c>', marks: { code: true } }] },
    }]);
  });

  it('keeps HTML strings for the editor when asked', async () => {
    const config: InternalMarkdownImportConfig = { htmlText: true };

    expect(await markdownToBlocks('a **b**', config)).toMatchObject([{ type: 'paragraph', data: { text: 'a <strong>b</strong>' } }]);
  });

  it.each(CORPUS.flatMap(md => [[md, false], [md, true]] as const))('equals the HTML output read with parse5: %j (soft breaks %s)', async (md, softBreaks) => {
    const segments = await markdownToBlocks(md, { softBreaks } as InternalMarkdownImportConfig);
    const html = await markdownToBlocks(md, { softBreaks, htmlText: true } as InternalMarkdownImportConfig);

    expect(withoutClock(segments)).toEqual(withoutClock(outputBlocksToSegments(html, fieldsOf, htmlToSegmentsNode)));
  });
});

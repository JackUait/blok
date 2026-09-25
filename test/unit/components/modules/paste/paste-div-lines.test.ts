/**
 * Pasted HTML whose lines are <div>s (Notion, Word, Gmail, Slack) and
 * pasted <aside> callouts must keep each line separate. These drive the
 * real Paste module with the real tool pasteConfigs and check what each
 * tool's onPaste receives.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { Paste } from '../../../../../src/components/modules/paste';
import type { BlockToolAdapter } from '../../../../../src/components/tools/block';
import { CalloutTool } from '../../../../../src/tools/callout';
import { CodeTool } from '../../../../../src/tools/code';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Quote } from '../../../../../src/tools/quote';

interface ToolCall {
  tool: string;
  html: string;
}

interface PasteResult {
  calls: ToolCall[];
  inline: string[];
  parents: Array<[string, string]>;
}

const INLINE_RULES = { b: {}, strong: {}, i: {}, em: {} };

const toolStub = (name: string, pasteConfig: unknown): BlockToolAdapter => ({
  name,
  pasteConfig,
  baseSanitizeConfig: INLINE_RULES,
  hasOnPasteHandler: true,
  isDefault: name === 'paragraph',
} as unknown as BlockToolAdapter);

const pasteClipboard = async (html: string, plain: string): Promise<PasteResult> => {
  const created: Array<{ id: string }> = [];
  const paragraph = toolStub('paragraph', Paragraph.pasteConfig);
  const currentBlock = { name: 'paragraph', tool: paragraph, isEmpty: true, currentInput: document.createElement('div'), holder: document.createElement('div') };
  const mocks = {
    BlockManager: {
      currentBlock,
      paste: vi.fn((_tool: string, _event: CustomEvent) => {
        const block = { id: `b${created.length}` };

        created.push(block);

        return block;
      }),
      insert: vi.fn(),
      setCurrentBlockByChildNode: vi.fn(),
      setBlockParent: vi.fn(),
    },
    Caret: { positions: { END: 'end' }, setToBlock: vi.fn(), insertContentAtCaretPosition: vi.fn() },
    Tools: {
      blockTools: new Map<string, BlockToolAdapter>([
        ['paragraph', paragraph],
        ['quote', toolStub('quote', Quote.pasteConfig)],
        ['code', toolStub('code', CodeTool.pasteConfig)],
        ['callout', toolStub('callout', CalloutTool.pasteConfig)],
      ]),
      defaultTool: paragraph,
      getAllInlineToolsSanitizeConfig: vi.fn(() => INLINE_RULES),
    },
    Toolbar: { close: vi.fn(), moveAndOpen: vi.fn() },
    UI: { nodes: { holder: document.createElement('div'), redactor: document.createElement('div') }, isMobile: false },
    ReadOnly: { isEnabled: false },
  };

  const paste = new Paste({
    config: { defaultBlock: 'paragraph' },
    eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  } as unknown as ConstructorParameters<typeof Paste>[0]);

  (paste as unknown as { Blok: typeof mocks }).Blok = mocks;
  (paste as unknown as { listeners: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> } }).listeners = { on: vi.fn(), off: vi.fn() };

  await paste.prepare();

  const data: Record<string, string> = { 'text/html': html, 'text/plain': plain };

  await paste.processDataTransfer({
    getData: (type: string): string => data[type] ?? '',
    types: Object.keys(data),
    files: [],
  } as unknown as DataTransfer);

  return {
    calls: mocks.BlockManager.paste.mock.calls.map(([tool, event]) => ({
      tool: String(tool),
      html: (event.detail as { data: HTMLElement }).data.innerHTML,
    })),
    inline: mocks.Caret.insertContentAtCaretPosition.mock.calls.map(([value]) => String(value)),
    parents: mocks.BlockManager.setBlockParent.mock.calls.map(([block, parentId]) => [(block as { id: string }).id, String(parentId)]),
  };
};

describe('paste: <div> lines stay separate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('makes one paragraph per top-level <div> line', async () => {
    const { calls } = await pasteClipboard('<div>a <b>x</b></div><div>b</div>', 'a x\nb');

    expect(calls).toEqual([
      { tool: 'paragraph', html: 'a <strong>x</strong>' },
      { tool: 'paragraph', html: 'b' },
    ]);
  });

  it('makes one paragraph per nested <div> line', async () => {
    const { calls } = await pasteClipboard('<div><div>a <b>x</b></div><div><div>b</div></div></div>', 'a x\nb');

    expect(calls).toEqual([
      { tool: 'paragraph', html: 'a <strong>x</strong>' },
      { tool: 'paragraph', html: 'b' },
    ]);
  });

  it('still splits <p>s wrapped in one <div>', async () => {
    const { calls } = await pasteClipboard('<div><p>a <b>x</b></p><p>b</p></div>', 'a x\nb');

    expect(calls).toEqual([
      { tool: 'paragraph', html: 'a <strong>x</strong>' },
      { tool: 'paragraph', html: 'b' },
    ]);
  });

  it('keeps a single inline <div> as an inline paste', async () => {
    const { calls, inline } = await pasteClipboard('<div>a <b>x</b></div>', 'a x');

    expect(calls).toEqual([]);
    expect(inline).toEqual(['a <strong>x</strong>']);
  });

  it('joins <div> lines inside a <blockquote> with <br>', async () => {
    const { calls } = await pasteClipboard('<blockquote><div>a <b>x</b></div><div><br></div><div>b</div></blockquote>', 'a x\n\nb');

    expect(calls).toEqual([{ tool: 'quote', html: 'a <strong>x</strong><br><br>b' }]);
  });

  it('joins plain <div> lines inside a <blockquote> with <br>', async () => {
    const { calls } = await pasteClipboard('<blockquote><div>a</div><div><div>b</div></div></blockquote>', 'a\nb');

    expect(calls).toEqual([{ tool: 'quote', html: 'a<br>b' }]);
  });

  it('joins <div> lines inside a <pre> with <br>', async () => {
    const { calls } = await pasteClipboard('<pre><div>line1</div><div>line2</div></pre>', 'line1\nline2');

    expect(calls).toEqual([{ tool: 'code', html: 'line1<br>line2' }]);
  });
});

describe('paste: <aside> keeps loose inline content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('turns loose inline runs into paragraphs split at <br>, keeping marks', async () => {
    const { calls, parents } = await pasteClipboard('<aside>loose <b>B</b><br>text <em>I</em></aside>', 'loose B\ntext I');

    expect(calls.map(call => call.tool)).toEqual(['callout', 'paragraph', 'paragraph']);
    expect(calls.slice(1).map(call => call.html)).toEqual(['loose <strong>B</strong>', 'text <em>I</em>']);
    expect(parents).toEqual([['b1', 'b0'], ['b2', 'b0']]);
  });

  it('keeps block children of an <aside> as their own blocks', async () => {
    const { calls } = await pasteClipboard('<aside><p>one</p>two</aside>', 'one\ntwo');

    expect(calls.map(call => [call.tool, call.html])).toEqual([
      ['callout', expect.any(String)],
      ['paragraph', 'one'],
      ['paragraph', 'two'],
    ]);
  });
});

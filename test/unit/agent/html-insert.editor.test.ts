// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Bold, Callout, Code, Header, Image, Italic, Link, List, Paragraph, Quote, Table, Toggle } from '../../../src/tools';
import type { Agent, API, BlokConfig, OutputBlockData, OutputData } from '../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  agent: Agent;
  caret: API['caret'];
  save: () => Promise<OutputData>;
}

/** A host block that claims <mark-box> by tag, as a custom tool's pasteConfig does. */
class MarkBox {
  public static get pasteConfig(): { tags: string[] } {
    return { tags: ['MARK-BOX'] };
  }

  private text = '';
  private readonly element = document.createElement('div');

  constructor({ data }: { data: { text?: string } }) {
    this.text = data.text ?? '';
  }

  public render(): HTMLElement {
    this.element.textContent = this.text;

    return this.element;
  }

  public onPaste(event: CustomEvent<{ data: HTMLElement }>): void {
    this.text = event.detail.data.textContent ?? '';
    this.element.textContent = this.text;
  }

  public save(): { text: string } {
    return { text: this.text };
  }
}

const config = (): BlokConfig => ({
  user: { id: 'human-1' },
  tools: {
    paragraph: Paragraph, header: Header, list: List, quote: Quote, table: Table, toggle: Toggle,
    callout: Callout, code: Code, image: Image, bold: Bold, italic: Italic, link: Link, markBox: MarkBox,
  },
} as BlokConfig);

const editors: TestEditor[] = [];

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const holders = new Map<TestEditor, HTMLElement>();

const boot = async (blocks: OutputBlockData[] = []): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({ ...config(), holder, data: { blocks } }) as unknown as TestEditor;

  editors.push(editor);
  holders.set(editor, holder);
  await editor.isReady;
  await settle();

  return editor;
};

// Who wrote a block and when (the agent co-authors its import), and the random ids each paste mints.
const NOT_CONTENT = new Set(['id', 'rowId', 'createdAt', 'createdBy', 'createdWith', 'lastEditedAt', 'lastEditedBy', 'lastEditedWith']);

/** Replaces ids with their place in save order, so two editors' saves compare. */
const withoutIds = (blocks: OutputBlockData[]): unknown => {
  const place = new Map(blocks.map((block, index) => [block.id, `#${index}`]));
  const swap = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return place.get(value) ?? value;
    }
    if (Array.isArray(value)) {
      return value.map(swap);
    }
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).filter(([key]) => !NOT_CONTENT.has(key)).map(([key, inner]) => [key, swap(inner)]));
    }

    return value;
  };

  return blocks.map(block => swap(block));
};

/** The paste inserts block by block across timers; read once the save stops changing. */
const stableSave = async (editor: TestEditor): Promise<OutputBlockData[]> => {
  const reads: string[] = [];

  while (reads.length < 5 || reads.at(-1) !== reads.at(-5)) {
    await settle();
    reads.push(JSON.stringify(withoutIds((await editor.save()).blocks)));
  }

  return (await editor.save()).blocks;
};

/** The reference: a person pastes `html` into the empty paragraph of a fresh editor. */
const personPastes = async (html: string): Promise<OutputBlockData[]> => {
  const editor = await boot();
  const block = holders.get(editor)?.querySelector<HTMLElement>('[data-blok-id]');
  const id = block?.getAttribute('data-blok-id');
  const target = Array.from(block?.querySelectorAll<HTMLElement>('*') ?? []).find(element => element.contentEditable === 'true');

  if (target === undefined || id === null || id === undefined) {
    throw new Error('no paste target');
  }
  target.focus();
  editor.caret.setToBlock(id, 'end');
  target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
    clipboardData: { getData: (type: string): string => (type === 'text/html' ? html : ''), types: ['text/html'] },
  }));
  return stableSave(editor);
};

const agentImports = async (html: string, editor?: TestEditor): Promise<{ ok: boolean; blocks: OutputBlockData[]; result: unknown }> => {
  const target = editor ?? await boot();
  const turn = target.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
  const result = await turn.execute({ commands: [{ name: 'html.insert', args: { html } }] });

  turn.end();
  await settle();

  return { ok: result.ok, blocks: (await target.save()).blocks, result };
};

// jsdom keeps contentEditable as a plain property; a browser reflects it to the attribute core queries.
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
  if (reflected === undefined) {
    Reflect.deleteProperty(HTMLElement.prototype, 'contentEditable');
  } else {
    Object.defineProperty(HTMLElement.prototype, 'contentEditable', reflected);
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const PASTE_CASES: Array<[string, string]> = [
  ['headings, paragraphs and marks', '<h2>Title</h2><p>One <b>bold</b> and <i>it</i> <a href="https://example.com">link</a></p><p>Two</p>'],
  ['a nested list', '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><ol><li>one</li></ol>'],
  ['a list inside a quote', '<blockquote><p>said</p><ul><li>x</li></ul></blockquote>'],
  ['a table with a list in a cell', '<table><tr><td>a</td><td><ul><li>x</li><li>y</li></ul></td></tr><tr><td>b</td><td>c</td></tr></table>'],
  ['a details toggle', '<details><summary>More</summary><p>inside</p></details>'],
  ['Google Docs markup', '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;">Bold</span><span> plain</span></p></b>'],
  ['code and an image', '<pre><code>const a = 1;</code></pre><img src="https://example.com/a.png" alt="a">'],
  ['a host tool claimed by tag', '<p>before</p><mark-box>boxed</mark-box>'],
];

describe('html.insert gives the blocks a person\'s paste gives', () => {
  it.each(PASTE_CASES)('%s', async (_name, html) => {
    const reference = await personPastes(html);
    const imported = await agentImports(html);

    expect(imported.ok).toBe(true);
    expect(withoutIds(imported.blocks)).toEqual(withoutIds(reference));
  });

  it('inserts after a block, and leaves the blocks before it alone', async () => {
    const editor = await boot([{ id: 'p1', type: 'paragraph', data: { text: 'keep' } }]);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.execute({ commands: [{ name: 'html.insert', args: { html: '<h2>New</h2><p>after</p>', position: { after: 'p1' } } }] });

    turn.end();
    expect(result.ok).toBe(true);
    const blocks = (await editor.save()).blocks;

    expect(blocks.map(block => [block.type, strings(block.data.text).join('')])).toEqual([['paragraph', 'keep'], ['header', 'New'], ['paragraph', 'after']]);
  });

  it('keeps the person\'s caret where it was', async () => {
    const editor = await boot([{ id: 'p1', type: 'paragraph', data: { text: 'keep' } }]);
    const input = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-id="p1"] *')).find(element => element.contentEditable === 'true');
    const text = input?.firstChild;

    if (text === null || text === undefined) {
      throw new Error('no text node');
    }
    const range = document.createRange();

    range.setStart(text, 2);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    await agentImports('<p>a</p><p>b</p>', editor);

    const after = window.getSelection()?.getRangeAt(0);

    expect(after?.startContainer).toBe(text);
    expect(after?.startOffset).toBe(2);
  });

  it('refuses text with no HTML in it, and writes nothing', async () => {
    const imported = await agentImports('just words');

    expect(imported.ok).toBe(false);
    expect(imported.result).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(imported.blocks.every(block => block.data.text === '' || block.data.text === undefined)).toBe(true);
  });
});

/** Every string anywhere in the saved tree. */
const strings = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(strings);
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(strings);
  }

  return [];
};

const UNSAFE = [/<script/i, /\son\w+\s*=/i, /javascript:/i, /vbscript:/i, /data:text\/html/i, /srcdoc/i, /<iframe/i, /<svg/i];

const XSS: Array<[string, string]> = [
  ['a script tag', '<p>hi</p><script>alert(1)</script>'],
  ['an event handler', '<p onclick="alert(1)" onmouseover="alert(2)">hi</p>'],
  ['an image onerror', '<img src="x" onerror="alert(1)"><p>t</p>'],
  ['a javascript: link', '<p><a href="javascript:alert(1)">x</a></p>'],
  ['a tab-split javascript: link', '<p><a href="java&#9;script:alert(1)">x</a></p>'],
  ['a spaced, mixed-case link', '<p><a href="  JaVaScRiPt:alert(1)">x</a></p>'],
  ['a vbscript: link', '<p><a href="vbscript:msgbox(1)">x</a></p>'],
  ['a data:text/html link', '<p><a href="data:text/html,<script>alert(1)</script>">x</a></p>'],
  ['a javascript: image', '<img src="javascript:alert(1)"><p>t</p>'],
  ['an svg onload', '<svg onload="alert(1)"><circle r="1"></circle></svg><p>t</p>'],
  ['an iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe><p>t</p>'],
  ['a link in a table cell', '<table><tr><td><a href="javascript:alert(1)">x</a></td><td onclick="alert(1)">y</td></tr></table>'],
  ['a script in a list item', '<ul><li>a<script>alert(1)</script><img src=x onerror=alert(1)></li></ul>'],
];

describe('html.insert is at least as safe as paste', () => {
  it.each(XSS)('%s leaves nothing executable in the saved document', async (_name, html) => {
    const imported = await agentImports(html);
    const found = strings(imported.blocks).filter(text => UNSAFE.some(pattern => pattern.test(text)));

    expect(found).toEqual([]);
    // The import ran: the harmless text arrived.
    expect(imported.ok).toBe(true);
    expect(strings(imported.blocks).some(text => /\b(hi|t|x|y|a)\b/.test(text))).toBe(true);
  });

  // Weak: jsdom loads no images, so this can only show no handler ran during the import.
  it('runs no handler while it imports', async () => {
    const fired = vi.fn();

    (window as unknown as Record<string, unknown>).__htmlInsertFired = fired;
    await agentImports('<img src="x" onerror="window.__htmlInsertFired()"><p onmouseover="window.__htmlInsertFired()">t</p>');
    delete (window as unknown as Record<string, unknown>).__htmlInsertFired;

    expect(fired).not.toHaveBeenCalled();
  });
});

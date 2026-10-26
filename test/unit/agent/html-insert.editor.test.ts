// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Bold, Callout, Code, Header, Image, Italic, Link, List, Marker, Paragraph, Quote, Table, Toggle, Video } from '../../../src/tools';
import type { Agent, API, BlokConfig, OutputBlockData, OutputData } from '../../../types';
import type { AgentResult } from '../../../types/agent';

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

/** A host block whose paste stores a reaction under the person named in the HTML. */
class ReactBox {
  public static get pasteConfig(): { tags: Array<Record<string, Record<string, boolean>>> } {
    return { tags: [{ 'react-box': { 'data-who': true } }] };
  }

  private who = '';

  public render(): HTMLElement {
    return document.createElement('div');
  }

  public onPaste(event: CustomEvent<{ data: HTMLElement }>): void {
    this.who = event.detail.data.getAttribute('data-who') ?? '';
  }

  public save(): Record<string, unknown> {
    return { [`reactions:${this.who}`]: ['+1'] };
  }
}

const config = (): BlokConfig => ({
  user: { id: 'human-1' },
  tools: {
    paragraph: Paragraph, header: Header, list: List, quote: Quote, table: Table, toggle: Toggle,
    callout: Callout, code: Code, image: Image, bold: Bold, italic: Italic, link: Link, marker: Marker, markBox: MarkBox, reactBox: ReactBox,
  },
});

const editors: TestEditor[] = [];

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const holders = new Map<TestEditor, HTMLElement>();

const boot = async (blocks: OutputBlockData[] = [], extra: Partial<BlokConfig> = {}): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({ ...config(), ...extra, holder, data: { blocks } }) as unknown as TestEditor;

  editors.push(editor);
  holders.set(editor, holder);
  await editor.isReady;
  await settle();

  return editor;
};

// Who wrote a block and when (the agent co-authors its import), and the random ids each paste mints.
const NOT_CONTENT = new Set(['id', 'rowId', 'createdAt', 'createdBy', 'createdWith', 'lastEditedAt', 'lastEditedBy', 'lastEditedWith']);

// An agent-written link gets the Link tool's target and rel; a pasted one keeps none. Pinned on its own below.
const withoutLinkDefaults = (link: unknown): unknown => {
  if (link === null || typeof link !== 'object') {
    return link;
  }
  const { target: _target, rel: _rel, ...rest } = link as Record<string, unknown>;

  return rest;
};

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
      return Object.fromEntries(Object.entries(value).filter(([key]) => !NOT_CONTENT.has(key)).map(([key, inner]) => [key, key === 'link' ? withoutLinkDefaults(inner) : swap(inner)]));
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
  // The paste runs past many timers; wait for the real one to finish, not for a guess.
  const paste = (editor as unknown as { module: { paste: { processDataTransfer(...args: unknown[]): Promise<void> } } }).module.paste;
  const run = paste.processDataTransfer.bind(paste);
  const pasted: Array<Promise<void>> = [];

  paste.processDataTransfer = (...args) => {
    const done = run(...args);

    pasted.push(done);

    return done;
  };
  target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
    clipboardData: { getData: (type: string): string => (type === 'text/html' ? html : ''), types: ['text/html'] },
  }));
  await vi.waitFor(() => expect(pasted).toHaveLength(1));
  await Promise.all(pasted);

  return stableSave(editor);
};

const agentImports = async (html: string, editor?: TestEditor): Promise<{ ok: boolean; blocks: OutputBlockData[]; result: AgentResult }> => {
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

// Two real editors boot per case; a table case takes seconds, past vitest's default.
describe('html.insert gives the blocks a person\'s paste gives', { timeout: 30_000 }, () => {
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

  it('tells the model to paste HTML with html.insert', async () => {
    const editor = await boot();

    expect(await editor.agent.guidance()).toContain('To add HTML, use the html.insert command');
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

/** The marks on every run of a block's text. */
const marksOf = (block: OutputBlockData | undefined): unknown[] =>
  Array.isArray(block?.data.text) ? block.data.text.map((run: { marks?: unknown }) => run.marks) : [];

describe('html.insert checks what the paste made, as it checks any agent write', () => {
  it('gives a pasted link the Link tool defaults, as every agent-written link', async () => {
    const imported = await agentImports('<p><a href="https://example.com">x</a></p>');

    expect(marksOf(imported.blocks.at(-1))).toEqual([{ link: { href: 'https://example.com', target: '_blank', rel: 'nofollow' } }]);
  });

  it('refuses a page mention that names a block id, and writes nothing', async () => {
    const editor = await boot([{ id: 'p1', type: 'paragraph', data: { text: 'keep' } }]);
    const before = (await editor.save()).blocks;
    const imported = await agentImports('<p>see <a data-blok-page-id="p1">x</a></p>', editor);

    expect(imported.result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
    expect(withoutIds(imported.blocks)).toEqual(withoutIds(before));
  });

  it('warns about a page mention it cannot check', async () => {
    const imported = await agentImports('<p>see <a data-blok-page-id="ghost">x</a></p>');

    expect(imported.result.warnings.map(warning => warning.code)).toContain('UNVERIFIED_PAGE');
  });

  it('refuses data that holds another person\'s reactions', async () => {
    const imported = await agentImports('<react-box data-who="human-2">r</react-box>');

    expect(imported.result).toMatchObject({ ok: false, error: { code: 'FIELD_NOT_WRITABLE' } });
    expect(imported.blocks.some(block => block.type === 'reactBox')).toBe(false);
  });

  it('snaps a pasted colour to a preset, as text.format does', async () => {
    const imported = await agentImports('<p><mark style="color: rgb(18, 52, 86); background-color: transparent">x</mark></p>');
    const colour = marksOf(imported.blocks.at(-1)).map(marks => (marks as { color?: string } | undefined)?.color);

    expect(imported.result.warnings.map(warning => warning.code)).toContain('CORRECTED');
    expect(colour.every(value => value === undefined || /^[a-z]+$/.test(value))).toBe(true);
  });
});

/** The person's paragraph text and caret, as plain values. */
const caretIn = (id: string): { text: string; offset: number | undefined; inside: boolean } => {
  const input = Array.from(document.querySelectorAll<HTMLElement>(`[data-blok-id="${id}"] *`)).find(element => element.contentEditable === 'true');
  const range = window.getSelection()?.rangeCount === 0 ? undefined : window.getSelection()?.getRangeAt(0);

  return { text: input?.textContent ?? '', offset: range?.startOffset, inside: input?.contains(range?.startContainer ?? null) === true };
};

const putCaret = (id: string, offset: number): void => {
  const input = Array.from(document.querySelectorAll<HTMLElement>(`[data-blok-id="${id}"] *`)).find(element => element.contentEditable === 'true');
  const text = input?.firstChild;

  if (text === null || text === undefined) {
    throw new Error('no text node');
  }
  const range = document.createRange();

  range.setStart(text, offset);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

describe('html.insert never writes through the person\'s caret', () => {
  it('pastes into the hidden editor even when the caret moves into the document mid-paste', async () => {
    // onBeforePaste runs inside the paste, before any block is written: a person clicking in then.
    const editor = await boot([{ id: 'p1', type: 'paragraph', data: { text: 'keep' } }], {
      onBeforePaste: (html: string) => {
        putCaret('p1', 1);

        return html;
      },
    });
    const imported = await agentImports('<p>new</p>', editor);

    expect(caretIn('p1')).toEqual({ text: 'keep', offset: 1, inside: true });
    expect(imported.ok).toBe(true);
    expect(imported.blocks.map(block => strings(block.data.text).join(''))).toEqual(['keep', 'new']);
  });

  it('keeps focus in a field outside the editor, through a block that takes no caret', async () => {
    const editor = await boot([{ id: 'p1', type: 'paragraph', data: { text: 'keep' } }]);
    const field = document.createElement('input');
    const blurred = vi.fn();

    document.body.appendChild(field);
    field.focus();
    field.addEventListener('blur', blurred);
    const imported = await agentImports('<p>a</p><img src="https://example.com/a.png"><p>b</p>', editor);

    expect(imported.ok).toBe(true);
    expect(field).toHaveFocus();
    expect(blurred).not.toHaveBeenCalled();
  });
});

describe('html.insert starts no upload and no fetch', () => {
  it('never calls an uploader or fetch for pasted image URLs', async () => {
    const toolUpload = vi.fn(() => Promise.resolve({ url: 'https://cdn.example.com/x' }));
    const hostUpload = vi.fn(() => Promise.resolve({ url: 'https://cdn.example.com/y' }));
    const fetched = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('no network')));
    const base = config();
    const editor = await boot([], {
      uploader: { uploadByUrl: hostUpload, uploadByFile: hostUpload },
      tools: { ...base.tools, image: { class: Image, config: { uploader: { uploadByUrl: toolUpload, uploadByFile: toolUpload } } }, video: Video },
    });
    const imported = await agentImports('<p>t</p><img src="http://example.com/a.gif"><img src="http://example.com/b.png">', editor);

    for (let i = 0; i < 10; i++) {
      await settle();
    }

    expect(toolUpload).not.toHaveBeenCalled();
    expect(hostUpload).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
    expect(imported.ok).toBe(true);
    expect(imported.blocks.filter(block => block.type === 'image').map(block => block.data.url)).toEqual(['http://example.com/a.gif', 'http://example.com/b.png']);
  });
});

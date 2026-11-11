/* eslint-disable playwright/expect-expect -- assertions live in the round-trip helpers */
/**
 * Text and inline marks copied inside ONE block and pasted back.
 *
 * These tests press the real Cmd/Ctrl+C and Cmd/Ctrl+V. Expected values come from
 * Blok's own save() of the source, sliced at the selection, and are compared
 * with the saved target through one canonical form (every element and
 * attribute, per character).
 */
import type { Locator, Page } from '@playwright/test';
import type { OutputBlockData, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { savedAsHtml } from '../helpers/saved-as-html';

// The real clipboard is shared inside one browser: keep every case in one worker.
test.describe.configure({ mode: 'default' });

type Loc = { id: string } | { cell: string } | { title: true };
type Sel = { from: string; to: string } | 'all' | 'cmdA';
type At = 'start' | 'end' | { before: string } | { replace: [string, string] };
type Clip = 'full' | 'plain';

interface Case {
  blocks: OutputBlockData[];
  title?: string;
  extraTools?: boolean;
  src: Loc;
  sel: Sel;
  tgt: Loc;
  at: At;
  op?: 'copy' | 'cut';
  clip?: Clip;
  /** Empty-paragraph targets may adopt the source block type. */
  allowTypeChange?: boolean;
  /** A newline may split the paste into new blocks after the target (plain text). */
  allowSplit?: boolean;
  /** Skip the clipboard-text == selection-text guard (KaTeX copies its MathML text too). */
  looseCopyCheck?: boolean;
  /** A pasted bare URL lands as a link to itself, with the paste menu open. */
  urlBecomesLink?: boolean;
}

interface Result {
  expected: string[];
  actual: string[];
  structureBefore: string[];
  structureAfter: string[];
  copyLog: unknown;
  pasteLog: unknown;
  clipboard: Record<string, string>;
  targetType: { before: string; after: string };
  /** Plain text of the target plus every NEW block after it, joined by newlines. */
  spanText: string;
  lostIds: string[];
}

declare global {
  interface Window {
    __cpLog?: { copy: unknown[]; paste: unknown[] };
    __cpEquation?: unknown;
  }
}

const VAR_TEXT = 'color: var(--blok-color-red-text); background-color: transparent;';
const VAR_BG = 'background-color: var(--blok-color-yellow-bg);';
const VAR_BOTH = 'color: var(--blok-color-blue-text); background-color: var(--blok-color-green-bg);';
const RICH = 'Alpha <b>bold</b> <i>ital</i> <u>und</u> <s>str</s> <code>cod</code> <a href="https://example.com/">lnk</a> omega';

const p = (id: string, text: string): OutputBlockData => ({ id, type: 'paragraph', data: { text } });
const TARGET = (): OutputBlockData => p('tgt', 'Target text here');
const EMPTY = (): OutputBlockData => p('tgt', '');

const make = async (page: Page, c: Case): Promise<void> => {
  await page.evaluate(async ({ blocks, title, extraTools }) => {
    const w = window as unknown as {
      blokInstance?: { destroy?: () => Promise<void> };
      Blok: new (config: unknown) => { isReady: Promise<void> };
      BlokSupSub: unknown;
    };

    if (w.blokInstance) {
      await w.blokInstance.destroy?.();
      w.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);

    const tools: Record<string, unknown> = {};

    if (extraTools) {
      if (window.__cpEquation === undefined) {
        // @ts-expect-error built bundle has no TS types — runtime-only dynamic import
        const mod = await import('/dist/tools.mjs?_v=1') as { Equation: unknown };

        window.__cpEquation = mod.Equation;
      }
      tools.supSub = { class: w.BlokSupSub };
      tools.equation = { class: window.__cpEquation };
    }

    const blok = new w.Blok({
      holder: 'blok',
      tools,
      ...(title !== undefined ? { pageTitle: true } : {}),
      data: { blocks, ...(title !== undefined ? { title } : {}) },
    });

    (w as unknown as { blokInstance: unknown }).blokInstance = blok;
    await blok.isReady;

    if (window.__cpLog === undefined) {
      window.__cpLog = { copy: [], paste: [] };
      window.addEventListener('copy', (e) => {
        const dt = e.clipboardData;

        window.__cpLog?.copy.push({
          defaultPrevented: e.defaultPrevented,
          types: dt ? Array.from(dt.types) : [],
          data: dt ? Object.fromEntries(Array.from(dt.types).map(t => [t, dt.getData(t).slice(0, 3000)])) : {},
        });
      });
      window.addEventListener('cut', (e) => {
        const dt = e.clipboardData;

        window.__cpLog?.copy.push({
          cut: true,
          defaultPrevented: e.defaultPrevented,
          types: dt ? Array.from(dt.types) : [],
        });
      });
      window.addEventListener('paste', (e) => {
        const dt = e.clipboardData;

        window.__cpLog?.paste.push({
          types: dt ? Array.from(dt.types) : [],
          plain: dt?.getData('text/plain') ?? '',
          html: (dt?.getData('text/html') ?? '').slice(0, 4000),
        });
      }, true);
    }
    window.__cpLog.copy = [];
    window.__cpLog.paste = [];
  }, { blocks: c.blocks, title: c.title, extraTools: c.extraTools === true });
};

const save = async (page: Page): Promise<OutputData> =>
  savedAsHtml(await page.evaluate(async () => {
    const w = window as unknown as { blokInstance: { save: () => Promise<OutputData> } };

    return await w.blokInstance.save();
  }));

const resolveId = (saved: OutputData, loc: Loc): string | null => {
  if ('title' in loc) {
    return null;
  }
  if ('id' in loc) {
    return loc.id;
  }

  const hit = saved.blocks.find(b => b.parent !== undefined && typeof b.data?.text === 'string' && (b.data.text).includes(loc.cell));

  if (hit?.id === undefined) {
    throw new Error(`no table cell block with text ${loc.cell}`);
  }

  return hit.id;
};

const editableOf = (page: Page, id: string | null): Locator => id === null
  ? page.getByTestId('page-header-title')
  : page.locator(`[data-blok-id="${id}"] [contenteditable="true"], [data-blok-id="${id}"] [contenteditable="plaintext-only"]`).first();

/** Saved value of a location: rich HTML, code string, or title string. */
const valueOf = (saved: OutputData, id: string | null): { kind: 'rich' | 'plain'; value: string; type: string } => {
  if (id === null) {
    const title = (saved as OutputData & { title?: unknown }).title;

    return { kind: 'plain', value: typeof title === 'string' ? title : JSON.stringify(title ?? ''), type: 'title' };
  }

  const block = saved.blocks.find(b => b.id === id);

  if (block === undefined) {
    return { kind: 'plain', value: '<<BLOCK MISSING>>', type: 'missing' };
  }
  if (block.type === 'code') {
    return { kind: 'plain', value: typeof block.data.code === 'string' ? block.data.code : '', type: 'code' };
  }

  const field = typeof block.data.text === 'string' ? block.data.text : JSON.stringify(block.data);

  return { kind: 'rich', value: field, type: block.type };
};

/** Per character: the char plus every enclosing element with all its attributes. */
const canon = async (page: Page, html: string, kind: 'rich' | 'plain'): Promise<string[]> => {
  if (kind === 'plain') {
    return Array.from(html).map(ch => (ch === '\n' ? '⏎' : ch));
  }

  return await page.evaluate((source) => {
    const tpl = document.createElement('template');

    tpl.innerHTML = source;
    const out: string[] = [];
    const tagOf = (el: Element): string => {
      const attrs = Array.from(el.attributes).map((a) => {
        const v = a.name === 'style'
          ? a.value.split(';').map(s => s.trim().replace(/\s*:\s*/, ':')).filter(Boolean).sort().join(';')
          : a.value;

        return `${a.name}=${v}`;
      }).sort();

      return `${el.tagName.toLowerCase()}${attrs.length ? `[${attrs.join(' ')}]` : ''}`;
    };
    const walk = (node: Node, stack: string[]): void => {
      node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          for (const ch of Array.from(child.textContent ?? '')) {
            out.push(`${ch === ' ' ? '⍽' : ch}${stack.length ? ` <${stack.join('>')}>` : ''}`);
          }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const el = child as Element;

          if (el.tagName === 'BR') {
            out.push(`⏎${stack.length ? ` <${stack.join('>')}>` : ''}`);
          } else {
            walk(el, [ ...stack, tagOf(el) ]);
          }
        }
      });
    };

    walk(tpl.content, []);

    return out;
  }, html);
};

const plainOf = (chars: string[]): string => chars.map(c => c.split(' <')[0]).join('').replace(/⏎/g, '\n').replace(/⍽/g, ' ');
const unmark = (chars: string[]): string[] => chars.map(c => (c.startsWith(' ') ? ' ' : c.split(' <')[0]));

/** Index (in canonical chars) of a needle in a canonical char list. */
const indexIn = (chars: string[], needle: string): number => {
  const plain = Array.from(plainOf(chars));
  const text = plain.join('');
  const at = text.indexOf(needle);

  if (at < 0) {
    throw new Error(`needle "${needle}" not in "${text}"`);
  }

  return Array.from(text.slice(0, at)).length;
};

/** Text-node offsets (UTF-16) of needles in an element's DOM text. */
const selectInDom = async (el: Locator, sel: { from: string; to: string } | 'all'): Promise<string> =>
  await el.evaluate((root, s) => {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push(n as Text);
    }
    const range = document.createRange();

    if (s === 'all') {
      range.selectNodeContents(root);
    } else {
      const raw = nodes.map(n => n.data).join('');
      // A cut leaves nbsp where a space was; fall back to matching on plain spaces.
      const text = raw.includes(s.from) ? raw : raw.replace(/\u00a0/g, ' ');
      const start = text.indexOf(s.from);
      const endNeedle = text.indexOf(s.to, start);

      if (start < 0 || endNeedle < 0) {
        throw new Error(`DOM needles ${s.from}/${s.to} not in "${text}"`);
      }
      const end = endNeedle + s.to.length;
      const locate = (offset: number, preferNext: boolean): [Text, number] => {
        let acc = 0;

        for (let i = 0; i < nodes.length; i++) {
          const len = nodes[i].data.length;

          if (offset < acc + len || (offset === acc + len && (!preferNext || i === nodes.length - 1))) {
            return [nodes[i], offset - acc];
          }
          acc += len;
        }

        return [nodes[nodes.length - 1], nodes[nodes.length - 1].data.length];
      };
      const [sn, so] = locate(start, true);
      const [en, eo] = locate(end, false);

      range.setStart(sn, so);
      range.setEnd(en, eo);
    }
    (root as HTMLElement).focus();
    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    return selection?.toString() ?? '';
  }, sel);

const placeCaret = async (el: Locator, at: At): Promise<void> => {
  if (typeof at === 'object' && 'replace' in at) {
    await selectInDom(el, { from: at.replace[0], to: at.replace[1] });

    return;
  }
  await el.evaluate((root, a) => {
    (root as HTMLElement).focus();
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push(n as Text);
    }
    const range = document.createRange();

    if (a === 'start' || nodes.length === 0) {
      range.selectNodeContents(root);
      range.collapse(true);
    } else if (a === 'end') {
      range.selectNodeContents(root);
      range.collapse(false);
    } else {
      const raw = nodes.map(n => n.data).join('');
      const text = raw.includes(a.before) ? raw : raw.replace(/\u00a0/g, ' ');
      const at2 = text.indexOf(a.before);

      if (at2 < 0) {
        throw new Error(`caret needle ${a.before} not in ${text}`);
      }
      let acc = 0;

      for (const [i, n] of nodes.entries()) {
        const next = nodes[i + 1];

        // On a node boundary, put the caret between elements, not inside the previous mark.
        // eslint-disable-next-line max-depth -- in-page DOM walk
        if (at2 === acc + n.data.length && next !== undefined) {
          let top: Node = next;

          // eslint-disable-next-line max-depth -- in-page DOM walk
          while (top.parentNode !== null && top.parentNode !== root) {
            top = top.parentNode;
          }
          range.setStartBefore(top);
          range.collapse(true);
          break;
        }
        // eslint-disable-next-line max-depth -- in-page DOM walk
        if (at2 < acc + n.data.length || next === undefined) {
          range.setStart(n, at2 - acc);
          range.collapse(true);
          break;
        }
        acc += n.data.length;
      }
    }
    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, at);
};

const readClipboard = async (page: Page): Promise<Record<string, string>> =>
  await page.evaluate(async () => {
    const out: Record<string, string> = {};

    for (const item of await navigator.clipboard.read()) {
      for (const type of item.types) {
        out[type] = await (await item.getType(type)).text();
      }
    }

    return out;
  });

const structure = (saved: OutputData): string[] =>
  saved.blocks.map(b => `${b.id}:${b.type} parent=${b.parent ?? '-'} content=${(b.content ?? []).join(',')}`);

const settle = async (page: Page, before: string): Promise<OutputData> => {
  const deadline = Date.now() + 3000;
  let last = await save(page);

  while (Date.now() < deadline && JSON.stringify(last) === before) {
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(100);
    last = await save(page);
  }
  // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
  await page.waitForTimeout(300);

  return await save(page);
};

const roundTrip = async (page: Page, c: Case): Promise<Result> => {
  await page.context().grantPermissions([ 'clipboard-read', 'clipboard-write' ]);
  await make(page, c);
  const initial = await save(page);
  const srcId = resolveId(initial, c.src);
  const tgtId = resolveId(initial, c.tgt);
  const srcEl = editableOf(page, srcId);
  const srcValue = valueOf(initial, srcId);
  const srcChars = await canon(page, srcValue.value, srcValue.kind);

  // Fragment the user selected, from the saved source.
  let fragment: string[];
  let selectedText: string;

  if (c.sel === 'cmdA') {
    await placeCaret(srcEl, 'start');
    await page.keyboard.press('ControlOrMeta+a');
    selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    fragment = srcChars;
  } else {
    selectedText = await selectInDom(srcEl, c.sel);
    if (c.sel === 'all') {
      fragment = srcChars;
    } else {
      const start = indexIn(srcChars, c.sel.from);
      const endAt = indexIn(srcChars.slice(start), c.sel.to) + start + Array.from(c.sel.to).length;

      fragment = srcChars.slice(start, endAt);
    }
  }

  await page.keyboard.press(c.op === 'cut' ? 'ControlOrMeta+x' : 'ControlOrMeta+c');
  const clipboard = await readClipboard(page);

  // NFKC: Chrome copies KaTeX math italics (U+1D438) as plain letters.
  const norm = (t: string): string => t.normalize('NFKC').replace(/\s+/g, ' ').trim();

  if (c.looseCopyCheck !== true && norm(clipboard['text/plain'] ?? '') !== norm(selectedText)) {
    throw new Error(`CLOBBERED_OR_NO_COPY: clipboard text ${JSON.stringify(clipboard['text/plain'])} != selection ${JSON.stringify(selectedText)}`);
  }
  if (c.clip === 'plain') {
    await page.evaluate(async (text) => {
      await navigator.clipboard.write([ new ClipboardItem({ 'text/plain': new Blob([ text ], { type: 'text/plain' }) }) ]);
    }, clipboard['text/plain'] ?? '');
  }

  const beforePaste = await save(page);
  const tgtValue = valueOf(beforePaste, tgtId);
  const tgtChars = await canon(page, tgtValue.value, tgtValue.kind);
  const tgtEl = editableOf(page, tgtId);

  await placeCaret(tgtEl, c.at);

  let insertAt: number;
  let removeCount = 0;

  if (c.at === 'start') {
    insertAt = 0;
  } else if (c.at === 'end') {
    insertAt = tgtChars.length;
  } else if ('before' in c.at) {
    insertAt = indexIn(tgtChars, c.at.before);
  } else {
    insertAt = indexIn(tgtChars, c.at.replace[0]);
    removeCount = indexIn(tgtChars.slice(insertAt), c.at.replace[1]) + Array.from(c.at.replace[1]).length;
  }

  const plainPaste = c.clip === 'plain' || tgtValue.kind === 'plain';
  let insert = plainPaste ? unmark(fragment) : fragment;

  // Chrome writes U+00A0 as U+0020 in text/plain, so a plain-only paste cannot carry it.
  if (c.clip === 'plain') {
    insert = insert.map(ch => (ch === '⍽' ? ' ' : ch));
  }

  if (tgtValue.type === 'title') {
    insert = Array.from(plainOf(insert).replace(/\s*\n\s*/g, ' '));
  } else if (tgtValue.kind === 'plain') {
    insert = Array.from(plainOf(insert)).map(ch => (ch === '\n' ? '⏎' : ch));
  }
  if (c.urlBecomesLink === true) {
    const url = plainOf(insert);

    insert = insert.map(ch => `${ch} <a[href=${url} rel=nofollow target=_blank]>`);
  }
  const expected = [ ...tgtChars.slice(0, insertAt), ...insert, ...tgtChars.slice(insertAt + removeCount) ];

  const beforeJson = JSON.stringify(beforePaste);

  await page.keyboard.press('ControlOrMeta+v');
  const after = await settle(page, beforeJson);
  const afterValue = valueOf(after, tgtId);
  const actual = await canon(page, afterValue.value, afterValue.kind);
  const logs = await page.evaluate(() => window.__cpLog);
  const beforeIds = new Set(beforePaste.blocks.map(b => b.id));
  const tgtIndex = after.blocks.findIndex(b => b.id === tgtId);
  const span: string[] = [];

  if (tgtIndex >= 0) {
    span.push(plainOf(actual));
    for (const b of after.blocks.slice(tgtIndex + 1)) {
      // eslint-disable-next-line max-depth -- in-page DOM walk
      if (beforeIds.has(b.id)) {
        break;
      }
      const v = valueOf(after, b.id ?? null);

      span.push(plainOf(await canon(page, v.value, v.kind)));
    }
  }

  return {
    spanText: span.join('\n'),
    lostIds: [ ...beforeIds ].filter(id => !after.blocks.some(b => b.id === id)) as string[],
    expected,
    actual,
    structureBefore: structure(beforePaste),
    structureAfter: structure(after),
    copyLog: logs?.copy,
    pasteLog: logs?.paste,
    clipboard: {
      ...clipboard,
      'text/html': (clipboard['text/html'] ?? '').replace(/ class="[^"]*"/g, ' class=…').slice(0, 2500),
      'text/plain codepoints': Array.from(clipboard['text/plain'] ?? '').filter(ch => /\s/.test(ch)).map(ch => ch.codePointAt(0)?.toString(16)).join(','),
    },
    targetType: { before: tgtValue.type, after: afterValue.type },
  };
};

const check = (r: Result, c: Case): void => {

  if (c.allowSplit === true) {
    expect.soft(r.lostIds, 'no block lost').toEqual([]);
    expect.soft(r.spanText, 'all text arrives in order, split at newlines').toBe(plainOf(r.expected));

    return;
  }
  // Marker color values aside, does anything else differ?
  const noMarkerStyle = (chars: string[]): string[] => chars.map(ch => ch.replace(/mark\[style=[^\]]*\]/g, 'mark'));

  expect.soft(noMarkerStyle(r.actual), 'text + marks per char, ignoring marker color values').toEqual(noMarkerStyle(r.expected));

  const typeOk = r.targetType.after === r.targetType.before ||
    (c.allowTypeChange === true && r.targetType.after !== 'missing');

  expect.soft(r.structureAfter.length, 'block count unchanged').toBe(r.structureBefore.length);
  if (typeOk) {
    expect.soft(r.structureAfter.map(s => s.replace(/:[^ ]+ /, ' ')), 'block ids/parents unchanged').toEqual(r.structureBefore.map(s => s.replace(/:[^ ]+ /, ' ')));
  } else {
    expect.soft(r.structureAfter, 'structure (incl. target type) unchanged').toEqual(r.structureBefore);
  }
  expect.soft(r.actual, 'target text + marks per char').toEqual(r.expected);
};

const run = async (page: Page, c: Case): Promise<void> => {
  check(await roundTrip(page, c), c);
};

test.describe('text-inline round trips', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('sanity: save shape of toggle/callout without a page title', async ({ page }) => {
    await make(page, {
      blocks: [
        { id: 't', type: 'toggle', data: { text: 'Tog' } },
        { id: 'c', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: [ 'cp' ] },
        { id: 'cp', type: 'paragraph', parent: 'c', data: { text: 'Call' } },
      ],
      src: { id: 't' }, sel: 'all', tgt: { id: 't' }, at: 'end',
    });
    const saved = await save(page);

    expect(saved.blocks.map(b => b.type)).toEqual([ 'toggle', 'callout', 'paragraph' ]);
  });

  // ---------------------------------------------------------------- sources
  test.describe('source block types, partial marked range -> empty paragraph', () => {
    const sources: Array<[string, OutputBlockData[], Loc]> = [
      [ 'paragraph', [ p('src', RICH) ], { id: 'src' } ],
      ...[ 1, 2, 3, 4, 5, 6 ].map((level): [string, OutputBlockData[], Loc] => [ `header h${level}`, [ { id: 'src', type: 'header', data: { text: RICH, level } } ], { id: 'src' } ]),
      [ 'quote', [ { id: 'src', type: 'quote', data: { text: RICH } } ], { id: 'src' } ],
      [ 'list unordered', [ { id: 'src', type: 'list', data: { text: RICH, style: 'unordered' } } ], { id: 'src' } ],
      [ 'list ordered', [ { id: 'src', type: 'list', data: { text: RICH, style: 'ordered' } } ], { id: 'src' } ],
      [ 'list checklist', [ { id: 'src', type: 'list', data: { text: RICH, style: 'checklist', checked: true } } ], { id: 'src' } ],
      [ 'toggle title', [ { id: 'src', type: 'toggle', data: { text: RICH } } ], { id: 'src' } ],
      [ 'callout text', [ { id: 'co', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: [ 'src' ] }, { ...p('src', RICH), parent: 'co' } ], { id: 'src' } ],
      [ 'table cell paragraph', [ { id: 'tb', type: 'table', data: { withHeadings: false, content: [ [ RICH, 'B' ] ] } } ], { cell: 'Alpha' } ],
    ];

    for (const [ name, blocks, src ] of sources) {
      test(`partial: ${name}`, async ({ page }) => {
        await run(page, { blocks: [ ...blocks, EMPTY() ], src, sel: { from: 'pha', to: 'om' }, tgt: { id: 'tgt' }, at: 'start' });
      });
      test(`whole text (select node contents): ${name}`, async ({ page }) => {
        await run(page, { blocks: [ ...blocks, EMPTY() ], src, sel: 'all', tgt: { id: 'tgt' }, at: 'start', allowTypeChange: true });
      });
      test(`whole text -> mid non-empty paragraph: ${name}`, async ({ page }) => {
        await run(page, { blocks: [ ...blocks, TARGET() ], src, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'text here' } });
      });
    }
  });

  // ---------------------------------------------------------------- marks
  test.describe('each inline mark, paragraph -> mid paragraph', () => {
    const marks: Array<[string, string, { from: string; to: string }]> = [
      [ 'bold', 'aa <b>bold</b> zz', { from: 'a ', to: ' z' } ],
      [ 'italic', 'aa <i>ital</i> zz', { from: 'a ', to: ' z' } ],
      [ 'underline', 'aa <u>und</u> zz', { from: 'a ', to: ' z' } ],
      [ 'strikethrough', 'aa <s>str</s> zz', { from: 'a ', to: ' z' } ],
      [ 'inline code', 'aa <code>cod</code> zz', { from: 'a ', to: ' z' } ],
      [ 'link', 'aa <a href="https://example.com/x">lnk</a> zz', { from: 'a ', to: ' z' } ],
      [ 'link with target/rel', 'aa <a href="https://example.com/x" target="_blank" rel="nofollow noopener noreferrer">lnk</a> zz', { from: 'a ', to: ' z' } ],
      [ 'marker text color (preset var)', `aa <mark style="${VAR_TEXT}">red</mark> zz`, { from: 'a ', to: ' z' } ],
      [ 'marker background (preset var)', `aa <mark style="${VAR_BG}">hl</mark> zz`, { from: 'a ', to: ' z' } ],
      [ 'marker text+background (preset var)', `aa <mark style="${VAR_BOTH}">both</mark> zz`, { from: 'a ', to: ' z' } ],
      [ 'marker rgb literal', 'aa <mark style="color: rgb(212, 76, 71); background-color: rgb(251, 243, 219);">lit</mark> zz', { from: 'a ', to: ' z' } ],
      [ 'nested bold+italic+link', 'aa <b><i><a href="https://example.com/n">deep</a></i></b> zz', { from: 'a ', to: ' z' } ],
      [ 'bold+marker+code', `aa <b><mark style="${VAR_BG}">x<code>y</code></mark></b> zz`, { from: 'a ', to: ' z' } ],
      [ 'selection inside one bold run', 'aa <b>boldness</b> zz', { from: 'ld', to: 'ne' } ],
      [ 'selection starts inside link, ends outside', 'aa <a href="https://example.com/s">linky</a> zz', { from: 'nk', to: ' z' } ],
      [ 'page reference', 'aa <a data-blok-page-id="page-123">Page</a> zz', { from: 'a ', to: ' z' } ],
    ];

    const knownRed: Record<string, string> = {
      'link with target/rel': 'text-inline-marks-each: a copy inside one block drops the link target and rel (possible regression from 2216d7bd, not bisected)',
      'selection inside one bold run': 'text-inline-marks-each: a copy inside one bold run drops the bold around it (possible regression from 2216d7bd, not bisected)',
    };

    for (const [ name, text, sel ] of marks) {
      test(`mark: ${name}`, async ({ page }) => {
        test.fixme(name in knownRed, knownRed[name]);
        await run(page, { blocks: [ p('src', text), TARGET() ], src: { id: 'src' }, sel, tgt: { id: 'tgt' }, at: { before: 'text here' } });
      });
    }

    test('mark: superscript/subscript', async ({ page }) => {
      await run(page, { extraTools: true, blocks: [ p('src', 'aa x<sup>2</sup> H<sub>2</sub>O zz'), TARGET() ], src: { id: 'src' }, sel: { from: 'a ', to: ' z' }, tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });

    test('mark: inline equation', async ({ page }) => {
      await run(page, { looseCopyCheck: true, extraTools: true, blocks: [ p('src', 'aa <span data-latex="E=mc^2"></span> zz'), TARGET() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
  });

  // ---------------------------------------------------------------- targets
  test.describe('marked fragment -> every target kind', () => {
    const FRAG = `x <b>B</b> <a href="https://example.com/t">L</a> <mark style="${VAR_BG}">M</mark> y`;
    const SRC = p('src', FRAG);
    const sel = { from: 'x', to: 'y' };
    const targets: Array<[string, OutputBlockData[], Loc, At]> = [
      [ 'empty paragraph', [ EMPTY() ], { id: 'tgt' }, 'start' ],
      [ 'paragraph start', [ TARGET() ], { id: 'tgt' }, 'start' ],
      [ 'paragraph middle', [ TARGET() ], { id: 'tgt' }, { before: 'text here' } ],
      [ 'paragraph end', [ TARGET() ], { id: 'tgt' }, 'end' ],
      [ 'paragraph, replace selected word', [ TARGET() ], { id: 'tgt' }, { replace: [ 'text', 'text' ] } ],
      [ 'paragraph with marks, caret between marks', [ p('tgt', '<b>Bold</b><i>Ital</i>') ], { id: 'tgt' }, { before: 'Ital' } ],
      [ 'header h2 middle', [ { id: 'tgt', type: 'header', data: { text: 'Head line', level: 2 } } ], { id: 'tgt' }, { before: 'line' } ],
      [ 'empty header h3', [ { id: 'tgt', type: 'header', data: { text: '', level: 3 } } ], { id: 'tgt' }, 'start' ],
      [ 'list item middle', [ { id: 'tgt', type: 'list', data: { text: 'List item', style: 'unordered' } } ], { id: 'tgt' }, { before: 'item' } ],
      [ 'empty checklist item', [ { id: 'tgt', type: 'list', data: { text: '', style: 'checklist', checked: false } } ], { id: 'tgt' }, 'start' ],
      [ 'quote middle', [ { id: 'tgt', type: 'quote', data: { text: 'Quote body' } } ], { id: 'tgt' }, { before: 'body' } ],
      [ 'toggle title middle', [ { id: 'tgt', type: 'toggle', data: { text: 'Toggle title' } } ], { id: 'tgt' }, { before: 'title' } ],
      [ 'callout paragraph middle', [ { id: 'co', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: [ 'tgt' ] }, { ...p('tgt', 'Callout text'), parent: 'co' } ], { id: 'tgt' }, { before: 'text' } ],
      [ 'empty callout paragraph', [ { id: 'co', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: [ 'tgt' ] }, { ...p('tgt', ''), parent: 'co' } ], { id: 'tgt' }, 'start' ],
      [ 'table cell middle', [ { id: 'tb', type: 'table', data: { withHeadings: false, content: [ [ 'Cell one', 'Other' ] ] } } ], { cell: 'Cell one' }, { before: 'one' } ],
      [ 'code block middle', [ { id: 'tgt', type: 'code', data: { code: 'let a = 1;', language: 'javascript' } } ], { id: 'tgt' }, { before: '= 1' } ],
    ];

    for (const [ name, blocks, tgt, at ] of targets) {
      test(`target: ${name}`, async ({ page }) => {
        await run(page, { blocks: [ SRC, ...blocks ], src: { id: 'src' }, sel, tgt, at });
      });
    }

    test('target: page title middle', async ({ page }) => {
      await run(page, { title: 'Page name', blocks: [ SRC ], src: { id: 'src' }, sel, tgt: { title: true }, at: { before: 'name' } });
    });
  });

  // ---------------------------------------------------------------- text features
  test.describe('text features', () => {
    test('soft line break (<br>) inside range -> mid paragraph', async ({ page }) => {
      await run(page, { blocks: [ p('src', 'one <b>two</b><br>three four'), TARGET() ], src: { id: 'src' }, sel: { from: 'ne', to: 'thr' }, tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('soft line break (<br>) inside range -> empty paragraph', async ({ page }) => {
      await run(page, { blocks: [ p('src', 'one two<br>three four'), EMPTY() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: 'start' });
    });
    test('two soft line breaks in a row -> mid paragraph', async ({ page }) => {
      await run(page, { blocks: [ p('src', 'one<br><br>two'), TARGET() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('leading and trailing spaces in range', async ({ page }) => {
      await run(page, { blocks: [ p('src', 'aa <b>bb</b> cc'), TARGET() ], src: { id: 'src' }, sel: { from: ' b', to: 'b ' }, tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('range of only a leading space + word at paragraph end', async ({ page }) => {
      await run(page, { blocks: [ p('src', 'aa bb'), TARGET() ], src: { id: 'src' }, sel: { from: ' b', to: 'bb' }, tgt: { id: 'tgt' }, at: 'end' });
    });
    test('non-breaking spaces and double spaces', async ({ page }) => {
      await run(page, { blocks: [ p('src', 'a&nbsp;b&nbsp;&nbsp;c d'), TARGET() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('emoji, ZWJ sequences, flags, CJK, RTL', async ({ page }) => {
      await run(page, { blocks: [ p('src', 'a 👍🏽 👨‍👩‍👧 🇺🇸 漢字 שלום <b>𝒳</b> z'), TARGET() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('HTML special characters & < > " \'', async ({ page }) => {
      await run(page, { blocks: [ p('src', 'a &amp; &lt;b&gt; "q" \'s\' z'), TARGET() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('text that looks like markdown', async ({ page }) => {
      await run(page, { blocks: [ p('src', '# not a heading **not bold** - not list'), TARGET() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('text that looks like markdown -> empty paragraph', async ({ page }) => {
      await run(page, { blocks: [ p('src', '# not a heading **not bold**'), EMPTY() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: 'start' });
    });
    test('a URL as plain text -> mid paragraph', async ({ page }) => {
      await run(page, { blocks: [ p('src', 'https://example.com/path'), TARGET() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'text here' }, urlBecomesLink: true });
      await expect(page.locator('[data-blok-item-name="paste-menu-bookmark"]')).toBeVisible();
    });
  });

  // ---------------------------------------------------------------- code + title sources
  test.describe('code block and page title sources', () => {
    const CODE = (): OutputBlockData => ({ id: 'src', type: 'code', data: { code: 'const a = 1;\nconst b = 2;', language: 'javascript' } });

    test('code multi-line partial -> mid paragraph', async ({ page }) => {
      await run(page, { blocks: [ CODE(), TARGET() ], src: { id: 'src' }, sel: { from: 'a =', to: 'b =' }, tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('code multi-line partial -> empty paragraph', async ({ page }) => {
      await run(page, { blocks: [ CODE(), EMPTY() ], src: { id: 'src' }, sel: { from: 'a =', to: 'b =' }, tgt: { id: 'tgt' }, at: 'start', allowTypeChange: true });
    });
    test('code single-line partial -> mid paragraph', async ({ page }) => {
      await run(page, { blocks: [ CODE(), TARGET() ], src: { id: 'src' }, sel: { from: 'a =', to: '1;' }, tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('code multi-line -> another code block', async ({ page }) => {
      await run(page, { blocks: [ CODE(), { id: 'tgt', type: 'code', data: { code: 'let x;', language: 'javascript' } } ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: 'end' });
    });
    test('code multi-line -> table cell', async ({ page }) => {
      await run(page, { blocks: [ CODE(), { id: 'tb', type: 'table', data: { withHeadings: false, content: [ [ 'Cell one', 'Other' ] ] } } ], src: { id: 'src' }, sel: 'all', tgt: { cell: 'Cell one' }, at: 'end' });
    });
    test('page title whole -> empty paragraph', async ({ page }) => {
      // With a page title, a lone empty paragraph is not saved; a second block keeps it.
      await run(page, { title: 'My page name', blocks: [ EMPTY(), p('other', 'Other') ], src: { title: true }, sel: 'all', tgt: { id: 'tgt' }, at: 'start', allowTypeChange: true });
    });
    test('page title whole -> mid paragraph', async ({ page }) => {
      await run(page, { title: 'My page name', blocks: [ TARGET() ], src: { title: true }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('page title partial -> mid paragraph', async ({ page }) => {
      await run(page, { title: 'My page name', blocks: [ TARGET() ], src: { title: true }, sel: { from: 'page', to: 'na' }, tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('page title whole -> list item middle', async ({ page }) => {
      await run(page, { title: 'My page name', blocks: [ { id: 'tgt', type: 'list', data: { text: 'List item', style: 'unordered' } } ], src: { title: true }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'item' } });
    });
    test('paragraph -> page title (marks dropped, title is plain)', async ({ page }) => {
      await run(page, { title: 'Page name', blocks: [ p('src', 'aa <b>bb</b><br>cc') ], src: { id: 'src' }, sel: 'all', tgt: { title: true }, at: 'end' });
    });
  });

  // ---------------------------------------------------------------- whole heading into other blocks
  test.describe('whole heading text into non-paragraph targets', () => {
    const H = (): OutputBlockData => ({ id: 'src', type: 'header', data: { text: 'Head <b>B</b> text', level: 2 } });

    test('whole h2 -> list item middle', async ({ page }) => {
      await run(page, { blocks: [ H(), { id: 'tgt', type: 'list', data: { text: 'List item', style: 'unordered' } } ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'item' } });
    });
    test('whole h2 -> table cell', async ({ page }) => {
      await run(page, { blocks: [ H(), { id: 'tb', type: 'table', data: { withHeadings: false, content: [ [ 'Cell one', 'Other' ] ] } } ], src: { id: 'src' }, sel: 'all', tgt: { cell: 'Cell one' }, at: { before: 'one' } });
    });
    test('whole h2 -> another h2 middle', async ({ page }) => {
      await run(page, { blocks: [ H(), { id: 'tgt', type: 'header', data: { text: 'Other head', level: 2 } } ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'head' } });
    });
    test('whole quote -> mid paragraph', async ({ page }) => {
      await run(page, { blocks: [ { id: 'src', type: 'quote', data: { text: 'Quoted <i>words</i>' } }, TARGET() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
  });

  // ---------------------------------------------------------------- Cmd+A, cut, replace
  test.describe('keyboard select-all, cut, paste back', () => {
    test('Cmd+A once in paragraph, copy -> empty paragraph', async ({ page }) => {
      await run(page, { blocks: [ p('src', RICH), EMPTY() ], src: { id: 'src' }, sel: 'cmdA', tgt: { id: 'tgt' }, at: 'start', allowTypeChange: true });
    });
    test('Cmd+A once in header, copy -> mid paragraph', async ({ page }) => {
      await run(page, { blocks: [ { id: 'src', type: 'header', data: { text: 'Head <b>B</b> text', level: 2 } }, TARGET() ], src: { id: 'src' }, sel: 'cmdA', tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('cut marked range from paragraph, paste back in place', async ({ page }) => {
      await page.context().grantPermissions([ 'clipboard-read', 'clipboard-write' ]);
      const original = RICH;

      await make(page, { blocks: [ p('src', original) ], src: { id: 'src' }, sel: 'all', tgt: { id: 'src' }, at: 'end' });
      const before = await save(page);
      const el = editableOf(page, 'src');

      await selectInDom(el, { from: 'old', to: 'nk' });
      await page.keyboard.press('ControlOrMeta+x');
      const mid = await settle(page, JSON.stringify(before));

      await placeCaret(el, { before: ' omega' });
      await page.keyboard.press('ControlOrMeta+v');
      const after = await settle(page, JSON.stringify(mid));
      const beforeChars = await canon(page, String(before.blocks[0].data.text), 'rich');
      const afterChars = await canon(page, String(after.blocks[0].data.text), 'rich');

      expect.soft(after.blocks.length).toBe(1);
      expect.soft(afterChars).toEqual(beforeChars);
    });
    test('cut from header, paste back in place', async ({ page }) => {
      await page.context().grantPermissions([ 'clipboard-read', 'clipboard-write' ]);
      await make(page, { blocks: [ { id: 'src', type: 'header', data: { text: 'Head <b>Bold</b> <a href="https://example.com/">L</a> end', level: 2 } } ], src: { id: 'src' }, sel: 'all', tgt: { id: 'src' }, at: 'end' });
      const before = await save(page);
      const el = editableOf(page, 'src');

      await selectInDom(el, { from: 'ad', to: 'L' });
      await page.keyboard.press('ControlOrMeta+x');
      const mid = await settle(page, JSON.stringify(before));

      await placeCaret(el, { before: ' end' });
      await page.keyboard.press('ControlOrMeta+v');
      const after = await settle(page, JSON.stringify(mid));

      expect.soft(after.blocks.map(b => b.type)).toEqual([ 'header' ]);
      expect.soft(await canon(page, String(after.blocks[0].data.text), 'rich')).toEqual(await canon(page, String(before.blocks[0].data.text), 'rich'));
    });
    test('cut whole paragraph text with Cmd+A, paste back into the now-empty block', async ({ page }) => {
      await page.context().grantPermissions([ 'clipboard-read', 'clipboard-write' ]);
      await make(page, { blocks: [ p('src', RICH), p('other', 'Other') ], src: { id: 'src' }, sel: 'all', tgt: { id: 'src' }, at: 'end' });
      const before = await save(page);
      const el = editableOf(page, 'src');

      await placeCaret(el, 'start');
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('ControlOrMeta+x');
      const mid = await settle(page, JSON.stringify(before));

      await placeCaret(editableOf(page, 'src'), 'start');
      await page.keyboard.press('ControlOrMeta+v');
      const after = await settle(page, JSON.stringify(mid));

      expect.soft(structure(after)).toEqual(structure(before));
      expect.soft(await canon(page, String(after.blocks[0].data.text), 'rich')).toEqual(await canon(page, String(before.blocks[0].data.text), 'rich'));
    });
  });

  // ---------------------------------------------------------------- degraded clipboard
  test.describe('degraded clipboard: text/plain only', () => {
    test('plain: marked range -> mid paragraph', async ({ page }) => {
      await run(page, { clip: 'plain', blocks: [ p('src', RICH), TARGET() ], src: { id: 'src' }, sel: { from: 'pha', to: 'om' }, tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('plain: whole header -> empty paragraph', async ({ page }) => {
      await run(page, { clip: 'plain', blocks: [ { id: 'src', type: 'header', data: { text: 'Head <b>B</b> text', level: 2 } }, EMPTY() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: 'start' });
    });
    test('plain: soft line break -> mid paragraph', async ({ page }) => {
      await run(page, { allowSplit: true, clip: 'plain', blocks: [ p('src', 'one two<br>three four'), TARGET() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('plain: code multi-line -> mid paragraph', async ({ page }) => {
      await run(page, { allowSplit: true, clip: 'plain', blocks: [ { id: 'src', type: 'code', data: { code: 'const a = 1;\nconst b = 2;', language: 'javascript' } }, TARGET() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('plain: markdown-looking text -> mid paragraph', async ({ page }) => {
      test.fixme(true, 'text-inline-degraded-plain-markdown: plain text alone is read as Markdown by design');
      await run(page, { clip: 'plain', blocks: [ p('src', '# not a heading **not bold**'), TARGET() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('plain: markdown-looking text -> empty paragraph', async ({ page }) => {
      test.fixme(true, 'text-inline-degraded-plain-markdown: plain text alone is read as Markdown by design');
      await run(page, { clip: 'plain', blocks: [ p('src', '# not a heading **not bold**'), EMPTY() ], src: { id: 'src' }, sel: 'all', tgt: { id: 'tgt' }, at: 'start' });
    });
    test('plain: leading/trailing spaces + nbsp', async ({ page }) => {
      test.fixme(true, 'text-inline-degraded-plain: a space at the selection edge comes back as an nbsp after a plain-only paste; not traced');
      await run(page, { clip: 'plain', blocks: [ p('src', 'aa b&nbsp;b cc'), TARGET() ], src: { id: 'src' }, sel: { from: ' b', to: 'b ' }, tgt: { id: 'tgt' }, at: { before: 'text here' } });
    });
    test('plain: emoji -> table cell', async ({ page }) => {
      await run(page, { clip: 'plain', blocks: [ p('src', 'a 👍🏽 👨‍👩‍👧 z'), { id: 'tb', type: 'table', data: { withHeadings: false, content: [ [ 'Cell one', 'Other' ] ] } } ], src: { id: 'src' }, sel: 'all', tgt: { cell: 'Cell one' }, at: { before: 'one' } });
    });
  });
});

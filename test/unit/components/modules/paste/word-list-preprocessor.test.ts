/**
 * Word writes a list as <p style="mso-list:lN levelM lfoK"> paragraphs whose
 * bullet or number is a leading <span style="mso-list:Ignore"> run.
 * No real Word capture is in the repo: these fixtures follow Word's
 * documented clipboard shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { List } from '../../../../../src/tools';
import type { OutputData } from '../../../../../types';
import { preprocessWordLists } from '../../../../../src/components/modules/paste/word-list-preprocessor';
import { parseUntrustedHtml } from '../../../../../src/components/utils/inert-html';

const item = (text: string, level = 1, glyph = '·', list = 0): string =>
  `<p class=MsoListParagraphCxSpMiddle style='margin-left:.5in;text-indent:-.25in;mso-list:l${list} level${level} lfo1'>`
  + "<![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>"
  + `${glyph}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>`
  + `${text}<o:p></o:p></p>`;

const run = (html: string): HTMLElement => parseUntrustedHtml(preprocessWordLists(html));

// Not querySelector('p'): jsdom's selector engine also matches Word's <o:p>.
const paragraphs = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>('*')).filter(el => el.tagName === 'P');

/** Each li as "TAG depth text", depth counted from list ancestors. */
const outline = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('li')).map(li => {
    let depth = 0;

    for (let el = li.parentElement; el !== null && el !== root; el = el.parentElement) {
      depth += el.tagName === 'UL' || el.tagName === 'OL' ? 1 : 0;
    }

    const own = li.cloneNode(true) as HTMLElement;

    own.querySelectorAll('ul, ol').forEach(nested => nested.remove());

    return `${li.parentElement?.tagName} ${depth} ${(own.textContent ?? '').trim()}`;
  });

describe('preprocessWordLists', () => {
  it('turns consecutive bullet paragraphs into one <ul> without the glyph', () => {
    const root = run(`<div>${item('First')}${item('Second')}</div>`);

    expect(outline(root)).toStrictEqual(['UL 1 First', 'UL 1 Second']);
    expect(root.textContent).not.toContain('·');
    expect(paragraphs(root)).toStrictEqual([]);
  });

  it('reads a numbered glyph as an ordered list', () => {
    expect(outline(run(`${item('One', 1, '1.')}${item('Two', 1, '2.')}`))).toStrictEqual(['OL 1 One', 'OL 1 Two']);
  });

  it('nests by level inside the previous item', () => {
    const root = run(`${item('A')}${item('A1', 2, 'o')}${item('A1a', 3, '§')}${item('B')}`);

    expect(outline(root)).toStrictEqual(['UL 1 A', 'UL 2 A1', 'UL 3 A1a', 'UL 1 B']);
  });

  it('starts a new list when the list id changes or a paragraph breaks the run', () => {
    const root = run(`${item('A')}<p>gap</p>${item('B')}${item('C', 1, '1.', 1)}`);

    expect(root.querySelectorAll('ul, ol').length).toBe(3);
    expect(paragraphs(root).map(p => p.textContent)).toStrictEqual(['gap']);
  });

  it('works on a cell inside a table', () => {
    const root = run(`<table><tr><td>${item('First')}${item('Second')}</td></tr></table>`);

    expect(outline(root.querySelector('td') ?? root)).toStrictEqual(['UL 1 First', 'UL 1 Second']);
  });

  it('keeps a numbered heading a heading and drops its number', () => {
    const root = run("<h1 style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>1.<span>&nbsp; </span></span>Title</h1>");

    expect(root.querySelector('ul, ol')).toBeNull();
    expect(root.querySelector('h1')?.textContent).toBe('Title');
  });

  it('does not wrap an item that is already in a list', () => {
    const root = run("<ul><li style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>·<span>&nbsp; </span></span>A</li></ul>");

    expect(outline(root)).toStrictEqual(['UL 1 A']);
    expect(root.textContent).toBe('A');
  });

  it('returns the input untouched without mso-list', () => {
    const html = '<p class=MsoNormal>Plain</p>';

    expect(preprocessWordLists(html)).toBe(html);
  });
});

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

describe('word list paste at top level', () => {
  let holder: HTMLDivElement;
  let blok: TestEditor | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('becomes nested list blocks without the glyph', async () => {
    const settle = (ms = 0): Promise<void> => new Promise(resolve => {
      setTimeout(resolve, ms);
    });

    const editor = new Blok({ holder, tools: { paragraph: Paragraph, list: List }, data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: '' } }] } }) as unknown as TestEditor;

    blok = editor;
    await editor.isReady;

    const target = holder.querySelector<HTMLElement>('[data-blok-id="p1"] [data-blok-element-content] > *');

    if (target === null) {
      throw new Error('no paragraph');
    }

    const html = '<html><head><meta name=ProgId content=Word.Document></head><body><!--StartFragment-->'
      + `${item('First')}${item('Inner', 2, 'o')}${item('Second')}<!--EndFragment--></body></html>`;
    const event = new Event('paste', { bubbles: true, cancelable: true });

    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string): string => ({ 'text/html': html, 'text/plain': 'First\nInner\nSecond' })[type] ?? '', types: ['text/html', 'text/plain'] },
    });
    target.focus();
    target.dispatchEvent(event);

    const textBlocks = (saved: OutputData): unknown[][] => saved.blocks
      .filter(block => typeof block.data.text === 'string' && block.data.text !== '')
      .map(block => [block.type, String(block.data.text).trim(), block.data.depth ?? 0]);
    let lists = textBlocks(await editor.save());

    // The list items are inserted over several ticks.
    for (let i = 0; i < 40 && lists.length < 3; i++) {
      await settle(25);
      lists = textBlocks(await editor.save());
    }

    expect(lists).toStrictEqual([['list', 'First', 0], ['list', 'Inner', 1], ['list', 'Second', 0]]);
  });
});

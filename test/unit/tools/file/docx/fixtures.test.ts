import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderDocxInto } from '../../../../../src/tools/file/docx';

// Expected values come from the docx-preview baseline (same fixtures), adjusted
// only by the agreed differences: visible PUA bullets, note numbers running
// through the document, OMML as plain text.
const REPO = resolve(__dirname, '../../../../..');

async function renderFile(path: string): Promise<HTMLElement> {
  const bytes = readFileSync(path);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const container = document.createElement('div');
  document.body.appendChild(container);
  await renderDocxInto(buf, container);

  return container;
}

const upstream = (name: string): Promise<HTMLElement> => renderFile(resolve(__dirname, 'fixtures/upstream', `${name}.docx`));

const norm = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

/** Paragraph text without its list marker. */
function paraText(para: Element): string {
  const copy = para.cloneNode(true);
  if (copy instanceof Element) {
    copy.querySelectorAll('.blok-docx-marker').forEach((marker) => marker.remove());
  }

  return norm(copy.textContent);
}

const pages = (c: HTMLElement): HTMLElement[] => Array.from(c.querySelectorAll<HTMLElement>('.blok-docx-wrapper > section'));

/** Body paragraphs outside tables and note lists, as the baseline extractor walked them. */
const bodyParas = (c: HTMLElement): Element[] =>
  Array.from(c.querySelectorAll('article p')).filter((para) => para.closest('td, ol') === null);

const texts = (c: HTMLElement): string[] => bodyParas(c).map(paraText).filter((text) => text !== '');

const markerOf = (para: Element): string => norm(para.querySelector('.blok-docx-marker')?.textContent);

/** Marker of every non-empty body paragraph, '' where there is none. */
const markers = (c: HTMLElement): string[] =>
  bodyParas(c).filter((para) => paraText(para) !== '').map(markerOf);

const textsOf = (c: HTMLElement, selector: string): string[] =>
  Array.from(c.querySelectorAll(selector)).map((el) => norm(el.textContent));

const cellText = (td: Element): string => Array.from(td.querySelectorAll('p')).map(paraText).filter((t) => t !== '').join(' ');

const tableShape = (table: Element): Array<Array<[string, number, number]>> =>
  Array.from(table.querySelectorAll(':scope > tbody > tr')).map((tr) =>
    Array.from(tr.querySelectorAll<HTMLTableCellElement>(':scope > td')).map((td) => [cellText(td), td.colSpan, td.rowSpan]));

const paraWith = (c: HTMLElement, text: string): Element => {
  const found = bodyParas(c).find((para) => paraText(para) === text);
  if (found === undefined) {
    throw new Error(`no paragraph "${text}"`);
  }

  return found;
};

/** An inline style value on the first text's element or its ancestors inside the paragraph. */
function styleAt(para: Element, prop: string): string {
  const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  const start = first?.parentElement ?? null;
  const chain: HTMLElement[] = [];
  for (const el = { at: start }; el.at !== null && para.contains(el.at); el.at = el.at.parentElement) {
    chain.push(el.at);
  }

  return chain.map((el) => el.style.getPropertyValue(prop)).find((value) => value !== '') ?? '';
}

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';
const UNDERLINED = 'Lorem ipsum dolor sit amet consectetur adipiscing elit';
const ONE_TWO_THREE = ['one', 'two', 'three'];

describe('docx fixtures (upstream docxjs render tests)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('text: paragraphs, colour and alignment', async () => {
    const c = await upstream('text');

    expect(pages(c)).toHaveLength(1);
    expect(texts(c)).toEqual(['Test', 'Test color', 'Tab text', 'Text center', 'Text right', 'text text text']);
    expect(styleAt(paraWith(c, 'Test color'), 'color')).toBe('rgb(196, 89, 17)');
    expect(styleAt(paraWith(c, 'Test'), 'font-family')).toMatch(/^"?Calibri\b/);
    expect(paraWith(c, 'Text center').getAttribute('style')).toContain('text-align: center');
    expect(paraWith(c, 'Text right').getAttribute('style')).toMatch(/text-align: (right|end)/);
    expect(paraWith(c, 'Tab text').textContent).toContain('\t');
  });

  it('underlines: every paragraph underlined, with the right line styles', async () => {
    const c = await upstream('underlines');
    const paras = bodyParas(c).filter((para) => paraText(para) !== '');

    expect(paras.map(paraText)).toEqual(['Underlines', ...Array.from({ length: 10 }, () => UNDERLINED)]);
    expect(paras.map((para) => styleAt(para, 'text-decoration-line'))).toEqual(Array.from({ length: 11 }, () => 'underline'));
    expect(paras.map((para) => styleAt(para, 'text-decoration-style') || 'solid')).toEqual([
      'solid', 'solid', 'double', 'solid', 'dotted', 'dashed', 'dashed', 'dashed', 'wavy', 'wavy', 'wavy',
    ]);
    expect(styleAt(paras[2], 'text-decoration-color')).toBe('rgb(68, 114, 196)');
    expect(styleAt(paras[4], 'text-decoration-color')).toBe('rgb(112, 173, 71)');
  });

  it('text-break: one long paragraph', async () => {
    const c = await upstream('text-break');

    expect(pages(c)).toHaveLength(1);
    expect(texts(c)).toEqual([LOREM]);
  });

  it('line-spacing: four paragraphs with their own line heights', async () => {
    const c = await upstream('line-spacing');
    const paras = bodyParas(c).filter((para) => paraText(para) !== '');

    expect(pages(c)).toHaveLength(1);
    expect(paras.map(paraText)).toEqual([LOREM, LOREM, LOREM, LOREM]);
    expect(new Set(paras.map((para) => para.getAttribute('style')?.match(/line-height: [^;]+/)?.[0])).size).toBeGreaterThan(1);
  });

  it('page-break-before: three pages, two paragraphs each', async () => {
    const c = await upstream('page-break-before');

    expect(pages(c).map((page) => texts(page))).toEqual([
      ['Section 1', 'Body of section 1.'],
      ['Section 2', 'Body of section 2.'],
      ['Section 3', 'Body of section 3.'],
    ]);
  });

  it('page-layout: a portrait page then a landscape page, capped to the container', async () => {
    const c = await upstream('page-layout');
    const [portrait, landscape] = pages(c);

    expect(pages(c).map((page) => texts(page))).toEqual([['page1'], ['page2']]);
    expect(parseFloat(portrait.style.width)).toBeLessThan(parseFloat(landscape.style.width));
  });

  it('header-footer: first, even and odd headers and footers', async () => {
    const c = await upstream('header-footer');

    expect(pages(c)).toHaveLength(3);
    expect(texts(c)).toEqual(['Content']);
    expect(textsOf(c, 'section > header')).toEqual(['First HeaderThat bigger than top marginHeader end', 'Even Header', 'Odd Header']);
    expect(pages(c).map((page) => Array.from(page.querySelectorAll('header p')).map(paraText).filter((t) => t !== ''))[0])
      .toEqual(['First Header', 'That bigger than top margin', 'Header end']);
    expect(textsOf(c, 'section > footer')).toEqual(['First Footer', 'Even Footer', 'Odd Footer']);
  });

  it('header-footer-even-odd-off: the default header on every page, no even header', async () => {
    const c = await upstream('header-footer-even-odd-off');

    expect(pages(c).map((page) => texts(page))).toEqual([['Page one'], ['Page two'], ['Page three']]);
    expect(textsOf(c, 'section > header')).toEqual(['Default header', 'Default header', 'Default header']);
    expect(c.textContent).not.toContain('Even header');
  });

  it('footnote: numbers run through the document, one list per page', async () => {
    const c = await upstream('footnote');

    expect(pages(c).map((page) => texts(page))).toEqual([['1content'], ['content22']]);
    expect(textsOf(c, '.blok-docx-noteref')).toEqual(['1', '2']);
    expect(pages(c).map((page) => textsOf(page, 'ol.blok-docx-footnotes > li'))).toEqual([['1 footnote'], ['2 footnote2']]);
  });

  // The run already has vertical-align: super, so the mark must not raise itself again.
  it('footnote: the note reference is raised once', async () => {
    const c = await upstream('footnote');
    const ref = c.querySelector('.blok-docx-noteref');
    const raises = (el: Element | null): number => {
      if (!(el instanceof HTMLElement) || el.tagName === 'P') {
        return 0;
      }
      const own = el.tagName === 'SUP' || el.style.verticalAlign === 'super' ? 1 : 0;

      return own + raises(el.parentElement);
    };

    expect(ref).not.toBeNull();
    expect(raises(ref)).toBe(1);
  });

  it('revision: inserted text shows, deleted text does not', async () => {
    const c = await upstream('revision');

    expect(texts(c)).toEqual(['Original text insered']);
    expect(c.textContent).not.toContain('deleted');
  });

  it('equation: plain text in content order, with sub- and superscripts', async () => {
    const c = await upstream('equation');
    const text = (c.querySelector('article')?.textContent ?? '').replace(/\s+/g, '');

    expect(pages(c)).toHaveLength(1);
    for (const piece of ['1÷2=x', '3+4=y', '5*6=z', '=w', 'e-iωt', 'tanθ=sinθ', 'cosθ', 'x⊕y', 'limn→∞', 'max0≤x≤1', 'yields', '20⋯30']) {
      expect(text).toContain(piece);
    }
    expect(text.indexOf('1÷2=x')).toBeLessThan(text.indexOf('tanθ'));
    expect(text.indexOf('tanθ')).toBeLessThan(text.indexOf('yields'));
    expect(textsOf(c, 'article sup')).toEqual(expect.arrayContaining(['-iωt', '2']));
    expect(c.querySelectorAll('article sub').length).toBeGreaterThan(0);
  });

  // n-ary operators, delimiters and radicals come from OMML properties (m:chr, m:begChr…) or are implied.
  it('equation: operator and bracket characters show', async () => {
    const c = await upstream('equation');
    const text = c.querySelector('article')?.textContent ?? '';

    expect(['∫', '∬', '∭', '∑', '∏', '⋃', '⟨', '⟩', '('].filter((ch) => !text.includes(ch))).toEqual([]);
  });

  it('table: two rows of three cells', async () => {
    const c = await upstream('table');
    const tables = c.querySelectorAll('article table');

    expect(tables).toHaveLength(1);
    expect(tableShape(tables[0])).toEqual([
      [['Test', 1, 1], ['Test', 1, 1], ['Test', 1, 1]],
      [['Test', 1, 1], ['Test', 1, 1], ['Test', 1, 1]],
    ]);
  });

  it('table-spans: merged cells keep their spans, with no hidden cells', async () => {
    const c = await upstream('table-spans');
    const table = c.querySelector('article table');

    expect(table).not.toBeNull();
    expect(tableShape(table ?? document.createElement('table'))).toEqual([
      [['Test Test Test Test Test Test Test', 1, 6], ['Test Test', 1, 2], ['Test Test', 1, 2], ['Test Test', 1, 2], ['Test Test', 2, 1]],
      [['Test', 1, 1], ['Test', 1, 1]],
      [['Test', 1, 1], ['Test', 1, 1], ['Test', 1, 1], ['Test', 1, 1], ['Test', 1, 1]],
      [['Test Test Test Test Test', 5, 1]],
      [['Test Test Test Test', 2, 1], ['Test Test Test Test Test Test Test Test Test', 3, 2]],
      [['Test', 1, 1], ['Test', 1, 1]],
    ]);
  });

  it('numbering: bullets, number formats, nested levels and suffixes', async () => {
    const c = await upstream('numbering');
    const list = [...ONE_TWO_THREE];

    expect(pages(c)).toHaveLength(4);
    expect(texts(c)).toEqual([
      'Bullets', ...Array.from({ length: 8 }, () => list).flat(),
      'Numbers', ...Array.from({ length: 8 }, () => list).flat(),
      'Nested numbering', 'one', 'two', 'three', 'four', 'five', 'one', 'two', 'three', 'four', 'five',
      'Suff', ...Array.from({ length: 3 }, () => list).flat(),
    ]);
    const all = markers(c);
    const three = (marker: string): string[] => [marker, marker, marker];

    expect(all.slice(25)).toEqual([
      '',
      '1)', '2)', '3)', '1.', '2.', '3.', '(1.', '(2.', '(3.', 'I.', 'II.', 'III.', 'i.', 'ii.', 'iii.',
      'A)', 'B)', 'C)', 'a)', 'b)', 'c)', '(a)', '(b)', '(c)',
      '', '1.', '2.', '3.', '1.', '2.', '1.', '2.', '3.', '3.1.', '3.2.',
      '', '1.', '2.', '3.', '1.', '2.', '3.', '1.', '2.', '3.',
    ]);
    // Symbol/Wingdings private-use bullets draw as real glyphs.
    expect([...all.slice(1, 7), ...all.slice(10, 13), ...all.slice(16, 19), ...all.slice(22, 25)]).toEqual([
      ...three('•'), ...three('●'), ...three('■'), ...three('➢'), ...three('✓'),
    ]);
    const others = [...all.slice(7, 10), ...all.slice(13, 16), ...all.slice(19, 22)];

    expect(others.every((marker) => marker.length === 1 && !/[-]/.test(marker))).toBe(true);
  });

  it('extended-props: headings, formatting, lists, table, image and footers', async () => {
    const c = await upstream('extended-props');

    expect(pages(c)).toHaveLength(3);
    expect(texts(c)).toEqual([
      'Heading 1', 'Heading 2', 'Heading 3', 'Bold Text', 'Bold Italic Text', 'Italic Text', 'Underline Text',
      'Align Left', 'Align Center', 'Align Right',
      'Numbered list item 1', 'Sub item A', 'Sub item B', 'Sub sub item i', 'Sub sub item ii', 'Numbered list item 2',
      'Bulleted list item 1', 'Sub bulleted list item 1', 'Sub bulleted list item 2', 'Bulleted list item 2',
      'Red Text', 'Red Highlighted Text', 'Chart Below', 'Image Below',
    ]);
    expect(markers(c).slice(10, 20)).toEqual(['1.', 'a.', 'b.', 'i.', 'ii.', '2.', '•', 'o', 'o', '•']);
    expect(styleAt(paraWith(c, 'Heading 1'), 'color')).toBe('rgb(47, 84, 150)');
    expect(styleAt(paraWith(c, 'Heading 1'), 'font-size')).toBe('16pt');
    expect(['bold', '700']).toContain(styleAt(paraWith(c, 'Bold Text'), 'font-weight'));
    expect(styleAt(paraWith(c, 'Bold Italic Text'), 'font-style')).toBe('italic');
    expect(styleAt(paraWith(c, 'Italic Text'), 'font-style')).toBe('italic');
    expect(styleAt(paraWith(c, 'Underline Text'), 'text-decoration-line')).toBe('underline');
    expect(styleAt(paraWith(c, 'Red Text'), 'color')).toBe('rgb(255, 0, 0)');
    expect(styleAt(paraWith(c, 'Red Highlighted Text'), 'background-color')).toBe('rgb(255, 255, 0)');
    expect(paraWith(c, 'Align Center').getAttribute('style')).toContain('text-align: center');

    const table = c.querySelector('article table');

    expect(tableShape(table ?? document.createElement('table'))).toEqual([
      [['Table Header 1', 1, 1], ['Table Header 2', 1, 1], ['Table Header 3', 1, 1]],
      [['Row of data', 1, 1], ['Row of data', 1, 1], ['Row of data', 1, 1]],
    ]);
    const images = Array.from(pages(c)[2].querySelectorAll<HTMLImageElement>('article img'));

    expect(images).toHaveLength(1);
    expect(Math.abs(images[0].width - 649.7)).toBeLessThan(1);
    // The PAGE field keeps its cached result.
    expect(textsOf(c, 'section > footer')).toEqual(['2', '2', '2']);
  });
});

describe('docx fixtures (Blok samples)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('e2e sample.docx: one paragraph', async () => {
    const c = await renderFile(resolve(REPO, 'test/playwright/fixtures/office/sample.docx'));

    expect(pages(c)).toHaveLength(1);
    expect(texts(c)).toEqual(['Blok docx preview fixture']);
  });

  it('playground service-agreement.docx: title, clauses and bold headings', async () => {
    const c = await renderFile(resolve(REPO, 'public/samples/service-agreement.docx'));

    expect(pages(c)).toHaveLength(1);
    expect(texts(c)).toEqual([
      'Service Agreement',
      'This Service Agreement ("Agreement") is entered into as of June 16, 2026, by and between Blok Software Inc. ("Provider") and the undersigned client ("Client").',
      '1. Scope of Services',
      'Provider shall deliver and maintain the Blok block-based editor, including hosting, support, and periodic feature updates, for the duration of this Agreement.',
      '2. Term',
      'This Agreement commences on the effective date above and continues for an initial term of twelve (12) months, renewing automatically unless either party provides thirty (30) days written notice.',
      '3. Fees',
      'Client agrees to pay the monthly subscription fee set out in the order form. Fees are due within fifteen (15) days of each invoice date.',
      '4. Confidentiality',
      'Each party shall protect the other party’s confidential information with the same degree of care it uses for its own, and no less than reasonable care.',
    ]);
    for (const heading of ['1. Scope of Services', '2. Term', '3. Fees', '4. Confidentiality']) {
      expect(['bold', '700']).toContain(styleAt(paraWith(c, heading), 'font-weight'));
    }
  });
});

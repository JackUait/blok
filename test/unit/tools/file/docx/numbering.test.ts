import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderDocxInto } from '../../../../../src/tools/file/docx';
import { buildDocx, p } from './build-docx';

async function renderBuffer(buf: ArrayBuffer): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await renderDocxInto(buf, container);

  return container;
}

const render = async (parts: Parameters<typeof buildDocx>[0]): Promise<HTMLElement> => renderBuffer(await buildDocx(parts));

const markerOf = (para: Element): HTMLElement | null => para.querySelector<HTMLElement>('.blok-docx-marker');

/** Marker text of every paragraph, suffix space trimmed; null where there is no marker. */
const markers = (c: HTMLElement): Array<string | null> =>
  Array.from(c.querySelectorAll('article p')).map((para) => markerOf(para)?.textContent?.replace(/[ \t]$/, '') ?? null);

const lvl = (ilvl: number, inner: string): string => `<w:lvl w:ilvl="${ilvl}">${inner}</w:lvl>`;
const abstract = (id: number, levels: string): string => `<w:abstractNum w:abstractNumId="${id}">${levels}</w:abstractNum>`;
const num = (numId: number, abstractId: number, overrides = ''): string =>
  `<w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractId}"/>${overrides}</w:num>`;
const item = (text: string, numId: number, ilvl = 0): string =>
  p(text, `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`);
const level = (ilvl: number, fmt: string, text: string, extra = ''): string =>
  lvl(ilvl, `<w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/>${extra}`);

describe('docx numbering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('counts a decimal list and shows the level text around the number', async () => {
    const c = await render({
      numbering: abstract(1, level(0, 'decimal', '%1)')) + num(5, 1),
      body: item('a', 5) + item('b', 5) + item('c', 5),
    });

    expect(markers(c)).toEqual(['1)', '2)', '3)']);
  });

  it('starts at w:start, and at 0 when w:start is absent (ECMA-376 §17.9.25)', async () => {
    const c = await render({
      numbering: abstract(1, lvl(0, '<w:start w:val="2"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1"/>'))
        + abstract(2, lvl(0, '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>'))
        + num(1, 1) + num(2, 2),
      body: item('a', 1) + item('b', 1) + item('c', 2) + item('d', 2),
    });

    expect(markers(c)).toEqual(['B', 'C', '0.', '1.']);
  });

  it('formats letters and roman numerals at 0 as decimal instead of failing', async () => {
    const c = await render({
      numbering: abstract(1, lvl(0, '<w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1"/>'))
        + abstract(2, lvl(0, '<w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1"/>'))
        + num(1, 1) + num(2, 2),
      body: item('a', 1) + item('b', 2),
    });

    expect(markers(c)).toEqual(['0', '0']);
  });

  it('repeats the letter past z: y, z, aa, bb (ECMA-376 §17.18.59)', async () => {
    const c = await render({
      numbering: abstract(1, lvl(0, '<w:start w:val="25"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1"/>'))
        + abstract(2, lvl(0, '<w:start w:val="52"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1"/>'))
        + num(1, 1) + num(2, 2),
      body: item('a', 1) + item('b', 1) + item('c', 1) + item('d', 1) + item('e', 2) + item('f', 2),
    });

    expect(markers(c)).toEqual(['y', 'z', 'aa', 'bb', 'ZZ', 'AAA']);
  });

  it('formats roman numerals and zero-padded decimals', async () => {
    const c = await render({
      numbering: abstract(1, lvl(0, '<w:start w:val="1999"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1"/>'))
        + abstract(2, lvl(0, '<w:start w:val="4"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%1"/>'))
        + abstract(3, lvl(0, '<w:start w:val="9"/><w:numFmt w:val="decimalZero"/><w:lvlText w:val="%1"/>'))
        + num(1, 1) + num(2, 2) + num(3, 3),
      body: item('a', 1) + item('b', 2) + item('c', 2) + item('d', 3) + item('e', 3),
    });

    expect(markers(c)).toEqual(['MCMXCIX', 'iv', 'v', '09', '10']);
  });

  it('falls back to decimal for ordinal, text and unknown formats', async () => {
    const c = await render({
      numbering: abstract(1, level(0, 'ordinal', '%1'))
        + abstract(2, level(0, 'cardinalText', '%1'))
        + abstract(3, level(0, 'ordinalText', '%1'))
        + abstract(4, level(0, 'klingon', '%1'))
        + num(1, 1) + num(2, 2) + num(3, 3) + num(4, 4),
      body: item('a', 1) + item('b', 2) + item('c', 3) + item('d', 4),
    });

    expect(markers(c)).toEqual(['1', '1', '1', '1']);
  });

  it('renders each placeholder in its own level format', async () => {
    const c = await render({
      numbering: abstract(1, level(0, 'upperRoman', '%1.') + level(1, 'lowerLetter', '%1.%2')) + num(1, 1),
      body: item('a', 1) + item('b', 1, 1) + item('c', 1, 1),
    });

    expect(markers(c)).toEqual(['I.', 'I.a', 'I.b']);
  });

  it('renders every placeholder as decimal on an isLgl level', async () => {
    const c = await render({
      numbering: abstract(1, level(0, 'upperRoman', '%1.') + level(1, 'lowerLetter', '%1.%2', '<w:isLgl/>')) + num(1, 1),
      body: item('a', 1) + item('b', 1, 1),
    });

    expect(markers(c)).toEqual(['I.', '1.1']);
  });

  it('shows an unused higher level at its start value', async () => {
    const c = await render({
      numbering: abstract(1, level(0, 'decimal', '%1.') + level(1, 'decimal', '%1.%2')) + num(1, 1),
      body: item('a', 1, 1),
    });

    expect(markers(c)).toEqual(['1.1']);
  });

  it('restarts deeper levels as lvlRestart says (ECMA-376 §17.9.11 example)', async () => {
    const c = await render({
      numbering: abstract(1, level(0, 'decimal', '%1)') + level(1, 'upperLetter', '%2)')
        + level(2, 'lowerRoman', '%3)', '<w:lvlRestart w:val="0"/>')) + num(1, 1),
      body: item('a', 1) + item('b', 1, 1) + item('c', 1, 2) + item('d', 1, 2)
        + item('e', 1) + item('f', 1, 1) + item('g', 1, 2) + item('h', 1, 2),
    });

    expect(markers(c)).toEqual(['1)', 'A)', 'i)', 'ii)', '2)', 'A)', 'iii)', 'iv)']);
  });

  it('restarts a level with lvlRestart 1 only when level 0 is used', async () => {
    const c = await render({
      numbering: abstract(1, level(0, 'decimal', '%1.') + level(1, 'decimal', '%2.')
        + level(2, 'decimal', '%3)', '<w:lvlRestart w:val="1"/>')) + num(1, 1),
      body: item('a', 1) + item('b', 1, 2) + item('c', 1, 1) + item('d', 1, 2) + item('e', 1) + item('f', 1, 2),
    });

    expect(markers(c)).toEqual(['1.', '1)', '1.', '2)', '2.', '1)']);
  });

  it('keeps a separate counter per w:num, and startOverride restarts it', async () => {
    const c = await render({
      numbering: abstract(1, level(0, 'decimal', '%1.'))
        + num(1, 1) + num(2, 1, '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride>'),
      body: item('a', 1) + item('b', 1) + item('c', 2) + item('d', 2) + item('e', 1),
    });

    expect(markers(c)).toEqual(['1.', '2.', '5.', '6.', '3.']);
  });

  it('replaces a level with a full w:lvl override', async () => {
    const c = await render({
      numbering: abstract(1, level(0, 'decimal', '%1.'))
        + num(1, 1, `<w:lvlOverride w:ilvl="0">${level(0, 'lowerLetter', '(%1)')}</w:lvlOverride>`),
      body: item('a', 1) + item('b', 1),
    });

    expect(markers(c)).toEqual(['(a)', '(b)']);
  });

  it('follows numStyleLink to the abstractNum behind the linked numbering style', async () => {
    const c = await render({
      styles: '<w:style w:type="numbering" w:styleId="Outline"><w:name w:val="Outline"/><w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr></w:style>',
      numbering: abstract(1, '<w:styleLink w:val="Outline"/>' + level(0, 'upperLetter', '%1.'))
        + abstract(2, '<w:numStyleLink w:val="Outline"/>')
        + num(7, 1) + num(8, 2),
      body: item('a', 8) + item('b', 8),
    });

    expect(markers(c)).toEqual(['A.', 'B.']);
  });

  it('stops on a numStyleLink cycle without a marker', async () => {
    const c = await render({
      styles: '<w:style w:type="numbering" w:styleId="Loop"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>',
      numbering: abstract(1, '<w:numStyleLink w:val="Loop"/>') + num(1, 1),
      body: item('a', 1),
    });

    expect(markers(c)).toEqual([null]);
    expect(c.textContent).toBe('a');
  });

  it('gives no marker without a numbering part, for an unknown numId, or for a missing level', async () => {
    const none = await render({ body: item('a', 1) });
    expect(markers(none)).toEqual([null]);

    const c = await render({
      numbering: abstract(1, level(0, 'decimal', '%1.')) + num(1, 1) + num(2, 99),
      body: item('a', 3) + item('b', 1, 4) + item('c', 2),
    });
    expect(markers(c)).toEqual([null, null, null]);
  });

  it('gives an empty marker for a bullet with no level text and for numFmt none', async () => {
    const c = await render({
      numbering: abstract(1, lvl(0, '<w:numFmt w:val="bullet"/>')) + abstract(2, level(0, 'none', '%1')) + num(1, 1) + num(2, 2),
      body: item('a', 1) + item('b', 2),
    });

    expect(markers(c)).toEqual(['', '']);
  });

  it('maps Symbol and Wingdings private-use bullets to visible glyphs and drops the symbol font', async () => {
    const c = await render({
      numbering: abstract(1, level(0, 'bullet', '', '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/><w:color w:val="FF0000"/></w:rPr>'))
        + abstract(2, level(0, 'bullet', 'o', '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr>'))
        + num(1, 1) + num(2, 2),
      body: item('a', 1) + item('b', 2),
    });
    const [first, second] = Array.from(c.querySelectorAll('article p')).map((para) => markerOf(para));

    expect(markers(c)).toEqual(['•', 'o']);
    expect(first?.style.fontFamily).not.toContain('Symbol');
    expect(first?.style.color).toBe('rgb(255, 0, 0)');
    expect(second?.style.fontFamily).toContain('Courier New');
  });

  it('uses the level indents and suffix', async () => {
    const ind = '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>';
    const c = await render({
      numbering: abstract(1, level(0, 'decimal', '%1.', ind))
        + abstract(2, level(0, 'decimal', '%1.', `<w:suff w:val="space"/>${ind}`))
        + abstract(3, level(0, 'decimal', '%1.', `<w:suff w:val="nothing"/>${ind}`))
        + num(1, 1) + num(2, 2) + num(3, 3),
      body: item('a', 1) + item('b', 2) + item('c', 3),
    });
    const paras = Array.from(c.querySelectorAll<HTMLElement>('article p'));
    const spans = paras.map((para) => markerOf(para));

    expect(paras[0].style.marginInlineStart).toBe('36pt');
    expect(paras[0].style.textIndent).toBe('-18pt');
    expect(spans[0]?.style.display).toBe('inline-block');
    expect(spans[0]?.textContent).toBe('1.');
    expect(spans[1]?.textContent).toBe('1. ');
    expect(spans[2]?.textContent).toBe('1.');
    expect(spans[2]?.style.display).toBe('');
  });

  it('lets direct paragraph indents win over the level indents', async () => {
    const c = await render({
      numbering: abstract(1, level(0, 'decimal', '%1.', '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>')) + num(1, 1),
      body: p('a', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind w:left="1440"/>'),
    });

    expect(c.querySelector<HTMLElement>('article p')?.style.marginInlineStart).toBe('72pt');
  });

  /*
   * The upstream docxjs `numbering` fixture. Expected texts come from the old
   * renderer's baseline. Intended differences: the old one drew U+F0xx bullets
   * as empty boxes, we draw real glyphs; its tab and space suffixes were
   * `\t` and `\xa0` inside the marker, ours is an inline-block / plain space.
   */
  it('matches the upstream numbering fixture', async () => {
    const file = readFileSync(resolve(__dirname, 'fixtures/upstream/numbering.docx'));
    const c = await renderBuffer(Uint8Array.from(file).buffer);
    const got = markers(c).filter((m): m is string => m !== null);
    const three = (...texts: string[]): string[] => texts;
    const expected = [
      ...three('•', '•', '•'), ...three('●', '●', '●'), ...three('?', '?', '?'), ...three('■', '■', '■'),
      ...three('?', '?', '?'), ...three('➢', '➢', '➢'), ...three('?', '?', '?'), ...three('✓', '✓', '✓'),
      '1)', '2)', '3)', '1.', '2.', '3.', '(1.', '(2.', '(3.', 'I.', 'II.', 'III.',
      'i.', 'ii.', 'iii.', 'A)', 'B)', 'C)', 'a)', 'b)', 'c)', '(a)', '(b)', '(c)',
      '1.', '2.', '3.', '1.', '2.', '1.', '2.', '3.', '3.1.', '3.2.',
      '1.', '2.', '3.', '1.', '2.', '3.', '1.', '2.', '3.',
    ];

    expect(got).toHaveLength(67);
    // Wingdings F075, F0E8, F0FB have no glyph in inline.ts yet: only check they are visible.
    got.forEach((text, i) => {
      if (expected[i] === '?') {
        expect(text).toMatch(/^[^-]+$/u);
      } else {
        expect(text).toBe(expected[i]);
      }
    });
  });
});

describe('createNumbering — non-Latin formats', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('writes Chinese, Hebrew and Thai list numbers in their own scripts', async () => {
    const scriptLevel = (fmt: string): string => `<w:lvl w:ilvl="0"><w:start w:val="11"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="%1."/></w:lvl>`;
    const numbering = ['chineseCounting', 'hebrew1', 'thaiNumbers'].map((fmt, i) => `<w:abstractNum w:abstractNumId="${i}">${scriptLevel(fmt)}</w:abstractNum>`).join('')
      + [0, 1, 2].map((i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${i}"/></w:num>`).join('');
    const c = await render({ numbering, body: item('x', 1) + item('x', 2) + item('x', 3) });

    expect(markers(c)).toEqual(['十一.', 'יא.', '๑๑.']);
  });
});

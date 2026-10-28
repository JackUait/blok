import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderDocxInto } from '../../../../../src/tools/file/docx';
import { buildDocx, p } from './build-docx';

async function render(parts: Parameters<typeof buildDocx>[0]): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await renderDocxInto(await buildDocx(parts), container);

  return container;
}

const pages = (c: HTMLElement): HTMLElement[] => Array.from(c.querySelectorAll<HTMLElement>('.blok-docx-wrapper > section.blok-docx'));
const paras = (c: HTMLElement): HTMLParagraphElement[] => Array.from(c.querySelectorAll('article p'));
const run = (c: HTMLElement, text: string): HTMLElement => {
  const span = Array.from(c.querySelectorAll<HTMLElement>('article span')).find((el) => el.textContent === text);
  if (span === undefined) {
    throw new Error(`no run "${text}"`);
  }

  return span;
};

describe('renderDocxInto — document skeleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('renders the body text inside wrapper > page > article', async () => {
    const c = await render({ body: p('Hello') + p('World') });

    expect(pages(c)).toHaveLength(1);
    expect(paras(c).map((el) => el.textContent)).toEqual(['Hello', 'World']);
  });

  it('sizes the page from sectPr and caps it at the container width', async () => {
    const c = await render({
      body: `${p('x')}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="1440" w:bottom="720" w:left="1080"/></w:sectPr>`,
    });
    const page = pages(c)[0];

    expect(page.style.width).toBe('841.9pt');
    expect(page.style.paddingTop).toBe('36pt');
    expect(page.style.paddingInlineEnd).toBe('72pt');
    expect(page.style.paddingBottom).toBe('36pt');
    expect(page.style.paddingInlineStart).toBe('54pt');
  });

  it('uses US Letter with 1in margins when the document has no sectPr', async () => {
    const page = pages(await render({ body: p('x') }))[0];

    expect(page.style.width).toBe('612pt');
    expect(page.style.paddingTop).toBe('72pt');
  });

  it('keeps an empty paragraph one line tall', async () => {
    const c = await render({ body: '<w:p/>' });

    expect(paras(c)[0].querySelector('br')).not.toBeNull();
  });

  it('rejects a document part that declares a DOCTYPE', async () => {
    const container = document.createElement('div');
    const buf = await buildDocx({ body: '' });
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);
    zip.file('word/document.xml', '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY e "boom">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&e;</w:t></w:r></w:p></w:body></w:document>');

    await expect(renderDocxInto(await zip.generateAsync({ type: 'arraybuffer' }), container)).rejects.toThrow();
    expect(container.textContent).not.toContain('boom');
  });

  it('rejects a file that is not a docx package', async () => {
    const container = document.createElement('div');

    await expect(renderDocxInto(new TextEncoder().encode('not a zip').buffer, container)).rejects.toThrow();
  });
});

describe('renderDocxInto — runs', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('maps run properties to inline styles', async () => {
    const c = await render({
      body: [
        p('bold', '', '<w:b/>'),
        p('italic', '', '<w:i/>'),
        p('under', '', '<w:u w:val="double"/>'),
        p('strike', '', '<w:strike/>'),
        p('both', '', '<w:u w:val="single"/><w:strike/>'),
        p('red', '', '<w:color w:val="FF0000"/>'),
        p('auto', '', '<w:color w:val="auto"/>'),
        p('big', '', '<w:sz w:val="48"/>'),
        p('sup', '', '<w:vertAlign w:val="superscript"/>'),
        p('caps', '', '<w:caps/>'),
        p('marked', '', '<w:highlight w:val="yellow"/>'),
        p('shaded', '', '<w:shd w:val="clear" w:fill="00FF00"/>'),
        p('font', '', '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>'),
      ].join(''),
    });

    expect(run(c, 'bold').style.fontWeight).toBe('bold');
    expect(run(c, 'italic').style.fontStyle).toBe('italic');
    expect(run(c, 'under').style.textDecorationLine).toBe('underline');
    expect(run(c, 'under').style.textDecorationStyle).toBe('double');
    expect(run(c, 'strike').style.textDecorationLine).toBe('line-through');
    expect(run(c, 'both').style.textDecorationLine).toBe('underline line-through');
    expect(run(c, 'red').style.color).toBe('rgb(255, 0, 0)');
    expect(run(c, 'auto').style.color).toBe('');
    expect(run(c, 'big').style.fontSize).toBe('24pt');
    expect(run(c, 'sup').style.verticalAlign).toBe('super');
    expect(run(c, 'caps').style.textTransform).toBe('uppercase');
    expect(run(c, 'marked').style.backgroundColor).toBe('rgb(255, 255, 0)');
    expect(run(c, 'shaded').style.backgroundColor).toBe('rgb(0, 255, 0)');
    expect(run(c, 'font').style.fontFamily).toContain('Georgia');
  });

  it('drops colour values that are not hex', async () => {
    const c = await render({ body: p('x', '', '<w:color w:val="red;background:url(https://evil.test/a)"/><w:shd w:fill="url(https://evil.test/b)"/>') });

    expect(run(c, 'x').getAttribute('style') ?? '').not.toContain('url(');
  });

  it('renders tabs, breaks and special characters', async () => {
    const c = await render({
      body: '<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t><w:cr/><w:t>d</w:t><w:noBreakHyphen/><w:t>e</w:t><w:softHyphen/><w:sym w:font="Symbol" w:char="F0B7"/></w:r></w:p>',
    });
    const para = paras(c)[0];

    expect(para.textContent).toBe('a\tbcd‑e­•');
    expect(para.querySelectorAll('br')).toHaveLength(2);
  });

  it('hides vanished runs, deletions and moved-from text, and shows insertions', async () => {
    const c = await render({
      body: '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t></w:r><w:ins w:id="1"><w:r><w:t>new </w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>old</w:delText></w:r></w:del><w:moveFrom w:id="3"><w:r><w:t>from</w:t></w:r></w:moveFrom><w:moveTo w:id="4"><w:r><w:t>to</w:t></w:r></w:moveTo></w:p>',
    });

    expect(paras(c)[0].textContent).toBe('new to');
  });

  it('shows a field result, not its instruction, including nested fields', async () => {
    const c = await render({
      body: [
        '<w:p>',
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "x" </w:instrText></w:r>',
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>inner-hidden</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>',
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>result</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>',
        '<w:fldSimple w:instr=" DATE "><w:r><w:t> simple</w:t></w:r></w:fldSimple>',
        '</w:p>',
      ].join(''),
    });

    expect(paras(c)[0].textContent).toBe('result simple');
  });

  it('unwraps content controls, custom XML and smart tags', async () => {
    const c = await render({
      body: '<w:sdt><w:sdtContent><w:p><w:customXml><w:smartTag><w:r><w:t>wrapped</w:t></w:r></w:smartTag></w:customXml><w:sdt><w:sdtContent><w:r><w:t> run</w:t></w:r></w:sdtContent></w:sdt></w:p></w:sdtContent></w:sdt>',
    });

    expect(paras(c).map((el) => el.textContent)).toEqual(['wrapped run']);
  });

  it('renders one branch of mc:AlternateContent, never both', async () => {
    const c = await render({
      body: '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:t>choice</w:t></mc:Choice><mc:Fallback><w:t>fallback</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>',
    });

    expect(paras(c)[0].textContent).toBe('choice');
  });

  it('renders OMML math as its plain text', async () => {
    const c = await render({
      body: '<w:p><m:oMathPara><m:oMath><m:r><m:t>E=m</m:t></m:r><m:sSup><m:e><m:r><m:t>c</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></m:oMathPara></w:p>',
    });

    expect(paras(c)[0].textContent).toBe('E=mc2');
    expect(paras(c)[0].querySelector('sup')?.textContent).toBe('2');
  });
});

describe('renderDocxInto — paragraphs and styles', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('maps paragraph properties to inline styles', async () => {
    const c = await render({
      body: [
        p('center', '<w:jc w:val="center"/>'),
        p('justify', '<w:jc w:val="both"/>'),
        p('indent', '<w:ind w:left="720" w:right="360" w:firstLine="360"/>'),
        p('hanging', '<w:ind w:start="720" w:hanging="360"/>'),
        p('spaced', '<w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/>'),
        p('exact', '<w:spacing w:line="300" w:lineRule="exact"/>'),
        p('rtl', '<w:bidi/>'),
      ].join(''),
    });
    const [center, justify, indent, hanging, spaced, exact, rtl] = paras(c);

    expect(center.style.textAlign).toBe('center');
    expect(justify.style.textAlign).toBe('justify');
    expect(indent.style.marginInlineStart).toBe('36pt');
    expect(indent.style.marginInlineEnd).toBe('18pt');
    expect(indent.style.textIndent).toBe('18pt');
    expect(hanging.style.marginInlineStart).toBe('36pt');
    expect(hanging.style.textIndent).toBe('-18pt');
    expect(spaced.style.marginTop).toBe('12pt');
    expect(spaced.style.marginBottom).toBe('6pt');
    expect(spaced.style.lineHeight).toBe('1.5');
    expect(exact.style.lineHeight).toBe('15pt');
    expect(rtl.getAttribute('dir')).toBe('rtl');
  });

  it('resolves docDefaults, the basedOn chain, character styles and direct formatting in order', async () => {
    const c = await render({
      styles: [
        '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:color w:val="111111"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160"/></w:pPr></w:pPrDefault></w:docDefaults>',
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
        '<w:style w:type="paragraph" w:styleId="Base"><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>',
        '<w:style w:type="paragraph" w:styleId="Child"><w:basedOn w:val="Base"/><w:rPr><w:i/></w:rPr></w:style>',
        '<w:style w:type="character" w:styleId="Red"><w:rPr><w:color w:val="FF0000"/></w:rPr></w:style>',
      ].join(''),
      body: [
        p('plain'),
        '<w:p><w:pPr><w:pStyle w:val="Child"/></w:pPr><w:r><w:t>styled</w:t></w:r><w:r><w:rPr><w:rStyle w:val="Red"/><w:b w:val="0"/></w:rPr><w:t>override</w:t></w:r></w:p>',
      ].join(''),
    });
    const [plain, styled] = paras(c);

    expect(plain.style.marginBottom).toBe('8pt');
    expect(run(c, 'plain').style.fontSize).toBe('11pt');
    expect(run(c, 'plain').style.color).toBe('rgb(17, 17, 17)');
    expect(styled.style.textAlign).toBe('center');
    expect(run(c, 'styled').style.fontWeight).toBe('bold');
    expect(run(c, 'styled').style.fontStyle).toBe('italic');
    expect(run(c, 'styled').style.fontSize).toBe('14pt');
    expect(run(c, 'override').style.color).toBe('rgb(255, 0, 0)');
    expect(run(c, 'override').style.fontWeight).toBe('normal');
  });

  it('survives a basedOn cycle', async () => {
    const c = await render({
      styles: '<w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/></w:style><w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/></w:style>',
      body: p('loop', '<w:pStyle w:val="A"/>'),
    });

    expect(paras(c)[0].textContent).toBe('loop');
  });

  it('takes theme fonts for theme font references', async () => {
    const c = await render({
      theme: '<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="x"><a:majorFont><a:latin typeface="Cambria"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>',
      body: p('themed', '', '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/>'),
    });

    expect(run(c, 'themed').style.fontFamily).toContain('Calibri');
  });
});

describe('renderDocxInto — page splits', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('starts a new page at a page break, mid-paragraph', async () => {
    const c = await render({ body: '<w:p><w:r><w:t>one</w:t><w:br w:type="page"/><w:t>two</w:t></w:r></w:p>' });

    expect(pages(c).map((page) => page.querySelector('article')?.textContent)).toEqual(['one', 'two']);
  });

  it('starts a new page before a pageBreakBefore paragraph', async () => {
    const c = await render({ body: p('one') + p('two', '<w:pageBreakBefore/>') });

    expect(pages(c)).toHaveLength(2);
  });

  it('does not add a blank first page when the first paragraph breaks before itself', async () => {
    const c = await render({ body: p('one', '<w:pageBreakBefore/>') });

    expect(pages(c)).toHaveLength(1);
  });

  it('ends a section at a paragraph sectPr and sizes each page from its own section', async () => {
    const c = await render({
      body: `${p('portrait', '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>')}${p('landscape')}<w:sectPr><w:pgSz w:w="15840" w:h="12240"/></w:sectPr>`,
    });

    expect(pages(c).map((page) => page.style.width)).toEqual(['612pt', '792pt']);
    expect(pages(c).map((page) => page.querySelector('article')?.textContent)).toEqual(['portrait', 'landscape']);
  });

  it('treats a page break inside a table cell as a line break', async () => {
    const c = await render({ body: '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t><w:br w:type="page"/><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' });

    expect(pages(c)).toHaveLength(1);
    expect(c.querySelector('td')?.textContent).toBe('ab');
  });
});

describe('renderDocxInto — links and bookmarks', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  const link = (rel: string, target: string): Promise<HTMLElement> => render({
    rels: [{ id: 'rL', type: 'hyperlink', target, external: true }],
    body: `<w:p><w:hyperlink ${rel}><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>`,
  });

  it('links an external http(s) target in a new tab', async () => {
    const a = (await link('r:id="rL"', 'https://example.com/x')).querySelector('a');

    expect(a?.getAttribute('href')).toBe('https://example.com/x');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps mailto targets', async () => {
    const a = (await link('r:id="rL"', 'mailto:a@b.c')).querySelector('a');

    expect(a?.getAttribute('href')).toBe('mailto:a@b.c');
  });

  it.each(['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,x', 'vbscript:x', 'relative/page.html', ''])('renders %j as text without a link', async (target) => {
    const c = await link('r:id="rL"', target.replace('\n', '&#10;'));

    expect(c.querySelector('a[href]:not([href="#"])')).toBeNull();
    expect(c.textContent).toContain('link');
  });

  it('scrolls an internal anchor to its bookmark inside the preview without touching the page URL or ids', async () => {
    const c = await render({
      body: `<w:p><w:hyperlink w:anchor="target"><w:r><w:t>jump</w:t></w:r></w:hyperlink></w:p><w:p><w:bookmarkStart w:id="0" w:name="target"/><w:r><w:t>here</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>`,
    });
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function record(this: Element) {
      scrolled.push(this);
    };
    const before = window.location.href;

    const a = c.querySelector('a');
    a?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    Element.prototype.scrollIntoView = original;

    expect(scrolled).toHaveLength(1);
    expect(paras(c)[1].contains(scrolled[0])).toBe(true);
    expect(window.location.href).toBe(before);
    expect(c.querySelector('[id]')).toBeNull();
  });
});

describe('fontFamily', () => {
  it('strips everything that could end the CSS string a font name sits in', async () => {
    const { fontFamily } = await import('../../../../../src/tools/file/docx/props');

    expect(fontFamily('x"}body{background:red}.z{')).toBe('"xbodybackgroundred.z", sans-serif');
    expect(fontFamily('Times New Roman')).toBe('"Times New Roman", serif');
    expect(fontFamily('Courier New')).toBe('"Courier New", monospace');
    expect(fontFamily('";')).toBeNull();
  });
});

describe('renderDocxInto — fidelity fixes', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  const numbered = (pPr: string): Promise<HTMLElement> => render({
    numbering: '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
    body: p('item', `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>${pPr}`),
  });

  it('starts a tab-suffixed marker box at the hanging indent, not indented again', async () => {
    const marker = (await numbered('')).querySelector<HTMLElement>('.blok-docx-marker');

    expect(marker?.style.minWidth).toBe('18pt');
    expect(marker?.style.textIndent).toBe('0px');
  });

  it('does not leave an empty paragraph after a page break that ends it', async () => {
    const c = await render({ body: `<w:p><w:r><w:t>one</w:t><w:br w:type="page"/></w:r></w:p>${p('two')}` });

    expect(pages(c).map((page) => Array.from(page.querySelectorAll('article p')).map((el) => el.textContent))).toEqual([['one'], ['two']]);
  });

  it('keeps a paragraph that holds only a page break on the page before', async () => {
    const c = await render({ body: `${p('one')}<w:p><w:r><w:br w:type="page"/></w:r></w:p>${p('two')}` });

    expect(pages(c)).toHaveLength(2);
    expect(pages(c)[1].querySelector('article')?.textContent).toBe('two');
  });

  it('maps Symbol-font characters to their Unicode letters and signs', async () => {
    const c = await render({ body: '<w:p><w:r><w:sym w:font="Symbol" w:char="F061"/><w:sym w:font="Symbol" w:char="F0B3"/><w:sym w:font="Symbol" w:char="F044"/><w:sym w:font="Wingdings" w:char="F0FC"/></w:r></w:p>' });

    expect(paras(c)[0].textContent).toBe('α≥Δ✓');
  });

  const math = (inner: string): Promise<HTMLElement> => render({ body: `<w:p><m:oMath>${inner}</m:oMath></w:p>` });
  const mr = (t: string): string => `<m:r><m:t>${t}</m:t></m:r>`;

  it('keeps the operator of an n-ary, defaulting to an integral', async () => {
    const c = await math(`<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${mr('i')}</m:sub><m:sup>${mr('n')}</m:sup><m:e>${mr('x')}</m:e></m:nary><m:nary><m:sub/><m:sup/><m:e>${mr('y')}</m:e></m:nary>`);

    expect(paras(c)[0].textContent).toBe('∑inx∫y');
  });

  it('keeps delimiters, separators, radicals and bars', async () => {
    const c = await math([
      `<m:d><m:e>${mr('a')}</m:e><m:e>${mr('b')}</m:e></m:d>`,
      `<m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val="}"/><m:sepChr m:val=","/></m:dPr><m:e>${mr('c')}</m:e><m:e>${mr('d')}</m:e></m:d>`,
      `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${mr('2')}</m:e></m:rad>`,
      `<m:rad><m:deg>${mr('3')}</m:deg><m:e>${mr('7')}</m:e></m:rad>`,
      `<m:bar><m:e>${mr('z')}</m:e></m:bar>`,
    ].join(''));
    const para = paras(c)[0];

    expect(para.textContent).toBe('(a|b){c,d}√23√7z');
    expect(para.querySelector('sup')?.textContent).toBe('3');
    expect(Array.from(para.querySelectorAll('span')).some((el) => el.style.textDecorationLine === 'overline')).toBe(true);
  });

  it('puts each equation-array row and matrix row on its own line', async () => {
    const c = await math(`<m:eqArr><m:e>${mr('x=1')}</m:e><m:e>${mr('y=2')}</m:e></m:eqArr><m:m><m:mr><m:e>${mr('1')}</m:e><m:e>${mr('2')}</m:e></m:mr><m:mr><m:e>${mr('3')}</m:e><m:e>${mr('4')}</m:e></m:mr></m:m>`);
    const para = paras(c)[0];

    expect(para.textContent).toBe('x=1y=21 23 4');
    expect(para.querySelectorAll('br')).toHaveLength(2);
  });

  it('sets math in a math font', async () => {
    const c = await math(mr('x'));

    expect(paras(c)[0].querySelector('span')?.style.fontFamily).toContain('Cambria Math');
  });
});

describe('renderDocxInto — review fixes', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('keeps the Latin font when a run names only a complex-script or East Asian font', async () => {
    const c = await render({
      styles: '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:style>',
      body: p('cs', '', '<w:rFonts w:cs="Times New Roman"/>') + p('ea', '', '<w:rFonts w:eastAsia="MS Mincho"/>'),
    });

    expect(run(c, 'cs').style.fontFamily).toContain('Arial');
    expect(run(c, 'ea').style.fontFamily).toContain('Arial');
  });

  it('draws paragraph borders with their spacing', async () => {
    const c = await render({ body: p('ruled', '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="FF0000"/><w:top w:val="double" w:sz="4"/></w:pBdr>') });
    const para = paras(c)[0];

    expect(para.style.borderBottom).toBe('1.5pt solid rgb(255, 0, 0)');
    expect(para.style.paddingBottom).toBe('4pt');
    expect(para.style.borderTopStyle).toBe('double');
  });

  it('raises and lowers text by w:position', async () => {
    const c = await render({ body: p('up', '', '<w:position w:val="6"/>') + p('down', '', '<w:position w:val="-4"/>') });

    expect(run(c, 'up').style.verticalAlign).toBe('3pt');
    expect(run(c, 'down').style.verticalAlign).toBe('-2pt');
  });

  it('sets the columns of a section on its body', async () => {
    const c = await render({ body: `${p('x')}<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>` });
    const article = c.querySelector<HTMLElement>('article');

    expect(article?.style.columnCount).toBe('2');
    expect(article?.style.columnGap).toBe('36pt');
  });

  it('starts a new body on the same page when a continuous section changes the columns', async () => {
    const c = await render({
      body: `${p('one', '<w:sectPr><w:cols w:num="1"/></w:sectPr>')}${p('two')}<w:sectPr><w:type w:val="continuous"/><w:cols w:num="2"/></w:sectPr>`,
    });
    const articles = Array.from(c.querySelectorAll<HTMLElement>('section.blok-docx > article'));

    expect(pages(c)).toHaveLength(1);
    expect(articles.map((el) => [el.textContent, el.style.columnCount])).toEqual([['one', ''], ['two', '2']]);
  });

  it('paints the document background colour on every page', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await buildDocx({ body: p('x') }));
    const xml = (await zip.file('word/document.xml')?.async('text')) ?? '';
    zip.file('word/document.xml', xml.replace('<w:body>', '<w:background w:color="FFF2CC"/><w:body>'));
    await renderDocxInto(await zip.generateAsync({ type: 'arraybuffer' }), container);

    expect(pages(container)[0].style.backgroundColor).toBe('rgb(255, 242, 204)');
  });

  it('falls back to the default paragraph style for an unknown style id', async () => {
    const c = await render({
      styles: '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr><w:jc w:val="center"/></w:pPr></w:style>',
      body: p('x', '<w:pStyle w:val="Missing"/>'),
    });

    expect(paras(c)[0].style.textAlign).toBe('center');
  });

  it('counts a section that ends inside block-level AlternateContent', async () => {
    const c = await render({
      body: `<mc:AlternateContent><mc:Choice Requires="w14">${p('one', '<w:sectPr><w:pgSz w:w="12240"/></w:sectPr>')}</mc:Choice></mc:AlternateContent>${p('two')}<w:sectPr><w:pgSz w:w="15840"/></w:sectPr>`,
    });

    expect(pages(c).map((page) => page.style.width)).toEqual(['612pt', '792pt']);
  });

  it('raises a note body number once when its run is already superscript', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderDocxInto(await buildDocx({
      footnotes: '<w:footnote w:id="1"><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> note</w:t></w:r></w:p></w:footnote>',
      body: '<w:p><w:r><w:t>a</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>',
    }), container);

    expect(container.querySelector('.blok-docx-footnotes sup')).toBeNull();
    expect(container.querySelector('.blok-docx-footnotes')?.textContent).toBe('1 note');
  });
});

describe('FieldState', () => {
  it('hides text while any open field is still in its instruction', async () => {
    const { FieldState } = await import('../../../../../src/tools/file/docx/context');
    const fields = new FieldState();
    const seen: boolean[] = [];
    const step = (action: 'begin' | 'separate' | 'end'): void => {
      fields[action]();
      seen.push(fields.hidden);
    };

    step('begin');
    step('begin');
    step('separate');
    step('end');
    step('separate');
    step('end');
    step('end');
    step('separate');

    expect(seen).toEqual([true, true, true, true, false, false, false, false]);
  });

  it('keeps a million unclosed fields cheap', async () => {
    const { FieldState } = await import('../../../../../src/tools/file/docx/context');
    const fields = new FieldState();
    const started = performance.now();
    const hidden = Array.from({ length: 1_000_000 }, () => {
      fields.begin();

      return fields.hidden;
    });

    expect(hidden.every(Boolean)).toBe(true);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

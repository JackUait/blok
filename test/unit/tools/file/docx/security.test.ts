import JSZip from 'jszip';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderDocxInto } from '../../../../../src/tools/file/docx';
import { MAX_DEPTH } from '../../../../../src/tools/file/docx/context';
import { ZipLimitError } from '../../../../../src/tools/file/zip-parts';
import { buildDocx, p, part, PNG_1X1 } from './build-docx';
import type { DocxParts } from './build-docx';

const MARK = 'SAFE-MARKER';
const FORBIDDEN_TAGS = 'iframe, frame, script, style, object, embed, link, meta, base, form, input, button, textarea, select, svg, math, template, video, audio, source, portal';
const SAFE_HREF = /^(?:https?:|mailto:|tel:|sms:)/i;
const BAD_STYLE = /url\(|expression|position\s*:|@import|[{}]|javascript|behavior|-moz-binding|native code|\[object/i;

async function render(parts: DocxParts): Promise<{ c: HTMLElement; dispose: () => void }> {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const dispose = await renderDocxInto(await buildDocx(parts), c);

  return { c, dispose };
}

/** The positive control: the benign paragraph of every attack document rendered. */
function expectRendered(c: HTMLElement): void {
  expect(c.querySelector('article')?.textContent ?? '').toContain(MARK);
}

function hrefProblems(c: HTMLElement): string[] {
  return Array.from(c.querySelectorAll('a')).flatMap((a) => {
    const href = a.getAttribute('href');
    const okHref = href === null || href === '#' || SAFE_HREF.test(href);
    const okRel = a.target !== '_blank' || a.rel.includes('noopener');

    return okHref && okRel ? [] : [`a href=${String(href)} target=${a.target} rel=${a.rel}`];
  });
}

const BANNED_ATTRIBUTE = /^(?:id|name|on.*|srcset|formaction)$/;

function attributeProblems(el: Element): string[] {
  return Array.from(el.attributes)
    .filter((at) => BANNED_ATTRIBUTE.test(at.name)
      || (at.name === 'style' && BAD_STYLE.test(at.value))
      || (at.name === 'src' && !at.value.startsWith('blob:')))
    .map((at) => `${el.localName}[${at.name}="${at.value}"]`);
}

/** Every invariant the preview must hold whatever the document says. */
function safetyProblems(c: HTMLElement): string[] {
  const tags = Array.from(c.querySelectorAll(FORBIDDEN_TAGS)).map((el) => `<${el.localName}>`);
  const attrs = Array.from(c.querySelectorAll('*')).flatMap(attributeProblems);

  return [...tags, ...attrs, ...hrefProblems(c)];
}

const run = (inner: string, rPr = ''): string => `<w:p><w:r>${rPr === '' ? '' : `<w:rPr>${rPr}</w:rPr>`}${inner}</w:r></w:p>`;
const linkTo = (id: string, extra = ''): string => `<w:p><w:hyperlink r:id="${id}"${extra}><w:r><w:t>click</w:t></w:r></w:hyperlink></w:p>`;
const IMAGE_REL = { id: 'rIdImg', type: 'image', target: 'media/image1.png' };
const blipDrawing = (blip: string): string =>
  '<w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="7" name="evil"/>'
  + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
  + `<pic:pic><pic:blipFill>${blip}</pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;

/** Zip of document.xml with the given full text, plus the minimum package parts. */
async function rawDocx(documentXml: string, extra: Record<string, string> = {}): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', documentXml);
  for (const [path, text] of Object.entries(extra)) {
    zip.file(path, text);
  }

  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

/** Overwrite every local and central size field so the zip claims tiny parts. */
/** Make the zip claim `name` inflates to 10 bytes, in its local and central headers. */
function lieAboutSizes(buf: ArrayBuffer, name: string): ArrayBuffer {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const nameAt = (start: number, length: number): string => new TextDecoder().decode(bytes.subarray(start, start + length));
  for (const offset of Array.from({ length: buf.byteLength - 46 }, (_, i) => i)) {
    const sig = view.getUint32(offset, true);
    if (sig === 0x04034b50 && nameAt(offset + 30, view.getUint16(offset + 26, true)) === name) {
      view.setUint32(offset + 22, 10, true);
    } else if (sig === 0x02014b50 && nameAt(offset + 46, view.getUint16(offset + 28, true)) === name) {
      view.setUint32(offset + 24, 10, true);
    }
  }

  return buf;
}

const BILLION_LAUGHS = '<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">]>';

describe('renderDocxInto — untrusted documents', () => {
  const created: string[] = [];
  const revoked: string[] = [];
  const saved = {
    create: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
    revoke: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    created.length = 0;
    revoked.length = 0;
    // jsdom has no blob URLs; stand in for them and keep the blob type in the URL.
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: (blob: Blob): string => {
        const url = `blob:test/${created.length}-${blob.type}`;
        created.push(url);

        return url;
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: (url: string): void => {
      revoked.push(url);
    } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    for (const [key, descriptor] of [['createObjectURL', saved.create], ['revokeObjectURL', saved.revoke]] as const) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(URL, key);
      } else {
        Object.defineProperty(URL, key, descriptor);
      }
    }
  });

  it('the safety check flags each unsafe construct (control)', () => {
    const c = document.createElement('div');
    const frame = document.createElement('iframe');
    const link = document.createElement('a');
    link.setAttribute('href', 'javascript:alert(1)');
    const box = document.createElement('span');
    box.style.setProperty('position', 'fixed');
    box.setAttribute('id', 'x');
    c.append(frame, link, box);

    expect(safetyProblems(c)).toHaveLength(4);
  });

  describe('script and markup injection', () => {
    it('ignores an altChunk holding HTML with a script', async () => {
      const { c } = await render({
        body: p(MARK) + '<w:altChunk r:id="rIdChunk"/>',
        rels: [{ id: 'rIdChunk', type: 'aFChunk', target: 'afchunk.htm' }],
        files: { 'word/afchunk.htm': '<html><body><script>window.__pwned=1</script><iframe src="javascript:alert(1)"></iframe>chunk-text</body></html>' },
      });

      expectRendered(c);
      expect(safetyProblems(c)).toEqual([]);
      expect(c.textContent).not.toContain('chunk-text');
    });

    it('keeps markup in text runs as text', async () => {
      const { c } = await render({ body: p(MARK) + p('&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;x&lt;/script&gt;') });

      expectRendered(c);
      expect(safetyProblems(c)).toEqual([]);
      expect(c.textContent).toContain('<img src=x onerror=alert(1)>');
    });

    it('drops foreign-namespace HTML/SVG elements embedded in the XML', async () => {
      const { c } = await render({
        body: p(MARK) + '<w:p><w:r><h:script xmlns:h="http://www.w3.org/1999/xhtml">window.__pwned=1</h:script><s:svg xmlns:s="http://www.w3.org/2000/svg" onload="alert(1)"/><w:t>t</w:t></w:r></w:p>',
      });

      expectRendered(c);
      expect(safetyProblems(c)).toEqual([]);
      expect(c.textContent).not.toContain('__pwned');
    });
  });

  describe('links', () => {
    const external = (target: string): DocxParts => ({
      body: p(MARK) + linkTo('rIdL', ' w:tgtFrame="_top" w:tooltip="x"'),
      rels: [{ id: 'rIdL', type: 'hyperlink', target, external: true }],
    });

    it.each([
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java&#x09;script:alert(1)',
      'java&#x0A;script:alert(1)',
      ' javascript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;',
      'file:///etc/passwd',
      'blob:https://evil/x',
      '//evil.example/phish',
      'evil.html',
      '#top',
    ])('drops a hyperlink target of %s', async (target) => {
      const { c } = await render(external(target));

      expectRendered(c);
      expect(c.querySelector('a')?.hasAttribute('href')).toBe(false);
      expect(safetyProblems(c)).toEqual([]);
    });

    it('opens an http link in a new tab without an opener and ignores tgtFrame', async () => {
      const { c } = await render(external('https://example.com/a'));
      const a = c.querySelector('a');

      expect(a?.getAttribute('href')).toBe('https://example.com/a');
      expect(a?.target).toBe('_blank');
      expect(a?.rel).toBe('noopener noreferrer');
    });

    it('does not follow an internal (non-external) hyperlink relationship', async () => {
      const { c } = await render({
        body: p(MARK) + linkTo('rIdL'),
        rels: [{ id: 'rIdL', type: 'hyperlink', target: 'javascript:alert(1)' }],
      });

      expectRendered(c);
      expect(c.querySelector('a')?.hasAttribute('href')).toBe(false);
    });

    it('renders HYPERLINK fields as plain text', async () => {
      const { c } = await render({
        body: p(MARK)
          + '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>HYPERLINK "javascript:alert(1)"</w:instrText></w:r>'
          + '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>field-link</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
          + '<w:p><w:fldSimple w:instr="HYPERLINK &quot;javascript:alert(2)&quot;"><w:r><w:t>simple-link</w:t></w:r></w:fldSimple></w:p>',
      });

      expectRendered(c);
      expect(c.textContent).toContain('field-link');
      expect(c.querySelectorAll('a')).toHaveLength(0);
      expect(c.textContent).not.toContain('javascript');
    });

    it('an anchor link scrolls without changing location.hash', async () => {
      const scroll = vi.fn();
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scroll });
      const { c } = await render({
        body: p(MARK) + '<w:p><w:hyperlink w:anchor="__proto__"><w:r><w:t>jump</w:t></w:r></w:hyperlink></w:p>'
          + '<w:p><w:bookmarkStart w:id="0" w:name="__proto__"/><w:r><w:t>target</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>',
      });
      const before = window.location.href;
      c.querySelector('a')?.click();

      expect(c.querySelector('a')?.getAttribute('href')).toBe('#');
      expect(window.location.href).toBe(before);
      expect(scroll).toHaveBeenCalledTimes(1);
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    });
  });

  describe('CSS injection', () => {
    const BREAKOUT = '&quot;; } body { background: red !important } x { font-family: &quot;';

    it('strips CSS syntax out of font names (direct and theme)', async () => {
      const theme = '<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme>'
        + `<a:majorFont><a:latin typeface="${BREAKOUT}"/></a:majorFont><a:minorFont><a:latin typeface="x);background:url(http://e/x"/></a:minorFont>`
        + '</a:fontScheme></a:themeElements></a:theme>';
      const { c } = await render({
        theme,
        body: p(MARK, '', `<w:rFonts w:ascii="${BREAKOUT}"/>`)
          + p('t', '', '<w:rFonts w:asciiTheme="majorHAnsi"/>')
          + p('m', '', '<w:rFonts w:asciiTheme="minorHAnsi"/>'),
      });

      expectRendered(c);
      expect(safetyProblems(c)).toEqual([]);
    });

    it('drops colours, fills and lengths that are not plain values', async () => {
      const { c } = await render({
        body: p(MARK, '<w:shd w:fill="fff;position:fixed"/><w:ind w:left="1;position:fixed" w:firstLine="x}"/><w:spacing w:before="1e400" w:line="url(x)"/>',
          '<w:color w:val="red;position:fixed;inset:0"/><w:shd w:fill="000000;background:url(http://e/x)"/><w:u w:val="single" w:color="1}body{"/><w:sz w:val="1px;position:fixed"/>'),
      });

      expectRendered(c);
      expect(safetyProblems(c)).toEqual([]);
    });

    it('reads only width and height from a VML style string', async () => {
      const { c } = await render({
        body: p(MARK) + run('<w:pict><v:shape style="position:fixed;left:0;top:0;width:100px;height:50px;background:url(http://e/x);z-index:99999"><v:imagedata r:id="rIdImg"/></v:shape></w:pict>'),
        rels: [IMAGE_REL],
        files: { 'word/media/image1.png': PNG_1X1 },
      });

      expectRendered(c);
      expect(c.querySelector('img')).not.toBeNull();
      expect(safetyProblems(c)).toEqual([]);
    });

    it('rejects table widths, borders and indents that smuggle CSS', async () => {
      const { c } = await render({
        body: p(MARK) + '<w:tbl><w:tblPr><w:tblW w:type="pct" w:w="100%;position:fixed"/><w:tblInd w:w="1;position:fixed" w:type="dxa"/>'
          + '<w:tblBorders><w:top w:val="single" w:sz="4;x" w:color="red;background:url(x)"/></w:tblBorders></w:tblPr>'
          + '<w:tblGrid><w:gridCol w:w="1;position:fixed"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="1;position:fixed"/></w:trPr>'
          + '<w:tc><w:tcPr><w:tcW w:type="pct" w:w="5%;position:fixed"/><w:shd w:fill="red;position:fixed"/><w:tcMar><w:top w:w="1;x" w:type="dxa"/></w:tcMar></w:tcPr>'
          + `${p('cell')}</w:tc></w:tr></w:tbl>`,
      });

      expectRendered(c);
      expect(safetyProblems(c)).toEqual([]);
    });

    it('never writes Object.prototype members as style values', async () => {
      const { c } = await render({
        body: p(MARK, '<w:jc w:val="constructor"/>', '<w:highlight w:val="constructor"/><w:u w:val="toString"/>')
          + '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="constructor"/></w:tblBorders></w:tblPr><w:tr><w:tc><w:tcPr><w:vAlign w:val="constructor"/></w:tcPr>'
          + `${p('cell')}</w:tc></w:tr></w:tbl>`,
      });

      expectRendered(c);
      const styles = Array.from(c.querySelectorAll('[style]')).map((el) => el.getAttribute('style') ?? '');

      expect(styles.filter((s) => /native code|\[object|function/.test(s))).toEqual([]);
    });
  });

  describe('DOM clobbering', () => {
    it('writes no id or name attributes from bookmarks, drawings or controls', async () => {
      const { c } = await render({
        body: p(MARK) + '<w:p><w:bookmarkStart w:id="1" w:name="body"/><w:bookmarkStart w:id="2" w:name="cookie"/><w:r><w:t>b</w:t></w:r></w:p>'
          + '<w:sdt><w:sdtPr><w:alias w:val="location"/><w:tag w:val="document"/><w:id w:val="9"/></w:sdtPr><w:sdtContent>' + p('sdt') + '</w:sdtContent></w:sdt>'
          + run(blipDrawing('<a:blip r:embed="rIdImg"/>')),
        rels: [IMAGE_REL],
        files: { 'word/media/image1.png': PNG_1X1 },
      });

      expectRendered(c);
      expect(c.querySelectorAll('[id], [name]')).toHaveLength(0);
    });
  });

  describe('remote resources and MIME confusion', () => {
    it('never loads an external or linked picture', async () => {
      const { c } = await render({
        body: p(MARK) + run(blipDrawing('<a:blip r:embed="rIdExt"/>')) + run(blipDrawing('<a:blip r:link="rIdExt"/>'))
          + run('<w:pict><v:shape style="width:10px;height:10px"><v:imagedata r:id="rIdExt" o:href="http://tracker.example/o.png" xmlns:o="urn:schemas-microsoft-com:office:office"/></v:shape></w:pict>'),
        rels: [{ id: 'rIdExt', type: 'image', target: 'http://tracker.example/pixel.png', external: true }],
      });

      expectRendered(c);
      expect(c.querySelectorAll('img')).toHaveLength(0);
      expect(created).toEqual([]);
    });

    it.each([
      ['SVG', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
      ['HTML', '<!doctype html><script>alert(1)</script>'],
    ])('shows no image for %s bytes in a .png part', async (_, bytes) => {
      const { c } = await render({
        body: p(MARK) + run(blipDrawing('<a:blip r:embed="rIdImg"/>')),
        rels: [IMAGE_REL],
        files: { 'word/media/image1.png': bytes },
      });

      expectRendered(c);
      expect(c.querySelectorAll('img')).toHaveLength(0);
      expect(created).toEqual([]);
    });

    it('types a blob from its bytes, not the part name', async () => {
      const { c } = await render({
        body: p(MARK) + run(blipDrawing('<a:blip r:embed="rIdImg"/>')),
        rels: [{ id: 'rIdImg', type: 'image', target: 'media/image1.svg' }],
        files: { 'word/media/image1.svg': PNG_1X1 },
      });

      expectRendered(c);
      expect(created).toEqual(['blob:test/0-image/png']);
    });
  });

  describe('XML parser abuse', () => {
    it('rejects a main part with a DOCTYPE (billion laughs)', async () => {
      const xml = `${BILLION_LAUGHS}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&d;</w:t></w:r></w:p></w:body></w:document>`;

      await expect(renderDocxInto(await rawDocx(xml), document.createElement('div'))).rejects.toThrow(/DOCTYPE/);
    });

    it('rejects a SYSTEM external entity', async () => {
      const xml = '<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>';

      await expect(renderDocxInto(await rawDocx(xml), document.createElement('div'))).rejects.toThrow();
    });

    it('drops a styles part with a DOCTYPE but still renders the body', async () => {
      const styles = `${BILLION_LAUGHS}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="&d;"/></w:styles>`;
      const zip = await JSZip.loadAsync(await buildDocx({ body: p(MARK), styles: '' }));
      zip.file('word/styles.xml', styles);
      const c = document.createElement('div');
      await renderDocxInto(await zip.generateAsync({ type: 'arraybuffer' }), c);

      expectRendered(c);
    });

    it('creates no link or style element for an xml-stylesheet PI or XInclude', async () => {
      const xml = part('document', `<w:body>${p(MARK)}<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="http://tracker.example/x.xml"/></w:body>`)
        .replace('?>', '?><?xml-stylesheet type="text/css" href="http://tracker.example/x.css"?>');
      const c = document.createElement('div');
      await renderDocxInto(await rawDocx(xml), c);

      expectRendered(c);
      expect(safetyProblems(c)).toEqual([]);
    });
  });

  describe('resource limits', () => {
    it('rejects a part whose zip entry honestly declares more than the limit', async () => {
      const zip = await JSZip.loadAsync(await buildDocx({ body: p(MARK) }));
      zip.file('word/styles.xml', 'a'.repeat(65 * 1024 * 1024));
      const rels = (await zip.file('word/_rels/document.xml.rels')?.async('text')) ?? '';
      zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>', '<Relationship Id="rS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'));
      const buf = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });

      await expect(renderDocxInto(buf, document.createElement('div'))).rejects.toBeInstanceOf(ZipLimitError);
    }, 30_000);

    it('rejects a part that inflates past the limit while its zip entry claims 10 bytes', async () => {
      const zip = await JSZip.loadAsync(await buildDocx({ body: p(MARK) }));
      zip.file('word/document.xml', `${part('document', `<w:body>${p(MARK)}</w:body>`)}<!--${'a'.repeat(70 * 1024 * 1024)}-->`);
      const buf = lieAboutSizes(await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' }), 'word/document.xml');

      await expect(renderDocxInto(buf, document.createElement('div'))).rejects.toBeInstanceOf(ZipLimitError);
    }, 30_000);

    it('bounds nesting of tables and text boxes', async () => {
      const depth = MAX_DEPTH + 16;
      const cell = (inner: string): string => `<w:tbl><w:tr><w:tc>${inner}<w:p/></w:tc></w:tr></w:tbl>`;
      const tables = Array.from({ length: depth }).reduce<string>((inner) => cell(inner), p('deepest'));
      const box = (inner: string): string => `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>${inner}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
      const boxes = Array.from({ length: depth }).reduce<string>((inner) => box(inner), p('deepest-box'));
      const { c } = await render({ body: p(MARK) + tables + boxes });

      expectRendered(c);
      expect(c.querySelectorAll('table').length).toBeLessThanOrEqual(MAX_DEPTH + 1);
      expect(c.textContent).not.toContain('deepest');
    });

    it('survives 8000 nested w:ins wrappers', async () => {
      const n = 8_000;
      const { c } = await render({ body: p(MARK) + '<w:ins>'.repeat(n) + p('x') + '</w:ins>'.repeat(n) });

      expectRendered(c);
    }, 60_000);

    // jsdom is slow on large bodies, so the 10k-paragraph timing lives in the e2e spec.
    it('renders a 4k-paragraph document', async () => {
      const { c } = await render({ body: p(MARK) + Array.from({ length: 4_000 }, (_, i) => p(`para ${i}`)).join('') });

      expectRendered(c);
      expect(c.querySelectorAll('article p').length).toBeGreaterThan(4_000);
    }, 30_000);

    it('keeps a list marker short whatever w:start says', async () => {
      const numbering = '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="260000000"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>'
        + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
      const { c } = await render({ numbering, body: p(MARK, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') });
      const marker = c.querySelector('.blok-docx-marker');

      expect(marker).not.toBeNull();
      expect(marker?.textContent?.length ?? 0).toBeLessThan(100);
    });

    it('renders a document with an out-of-range w:sym char', async () => {
      const { c } = await render({ body: p(MARK) + run('<w:sym w:font="Symbol" w:char="FFFFFFF"/>') });

      expectRendered(c);
    });

    it('does not multiply a header across thousands of empty pages', async () => {
      const header = part('hdr', Array.from({ length: 50 }, (_, i) => p(`h${i}`)).join(''));
      const { c } = await render({
        body: p(MARK) + run('<w:br w:type="page"/>'.repeat(2_000)) + '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>',
        rels: [{ id: 'rIdH', type: 'header', target: 'header1.xml' }],
        files: { 'word/header1.xml': header },
      });

      expectRendered(c);
      expect(c.querySelectorAll('*').length).toBeLessThan(50_000);
    }, 60_000);

    it('does not multiply one footnote body across thousands of references', async () => {
      const body = Array.from({ length: 50 }, (_, i) => p(`n${i}`)).join('');
      const { c } = await render({
        footnotes: `<w:footnote w:id="1">${body}</w:footnote>`,
        body: p(MARK) + run('<w:footnoteReference w:id="1"/>'.repeat(2_000)),
      });

      expectRendered(c);
      expect(c.querySelectorAll('*').length).toBeLessThan(50_000);
    }, 60_000);
  });

  describe('blob URLs', () => {
    it('revokes every blob URL on dispose', async () => {
      const { c, dispose } = await render({
        body: p(MARK) + run(blipDrawing('<a:blip r:embed="rIdImg"/>')) + run(blipDrawing('<a:blip r:embed="rIdImg2"/>')),
        rels: [IMAGE_REL, { id: 'rIdImg2', type: 'image', target: 'media/image2.png' }],
        files: { 'word/media/image1.png': PNG_1X1, 'word/media/image2.png': PNG_1X1 },
      });

      expectRendered(c);
      expect(created).toHaveLength(2);
      dispose();
      expect(revoked.sort()).toEqual([...created].sort());
    });

    it('revokes blob URLs when the render fails part-way', async () => {
      const buf = await buildDocx({
        body: p(MARK) + run(blipDrawing('<a:blip r:embed="rIdImg"/>')) + '<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>',
        rels: [IMAGE_REL],
        files: { 'word/media/image1.png': PNG_1X1 },
      });
      // Any failure after the picture started will do; a table that cannot be built is one.
      const create = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
        if (tag === 'table') {
          throw new Error('table failed');
        }

        return create(tag, options);
      });
      await expect(renderDocxInto(buf, document.createElement('div'))).rejects.toThrow('table failed');
      await vi.waitFor(() => expect(created).toHaveLength(1), { timeout: 5_000 });

      expect(revoked).toEqual(created);
    });
  });
});

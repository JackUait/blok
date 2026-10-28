import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderDocxInto } from '../../../../../src/tools/file/docx';
import { PNG_1X1, buildDocx, p, part } from './build-docx';

const PIC = '<w:r><w:drawing><wp:inline><wp:extent cx="95250" cy="95250"/><wp:docPr id="1" name="logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

const headerFiles = (extra: Record<string, string | Uint8Array> = {}): Record<string, string | Uint8Array> => ({
  'word/header1.xml': part('hdr', `<w:p>${PIC}<w:r><w:t>Head</w:t></w:r></w:p>`),
  'word/_rels/header1.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/></Relationships>',
  'word/media/logo.png': PNG_1X1,
  ...extra,
});

async function render(body: string, files = headerFiles(), settings?: string): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await renderDocxInto(await buildDocx({
    body,
    settings,
    files,
    rels: [
      { id: 'rH', type: 'header', target: 'header1.xml' },
      { id: 'rH2', type: 'header', target: 'header2.xml' },
      { id: 'rF', type: 'footer', target: 'footer1.xml' },
    ],
  }), container);

  return container;
}

const sectPr = (refs: string, extra = ''): string => `<w:sectPr>${refs}${extra}</w:sectPr>`;

describe('renderDocxInto — headers and footers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('shows the header picture on every page', async () => {
    const c = await render(p('one') + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + p('two') + sectPr('<w:headerReference w:type="default" r:id="rH"/>'));
    const imgs = Array.from(c.querySelectorAll('section.blok-docx > header img'));

    expect(imgs).toHaveLength(2);
    expect(imgs.every((img) => img.getAttribute('src')?.startsWith('blob:') === true)).toBe(true);
  });

  it('uses the first-page header only on the first page of a titlePg section', async () => {
    const files = headerFiles({ 'word/header2.xml': part('hdr', '<w:p><w:r><w:t>First</w:t></w:r></w:p>') });
    const c = await render(
      p('one') + p('two', '<w:pageBreakBefore/>') + sectPr('<w:headerReference w:type="default" r:id="rH"/><w:headerReference w:type="first" r:id="rH2"/>', '<w:titlePg/>'),
      files,
    );

    expect(Array.from(c.querySelectorAll('header')).map((h) => h.textContent)).toEqual(['First', 'Head']);
  });

  it('uses the even header on even pages only when the settings ask for it', async () => {
    const files = headerFiles({ 'word/header2.xml': part('hdr', '<w:p><w:r><w:t>Even</w:t></w:r></w:p>') });
    const body = p('one') + p('two', '<w:pageBreakBefore/>') + sectPr('<w:headerReference w:type="default" r:id="rH"/><w:headerReference w:type="even" r:id="rH2"/>');

    expect(Array.from((await render(body, files, '<w:evenAndOddHeaders/>')).querySelectorAll('header')).map((h) => h.textContent)).toEqual(['Head', 'Even']);
    document.body.replaceChildren();
    expect(Array.from((await render(body, files)).querySelectorAll('header')).map((h) => h.textContent)).toEqual(['Head', 'Head']);
  });

  it('puts the footer after the body', async () => {
    const files = headerFiles({ 'word/footer1.xml': part('ftr', '<w:p><w:r><w:t>Foot</w:t></w:r></w:p>') });
    const c = await render(p('body') + sectPr('<w:footerReference w:type="default" r:id="rF"/>'), files);
    const page = c.querySelector('section.blok-docx');

    expect(Array.from(page?.children ?? []).map((el) => el.localName)).toEqual(['article', 'footer']);
  });
});

describe('renderDocxInto — notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  const note = (id: string, text: string): string => `<w:footnote w:id="${id}"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${text}</w:t></w:r></w:p></w:footnote>`;

  it('numbers footnotes through the document and lists each on its own page', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderDocxInto(await buildDocx({
      footnotes: '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' + note('1', 'first') + note('2', 'second'),
      body: '<w:p><w:r><w:t>a</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>b</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p>',
    }), container);
    const lists = Array.from(container.querySelectorAll('section.blok-docx .blok-docx-footnotes'));

    expect(Array.from(container.querySelectorAll('.blok-docx-noteref')).map((el) => el.textContent)).toEqual(['1', '2']);
    expect(lists.map((list) => list.textContent)).toEqual(['1 first', '2 second']);
  });

  it('lists endnotes at the end of the document', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderDocxInto(await buildDocx({
      endnotes: '<w:endnote w:id="1"><w:p><w:r><w:endnoteRef/></w:r><w:r><w:t xml:space="preserve"> end</w:t></w:r></w:p></w:endnote>',
      body: '<w:p><w:r><w:t>a</w:t></w:r><w:r><w:endnoteReference w:id="1"/></w:r></w:p>' + p('b', '<w:pageBreakBefore/>'),
    }), container);
    const pages = Array.from(container.querySelectorAll('section.blok-docx'));

    expect(pages[0].querySelector('.blok-docx-endnotes')).toBeNull();
    expect(pages[1].querySelector('.blok-docx-endnotes')?.textContent).toBe('1 end');
  });
});

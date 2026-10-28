import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderDocxInto } from '../../../../../src/tools/file/docx';
import { buildDocx, PNG_1X1 } from './build-docx';
import type { DocxParts } from './build-docx';

const IMAGE_REL = { id: 'rIdImg', type: 'image', target: 'media/image1.png' };

/** A paragraph holding one run with the given drawing markup. */
const run = (inner: string): string => `<w:p><w:r>${inner}</w:r></w:p>`;

const pic = (blip: string): string =>
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
  + `<pic:pic><pic:blipFill>${blip}</pic:blipFill></pic:pic></a:graphicData></a:graphic>`;

const inlineDrawing = (blip = '<a:blip r:embed="rIdImg"/>', docPr = '<wp:docPr id="1" name="Picture 1" descr="A cat"/>'): string =>
  `<w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/>${docPr}${pic(blip)}</wp:inline></w:drawing>`;

const withImage = (body: string, bytes: Uint8Array = PNG_1X1): DocxParts => ({
  body,
  rels: [IMAGE_REL],
  files: { 'word/media/image1.png': bytes },
});

async function render(parts: DocxParts): Promise<{ c: HTMLElement; dispose: () => void }> {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const dispose = await renderDocxInto(await buildDocx(parts), c);

  return { c, dispose };
}

/** What an empty paragraph renders as, to compare a paragraph that drew nothing. */
async function emptyParagraphHtml(): Promise<string | undefined> {
  const { c } = await render({ body: '<w:p><w:r></w:r></w:p>' });

  return c.querySelector('article p')?.innerHTML;
}

const imgs = (c: HTMLElement): HTMLImageElement[] => Array.from(c.querySelectorAll('article img'));

describe('renderDocxInto — drawings', () => {
  const created: string[] = [];
  const saved = {
    create: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
    revoke: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    created.length = 0;
    // jsdom has no blob URLs; stand in for them.
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: (blob: Blob): string => {
        const url = `blob:test/${created.length}-${blob.type}`;
        created.push(url);

        return url;
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: (): void => undefined });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    for (const [name, descriptor] of [['createObjectURL', saved.create], ['revokeObjectURL', saved.revoke]] as const) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(URL, name);
      } else {
        Object.defineProperty(URL, name, descriptor);
      }
    }
  });

  it('shows an embedded PNG from a blob URL and frees it on dispose', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const { c, dispose } = await render(withImage(run(inlineDrawing())));
    const [img] = imgs(c);

    expect(img.src).toMatch(/^blob:/);
    expect(img.src).toContain('image/png');
    expect(revoke).not.toHaveBeenCalled();

    dispose();

    expect(revoke).toHaveBeenCalledWith(img.src);
  });

  it('sizes the image from wp:extent and reads alt from wp:docPr descr', async () => {
    const { c } = await render(withImage(run(inlineDrawing())));
    const [img] = imgs(c);

    expect(img.width).toBe(100);
    expect(img.height).toBe(50);
    expect(img.alt).toBe('A cat');
    expect(img.decoding).toBe('async');
  });

  it('stretches the picture to its wp:extent box, not to the image shape', async () => {
    const { c } = await render(withImage(run(inlineDrawing())));
    const [img] = imgs(c);

    expect(img.style.getPropertyValue('width')).toBe('100%');
    expect(img.style.getPropertyValue('height')).toBe('100%');
  });

  it('shows only the a:srcRect part of a cropped picture, filling the box', async () => {
    const { c } = await render(withImage(run(inlineDrawing('<a:blip r:embed="rIdImg"/><a:srcRect l="25000" t="10000" r="25000" b="40000"/>'))));
    const [img] = imgs(c);
    const box = img.parentElement;

    expect(box?.style.getPropertyValue('overflow')).toBe('hidden');
    expect(box?.style.getPropertyValue('position')).toBe('relative');
    expect(img.style.getPropertyValue('position')).toBe('absolute');
    expect(img.style.getPropertyValue('max-width')).toBe('none');
    expect(img.style.getPropertyValue('width')).toBe('200%');
    expect(img.style.getPropertyValue('height')).toBe('200%');
    expect(img.style.getPropertyValue('left')).toBe('-50%');
    expect(img.style.getPropertyValue('top')).toBe('-20%');
  });

  it('ignores a crop that leaves nothing or is not a number', async () => {
    for (const rect of ['<a:srcRect l="60000" r="60000"/>', '<a:srcRect l="x" t="-5"/>']) {
      const { c } = await render(withImage(run(inlineDrawing(`<a:blip r:embed="rIdImg"/>${rect}`))));
      const [img] = imgs(c);

      expect(img.style.getPropertyValue('position')).toBe('');
      expect(img.style.getPropertyValue('width')).toBe('100%');
      document.body.replaceChildren();
    }
  });

  it('uses an empty alt when docPr has no descr', async () => {
    const { c } = await render(withImage(run(inlineDrawing(undefined, '<wp:docPr id="1" name="Picture 1"/>'))));

    expect(imgs(c)[0].getAttribute('alt')).toBe('');
  });

  it('shows no image for HTML bytes in a part named .png', async () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    const { c } = await render(withImage(run(inlineDrawing()), html));

    expect(imgs(c)).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it('never fetches an external image (r:link)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { c } = await render({
      body: run(inlineDrawing('<a:blip r:link="rIdExt"/>')),
      rels: [{ id: 'rIdExt', type: 'image', target: 'https://evil.example/x.png', external: true }],
    });
    vi.unstubAllGlobals();

    expect(imgs(c)).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never fetches an r:embed that points at an external target', async () => {
    const { c } = await render({
      body: run(inlineDrawing()),
      rels: [{ id: 'rIdImg', type: 'image', target: 'https://evil.example/x.png', external: true }],
    });

    expect(imgs(c)).toHaveLength(0);
  });

  it('renders an anchored picture in the flow', async () => {
    const anchor = `<w:drawing><wp:anchor><wp:extent cx="1905000" cy="952500"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="p"/>${pic('<a:blip r:embed="rIdImg"/>')}</wp:anchor></w:drawing>`;
    const { c } = await render(withImage(run(anchor)));
    const [img] = imgs(c);

    expect(img.width).toBe(200);
    expect(img.parentElement?.style.display).toBe('inline-block');
  });

  it('puts a top-and-bottom anchored picture on its own line', async () => {
    const anchor = `<w:drawing><wp:anchor><wp:extent cx="952500" cy="952500"/><wp:wrapTopAndBottom/><wp:docPr id="1" name="p"/>${pic('<a:blip r:embed="rIdImg"/>')}</wp:anchor></w:drawing>`;
    const { c } = await render(withImage(run(anchor)));

    expect(imgs(c)[0].parentElement?.style.display).toBe('block');
  });

  it('shows the text of a DrawingML text box', async () => {
    const box = '<w:drawing><wp:anchor><wp:extent cx="1905000" cy="476250"/><wp:docPr id="2" name="Text Box 2"/>'
      + '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
      + '<wps:wsp><wps:spPr/><wps:txbx><w:txbxContent><w:p><w:r><w:t>Boxed words</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>'
      + '</a:graphicData></a:graphic></wp:anchor></w:drawing>';
    const { c } = await render({ body: run(box) });
    const frame = c.querySelector<HTMLElement>('article p div');

    expect(frame?.querySelector('p')?.textContent).toBe('Boxed words');
    expect(frame?.style.display).toBe('inline-block');
    expect(frame?.style.width).toBe('200px');
  });

  it('shows the text of a VML text box', async () => {
    const box = '<w:pict><v:shape style="width:100pt;height:20pt"><v:textbox><w:txbxContent><w:p><w:r><w:t>Old box</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict>';
    const { c } = await render({ body: run(box) });

    expect(c.querySelector('article')?.textContent).toContain('Old box');
  });

  it('shows a VML imagedata picture sized from numeric style values only', async () => {
    const shape = '<w:pict><v:shape style="position:fixed;inset:0;z-index:9999;width:75pt;height:0.5in;background:url(https://evil.example/)">'
      + '<v:imagedata r:id="rIdImg"/></v:shape></w:pict>';
    const { c } = await render(withImage(run(shape)));
    const [img] = imgs(c);

    expect(img.src).toMatch(/^blob:/);
    expect(img.width).toBe(100);
    expect(img.height).toBe(48);
    const box = img.parentElement;
    expect(box?.style.position).toBe('');
    expect(box?.style.getPropertyValue('inset')).toBe('');
    expect(box?.style.zIndex).toBe('');
    expect(img.style.position).toBe('');
    expect(box?.getAttribute('style') ?? '').not.toContain('evil');
  });

  it('shows the preview picture of a w:object (OLE)', async () => {
    const ole = '<w:object><v:shape style="width:30px;height:2cm"><v:imagedata r:id="rIdImg"/></v:shape></w:object>';
    const { c } = await render(withImage(run(ole)));
    const [img] = imgs(c);

    expect(img.width).toBe(30);
    expect(img.height).toBe(76);
  });

  it('renders nothing for VML shapes without a picture or text', async () => {
    const { c } = await render({ body: run('<w:pict><v:rect style="width:10pt;height:10pt"/></w:pict>') });

    expect(c.querySelector('article p')?.innerHTML).toBe(await emptyParagraphHtml());
  });

  it('renders nothing for a chart', async () => {
    const chart = '<w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="Chart 1"/>'
      + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdC"/></a:graphicData></a:graphic></wp:inline></w:drawing>';
    const { c } = await render({ body: run(chart) });

    expect(c.querySelector('article p')?.innerHTML).toBe(await emptyParagraphHtml());
  });

  it('renders the extended-props fixture: one picture, no chart', async () => {
    const buf = readFileSync(join(__dirname, 'fixtures/upstream/extended-props.docx'));
    const c = document.createElement('div');
    document.body.appendChild(c);
    await renderDocxInto(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), c);
    const all = Array.from(c.querySelectorAll('img'));

    // Baseline: one 649.7×366.5 image; the chart drew nothing.
    expect(all).toHaveLength(1);
    expect(all[0].src).toContain('image/jpeg');
    expect(all[0].width).toBe(650);
    expect(all[0].height).toBe(367);
    expect(all[0].alt).toBe('How a Random Image can help you to generate creative ideas');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../helpers/domShims';
import { buildDeck } from '../helpers/buildDeck';
import { editZip } from '../../docx/build-docx';
import { parseZip } from '../../../../../../src/tools/file/pptx/parser/ZipParser';
import { buildPresentation } from '../../../../../../src/tools/file/pptx/model/Presentation';
import { renderSlide } from '../../../../../../src/tools/file/pptx/renderer/SlideRenderer';

/**
 * A deck's table style id is put into the XML that builds a predefined Office
 * table style. Only an exact known id may get that far, so deck text can never
 * add markup to that XML.
 */

const escapeXml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

type StyleIdShape = (id: string) => string;

const asText: StyleIdShape = (id) => `<a:tableStyleId>${escapeXml(id)}</a:tableStyleId>`;
const asTableStyleIdVal: StyleIdShape = (id) => `<a:tableStyleId val="${escapeXml(id)}"/>`;
const asTblStyleVal: StyleIdShape = (id) => `<a:tblStyle val="${escapeXml(id)}"/>`;

const table = (tblPrChild: string): string => '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="20" name="Tbl"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
  + '<p:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></p:xfrm>'
  + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
  + `<a:tbl><a:tblPr firstRow="1">${tblPrChild}</a:tblPr><a:tblGrid><a:gridCol w="1828800"/></a:tblGrid><a:tr h="914400">`
  + '<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>c</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>'
  + '</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>';

const EMPTY_TABLE_STYLES = '<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>';

/** Renders a slide holding the table and returns every generated `<a:tblStyle` XML string. */
const generatedStyleParses = async (tblPrChild: string): Promise<string[]> => {
  const files = await parseZip(await editZip(await buildDeck([{ text: 'x' }]), {
    'ppt/slides/slide1.xml': (slide) => slide.replace('</p:spTree>', `${table(tblPrChild)}</p:spTree>`),
    // Without this part the renderer never looks up a predefined style.
    'ppt/tableStyles.xml': EMPTY_TABLE_STYLES,
  }));
  const presentation = buildPresentation(files);
  const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
  const handle = renderSlide(presentation, presentation.slides[0]);

  await handle.ready;
  handle.dispose();

  return parse.mock.calls
    .map(([xml]) => String(xml))
    .filter((xml) => xml.startsWith('<a:tblStyle '));
};

const MARKER = 'urn:pwn';

/**
 * Each case uses its own known id: the module caches a built style per id,
 * so a repeated id would never reach the parser again.
 */
const hostile: Array<[string, StyleIdShape, string]> = [
  ['tableStyleId text', asText, `{3C2FFA5D-87B4-456A-9821-1D502468CF0F}" xmlns:x="${MARKER}" x:pwn="1`],
  ['tableStyleId val', asTableStyleIdVal, `{284E427A-3D55-4303-BF80-6455036E1DE7}" xmlns:x="${MARKER}" x:pwn="1`],
  ['tblStyle val', asTblStyleVal, `{69C7853C-536D-4A76-A0AE-DD22124D55A5}" xmlns:x="${MARKER}" x:pwn="1`],
  ['tableStyleId text with a leading space', asText, ` {775DCB02-9BB8-47FD-8907-85C794F793BA}" xmlns:x="${MARKER}" x:pwn="1`],
];

describe('pptx table style id that tries to add markup to a generated table style', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('builds the predefined style for an exact known id', async () => {
    const id = '{2D5ABB26-0587-4C30-8999-92F81FD0307C}';
    const parses = await generatedStyleParses(asText(id));

    expect(parses).toHaveLength(1);
    expect(parses[0]).toContain(`styleId="${id}"`);
  });

  it.each(hostile)('never puts a near-miss id from %s into the generated XML', async (_name, shape, id) => {
    const parses = await generatedStyleParses(shape(id));

    expect(parses.filter((xml) => xml.includes(MARKER))).toEqual([]);
    expect(parses).toEqual([]);
  });
});

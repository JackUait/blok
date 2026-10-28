import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../helpers/domShims';
import { buildDeck } from '../helpers/buildDeck';
import { editZip } from '../../docx/build-docx';
import { xmlNode } from '../helpers/xmlNode';
import { createMockRenderContext } from '../helpers/mockContext';
import { parseZip } from '../../../../../../src/tools/file/pptx/parser/ZipParser';
import { buildPresentation } from '../../../../../../src/tools/file/pptx/model/Presentation';
import { parseTheme } from '../../../../../../src/tools/file/pptx/model/Theme';
import { renderSlide } from '../../../../../../src/tools/file/pptx/renderer/SlideRenderer';
import { resolveColor } from '../../../../../../src/tools/file/pptx/renderer/StyleResolver';

const HOST = 'evil.example';
/** Closes the CSS gradient early and adds an image layer that the browser would fetch. */
const breakout = `fff 0%, #000 100%), url(https://${HOST}/x.png), linear-gradient(#fff`;
const patternBreakout = `fff url(https://${HOST}/y.png)`;

const grad = (clr: string): string => '<a:gradFill><a:gsLst>'
  + `<a:gs pos="0">${clr}</a:gs><a:gs pos="100000"><a:srgbClr val="000000"/></a:gs>`
  + '</a:gsLst><a:lin ang="0"/></a:gradFill>';
const patt = (bgClr: string): string => '<a:pattFill prst="pct50"><a:fgClr><a:srgbClr val="000000"/></a:fgClr>'
  + `<a:bgClr>${bgClr}</a:bgClr></a:pattFill>`;

const shape = (fill: string, runFill = ''): string => '<p:sp><p:nvSpPr><p:cNvPr id="10" name="S"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>'
  + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}</p:spPr>`
  + `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="2400">${runFill}</a:rPr><a:t>T</a:t></a:r></a:p></p:txBody></p:sp>`;

const table = (tcPr: string): string => '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="20" name="Tbl"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
  + '<p:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></p:xfrm>'
  + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
  + '<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="1828800"/></a:tblGrid><a:tr h="914400">'
  + `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>c</a:t></a:r></a:p></a:txBody><a:tcPr>${tcPr}</a:tcPr></a:tc>`
  + '</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>';

interface Hostile {
  /** Added to the slide's shape tree. */
  tree?: string;
  /** Slide background fill. */
  background?: string;
  /** Replaces theme accent1. */
  accent1?: string;
}

/** Renders one slide of a deck carrying the hostile parts and returns its HTML. */
const renderHostile = async (hostile: Hostile): Promise<string> => {
  const bg = hostile.background === undefined ? '' : `<p:bg><p:bgPr>${hostile.background}<a:effectLst/></p:bgPr></p:bg>`;
  const edits: Record<string, (old: string) => string> = {
    'ppt/slides/slide1.xml': (slide) => slide
      .replace('<p:cSld>', `<p:cSld>${bg}`)
      .replace('</p:spTree>', `${hostile.tree ?? ''}</p:spTree>`),
  };

  if (hostile.accent1 !== undefined) {
    const accent1 = hostile.accent1;

    edits['ppt/theme/theme1.xml'] = (theme) => theme.replace('<a:srgbClr val="4F81BD"/>', accent1);
  }

  const files = await parseZip(await editZip(await buildDeck([{ text: 'x' }]), edits));
  const presentation = buildPresentation(files);
  const handle = renderSlide(presentation, presentation.slides[0]);

  await handle.ready;
  const html = handle.element.outerHTML;

  handle.dispose();

  return html;
};

describe('pptx colour values that try to break out of CSS', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([
    ['a table cell gradient', { tree: table(grad(`<a:srgbClr val="${breakout}"/>`)) }],
    ['a table cell pattern', { tree: table(patt(`<a:srgbClr val="${patternBreakout}"/>`)) }],
    ['a table cell gradient from sysClr lastClr', { tree: table(grad(`<a:sysClr val="window" lastClr="${breakout}"/>`)) }],
    ['a table cell gradient from a theme colour', { tree: table(grad('<a:schemeClr val="accent1"/>')), accent1: `<a:srgbClr val="${breakout}"/>` }],
    ['a table cell gradient from a theme sysClr', { tree: table(grad('<a:schemeClr val="accent1"/>')), accent1: `<a:sysClr val="window" lastClr="${breakout}"/>` }],
    ['a shape gradient', { tree: shape(grad(`<a:srgbClr val="${breakout}"/>`)) }],
    ['a shape pattern', { tree: shape(patt(`<a:srgbClr val="${patternBreakout}"/>`)) }],
    ['a slide background gradient', { background: grad(`<a:srgbClr val="${breakout}"/>`) }],
    ['a slide background pattern', { background: patt(`<a:srgbClr val="${patternBreakout}"/>`) }],
    ['a text run gradient', { tree: shape('', grad(`<a:srgbClr val="${breakout}"/>`)) }],
  ])('keeps a hostile colour in %s out of the page', async (_, hostile: Hostile) => {
    const html = await renderHostile(hostile);

    expect(html).not.toContain(HOST);
    expect(html).not.toMatch(/url\(\s*["']?https?:/);
  });

  it('reads a malformed srgbClr or sysClr value as black', () => {
    const ctx = createMockRenderContext();

    expect(resolveColor(xmlNode(`<solidFill><srgbClr val="${breakout}"/></solidFill>`), ctx).color).toBe('000000');
    expect(resolveColor(xmlNode(`<srgbClr val="${patternBreakout}"/>`), ctx).color).toBe('000000');
    expect(resolveColor(xmlNode(`<solidFill><sysClr val="window" lastClr="${breakout}"/></solidFill>`), ctx).color).toBe('000000');
    expect(resolveColor(xmlNode('<sysClr val="windowText"/>'), ctx).color).toBe('000000');
  });

  it('keeps an honest colour exactly as written', () => {
    const ctx = createMockRenderContext();

    expect(resolveColor(xmlNode('<solidFill><srgbClr val="1f497D"/></solidFill>'), ctx).color).toBe('1f497D');
    expect(resolveColor(xmlNode('<sysClr val="window" lastClr="FFFFFF"/>'), ctx).color).toBe('FFFFFF');
  });

  it('reads a malformed theme colour as black and keeps an honest one', () => {
    const theme = parseTheme(xmlNode('<theme><themeElements><clrScheme>'
      + `<dk1><sysClr val="windowText" lastClr="${breakout}"/></dk1>`
      + `<accent1><srgbClr val="${breakout}"/></accent1>`
      + '<accent2><srgbClr val="C0504D"/></accent2>'
      + '</clrScheme></themeElements></theme>'));

    expect(theme.colorScheme.get('dk1')).toBe('000000');
    expect(theme.colorScheme.get('accent1')).toBe('000000');
    expect(theme.colorScheme.get('accent2')).toBe('C0504D');
  });
});

// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseXml } from '../../../../../../src/tools/file/pptx/parser/XmlParser';
import type { PresentationData } from '../../../../../../src/tools/file/pptx/model/Presentation';
import type { SlideData } from '../../../../../../src/tools/file/pptx/model/Slide';
import type * as RenderableChildModule from '../../../../../../src/tools/file/pptx/model/RenderableChild';

vi.mock('../../../../../../src/tools/file/pptx/model/RenderableChild', async (importOriginal) => {
  const actual = await importOriginal<typeof RenderableChildModule>();
  return {
    ...actual,
    parseRenderableChildren: vi.fn(actual.parseRenderableChildren),
  };
});

const { renderSlide } = await import('../../../../../../src/tools/file/pptx/renderer/SlideRenderer');
const { parseRenderableChildren } = await import('../../../../../../src/tools/file/pptx/model/RenderableChild');

function makeMinimalPres(): PresentationData {
  const layoutPath = 'ppt/slideLayouts/slideLayout1.xml';
  const masterPath = 'ppt/slideMasters/slideMaster1.xml';
  const themePath = 'ppt/theme/theme1.xml';

  return {
    width: 960,
    height: 540,
    slides: [],
    layouts: new Map([
      [
        layoutPath,
        {
          placeholders: [],
          spTree: parseXml(`
            <p:spTree xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <p:sp>
                <p:nvSpPr><p:cNvPr id="201" name="layout-decoration"/><p:nvPr/></p:nvSpPr>
                <p:spPr>
                  <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                </p:spPr>
              </p:sp>
            </p:spTree>
          `),
          rels: new Map(),
          showMasterSp: true,
        },
      ],
    ]),
    masters: new Map([
      [
        masterPath,
        {
          colorMap: new Map(),
          textStyles: {},
          placeholders: [],
          spTree: parseXml(`
            <p:spTree xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <p:sp>
                <p:nvSpPr><p:cNvPr id="101" name="master-decoration"/><p:nvPr/></p:nvSpPr>
                <p:spPr>
                  <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                </p:spPr>
              </p:sp>
            </p:spTree>
          `),
          rels: new Map(),
        },
      ],
    ]),
    themes: new Map([
      [
        themePath,
        {
          colorScheme: new Map(),
          majorFont: { latin: 'Calibri', ea: '', cs: '' },
          minorFont: { latin: 'Calibri', ea: '', cs: '' },
          fillStyles: [],
          lineStyles: [],
          effectStyles: [],
        },
      ],
    ]),
    slideToLayout: new Map([[0, layoutPath]]),
    layoutToMaster: new Map([[layoutPath, masterPath]]),
    masterToTheme: new Map([[masterPath, themePath]]),
    media: new Map(),
    charts: new Map(),
    isWps: false,
  };
}

describe('renderSlide template shape cache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseRenderableChildren).mockClear();
  });

  it('parses reusable master/layout template shapes once across repeated slide renders', () => {
    const pres = makeMinimalPres();
    const slide: SlideData = {
      index: 0,
      layoutIndex: '',
      slidePath: '',
      nodes: [],
      rels: new Map(),
      showMasterSp: true,
    };

    const first = renderSlide(pres, slide);
    first.dispose();

    const second = renderSlide(pres, slide);
    second.dispose();

    expect(parseRenderableChildren).toHaveBeenCalledTimes(2);
  });
});

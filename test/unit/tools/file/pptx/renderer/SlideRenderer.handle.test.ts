// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/domShims';
import { renderSlide } from '../../../../../../src/tools/file/pptx/renderer/SlideRenderer';
import { SafeXmlNode } from '../../../../../../src/tools/file/pptx/parser/XmlParser';
import type { PresentationData } from '../../../../../../src/tools/file/pptx/model/Presentation';
import type { SlideData } from '../../../../../../src/tools/file/pptx/model/Slide';
import { xmlNode } from '../helpers/xmlNode';

const emptyXml = new SafeXmlNode(null);

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
          spTree: emptyXml,
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
          spTree: emptyXml,
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

function makeSlide(): SlideData {
  return {
    index: 0,
    layoutIndex: '',
    slidePath: '',
    nodes: [],
    rels: new Map(),
    showMasterSp: true,
  };
}

describe('SlideHandle lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a SlideHandle with element and dispose', () => {
    const pres = makeMinimalPres();
    const handle = renderSlide(pres, makeSlide());

    expect(handle.element).toBeInstanceOf(HTMLElement);
    expect(typeof handle.dispose).toBe('function');
  });

  it('standalone mode: dispose() revokes blob URLs from its own cache', () => {
    const revokeStub = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const pres = makeMinimalPres();

    // No shared mediaUrlCache → standalone mode
    const handle = renderSlide(pres, makeSlide());

    // Inject fake blob URLs into the internal cache via the render context
    // We can't directly access the cache, but we can verify the mechanism
    // by checking that dispose doesn't throw
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow(); // idempotent
    revokeStub.mockRestore();
  });

  it('shared cache mode: dispose() does NOT revoke shared blob URLs', () => {
    const revokeStub = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const pres = makeMinimalPres();
    const sharedCache = new Map<string, string>();
    sharedCache.set('img1', 'blob:http://localhost/shared-1');

    const handle = renderSlide(pres, makeSlide(), { mediaUrlCache: sharedCache });
    handle.dispose();

    // Shared cache blob URLs should NOT be revoked
    expect(revokeStub).not.toHaveBeenCalled();
    expect(sharedCache.size).toBe(1); // still intact
    revokeStub.mockRestore();
  });

  it('dispose() is idempotent — double-dispose is safe', () => {
    const pres = makeMinimalPres();
    const handle = renderSlide(pres, makeSlide());

    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
  });

  it('dispose revokes the picture URLs of a standalone slide', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const pres = makeMinimalPres();
    pres.media.set('ppt/media/image1.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const slide = makeSlide();
    slide.rels.set('rId1', { type: 'image', target: 'ppt/media/image1.png' });
    slide.nodes = [
      {
        id: '1',
        name: 'Picture',
        nodeType: 'picture',
        position: { x: 0, y: 0 },
        size: { w: 100, h: 80 },
        rotation: 0,
        flipH: false,
        flipV: false,
        blipEmbed: 'rId1',
        source: xmlNode('<pic/>'),
      },
    ];

    const handle = renderSlide(pres, slide);
    const src = handle.element.querySelector('img')?.getAttribute('src');
    expect(src).toMatch(/^blob:/);

    handle.dispose();
    expect(revokeSpy).toHaveBeenCalledWith(src);
  });
});

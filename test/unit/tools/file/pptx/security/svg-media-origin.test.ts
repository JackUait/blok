import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../helpers/domShims';
import { buildDeck } from '../helpers/buildDeck';
import { editZip } from '../../docx/build-docx';
import { parseZip, RECOMMENDED_ZIP_LIMITS } from '../../../../../../src/tools/file/pptx/parser/ZipParser';
import { buildPresentation } from '../../../../../../src/tools/file/pptx/model/Presentation';
import { renderSlide } from '../../../../../../src/tools/file/pptx/renderer/SlideRenderer';

/**
 * A blob: URL has the editor's origin. An SVG blob opened in its own tab
 * ("Open image in new tab") would run the SVG's scripts there, so a deck's
 * SVG must never become a blob of a type the browser renders as a document.
 */

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>';

const svgDeck = async (): Promise<ArrayBuffer> => editZip(await buildDeck([{ text: 'x', picture: true }]), {
  'ppt/slides/_rels/slide1.xml.rels': (old) => old.replace('../media/image1.png', '../media/image1.svg'),
  'ppt/media/image1.svg': SVG,
});

describe('a pptx picture stored as SVG', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never becomes a same-origin image/svg+xml blob, and still shows', async () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    const presentation = buildPresentation(await parseZip(await svgDeck(), RECOMMENDED_ZIP_LIMITS));
    const handle = renderSlide(presentation, presentation.slides[0], { mediaUrlCache: new Map() });

    await handle.ready;

    const blobTypes = create.mock.calls.map(([object]) => (object instanceof Blob ? object.type : 'not a blob'));

    expect(blobTypes).not.toContain('image/svg+xml');

    const sources = Array.from(handle.element.querySelectorAll('img')).map((img) => img.getAttribute('src') ?? '');

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatch(/^data:image\/svg\+xml;base64,/);
    handle.dispose();
  });
});

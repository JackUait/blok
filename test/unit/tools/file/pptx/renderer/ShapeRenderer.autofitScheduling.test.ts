// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseShapeNode } from '../../../../../../src/tools/file/pptx/model/nodes/ShapeNode';
import { parseXml } from '../../../../../../src/tools/file/pptx/parser/XmlParser';
import { renderShape } from '../../../../../../src/tools/file/pptx/renderer/ShapeRenderer';
import { createMockRenderContext } from '../helpers/mockContext';

const originalFontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');

function makeSpAutoFitShapeXml(): string {
  return `
    <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:nvSpPr>
        <p:cNvPr id="501" name="Loaded Font Shape"/>
        <p:cNvSpPr/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr>
        <a:lstStyle/>
        <a:p><a:r><a:rPr sz="1800"/><a:t>Loaded font autofit text</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>
  `;
}

describe('renderShape dynamic autofit scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalFontsDescriptor) {
      Object.defineProperty(document, 'fonts', originalFontsDescriptor);
    } else {
      Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('does not schedule an extra font-ready autofit pass when fonts are already loaded', async () => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        status: 'loaded',
        ready: Promise.resolve(),
      },
    });

    const requestAnimationFrameSpy = vi.fn((cb: FrameRequestCallback): number => {
      cb(0);
      return requestAnimationFrameSpy.mock.calls.length;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameSpy);

    renderShape(parseShapeNode(parseXml(makeSpAutoFitShapeXml())), createMockRenderContext());
    await Promise.resolve();

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(2);
  });
});

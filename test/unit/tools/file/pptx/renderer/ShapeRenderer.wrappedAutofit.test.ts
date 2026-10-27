// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseXml } from '../../../../../../src/tools/file/pptx/parser/XmlParser';
import { parseShapeNode } from '../../../../../../src/tools/file/pptx/model/nodes/ShapeNode';
import { renderShape } from '../../../../../../src/tools/file/pptx/renderer/ShapeRenderer';
import { createMockRenderContext } from '../helpers/mockContext';

function wrappedNormAutofitShapeXml(): string {
  return `
    <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:nvSpPr><p:cNvPr id="710" name="Wrapped Autofit"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="square"><a:normAutofit fontScale="100000"/></a:bodyPr>
        <a:lstStyle/>
        <a:p><a:r><a:rPr sz="2000"/><a:t>Wrapped text that needs height shrink only.</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>
  `;
}

function findTextContainer(el: HTMLElement): HTMLElement | undefined {
  return Array.from(el.querySelectorAll('div')).find(
    (div) =>
      div.textContent?.includes('Wrapped text') && div.style.flexDirection === 'column',
  );
}

describe('renderShape wrapped normAutofit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shrinks wrapped text by height instead of unwrapped line width', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    // Wrapped lines fit the width but need two lines of height: width 100 fits,
    // while the wrapped height (150) overflows the 100px box. The unwrapped
    // single line would be 500px wide and must not drive the scale.
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 100 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 100 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        return this.style.whiteSpace === 'nowrap' ? 500 : 100;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        return this.style.whiteSpace === 'nowrap' ? 50 : 150;
      });

    try {
      const el = renderShape(
        parseShapeNode(parseXml(wrappedNormAutofitShapeXml())),
        createMockRenderContext(),
      );
      const textContainer = findTextContainer(el);

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).toContain('scale(0.666');
      expect(textContainer!.style.whiteSpace).not.toBe('nowrap');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('still shrinks single-line overflow by width when wrapping cannot fit', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 100 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 100 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 200 : 0;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 100 : 0;
      });

    try {
      const el = renderShape(
        parseShapeNode(parseXml(wrappedNormAutofitShapeXml())),
        createMockRenderContext(),
      );
      const textContainer = findTextContainer(el);

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).toBe('scale(0.5)');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });
});

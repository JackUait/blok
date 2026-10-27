// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { parseXml } from '../../../../../../src/tools/file/pptx/parser/XmlParser';
import { parseShapeNode } from '../../../../../../src/tools/file/pptx/model/nodes/ShapeNode';
import { renderShape } from '../../../../../../src/tools/file/pptx/renderer/ShapeRenderer';
import { createMockRenderContext } from '../helpers/mockContext';

export function textShapeXml(
  body = '<a:bodyPr><a:noAutofit/></a:bodyPr>',
  paragraph = '',
  list = '',
  style = '',
  runs = '<a:r><a:rPr sz="2400"/><a:t>Alpha beta gamma delta epsilon</a:t></a:r>',
  extent = { cx: 1524000, cy: 762000 },
): string {
  return `<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvSpPr><p:cNvPr id="2" name="Text coverage"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${extent.cx}" cy="${extent.cy}"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>${style}<p:txBody>${body}<a:lstStyle>${list}</a:lstStyle><a:p><a:pPr>${paragraph}</a:pPr>${runs}</a:p></p:txBody></p:sp>`;
}

export function renderTextFixture(
  body?: string,
  paragraph?: string,
  list?: string,
  style?: string,
  runs?: string,
  inheritedBody?: string,
  extent?: { cx: number; cy: number },
) {
  const node = parseShapeNode(parseXml(textShapeXml(body, paragraph, list, style, runs, extent)));
  if (inheritedBody) node.textBody!.layoutBodyProperties = parseXml(inheritedBody);
  const ctx = createMockRenderContext();
  const element = renderShape(node, ctx);
  const span = Array.from(element.querySelectorAll('span')).find((s) =>
    s.textContent?.includes('Alpha'),
  )!;
  const para = span.closest('div')!;
  return { element, span, para, container: para.parentElement!, ctx, node };
}

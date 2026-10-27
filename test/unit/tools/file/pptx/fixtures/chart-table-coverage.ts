// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
// Table half only: the chart fixtures belong with the chart renderer.
import { parseXml } from '../../../../../../src/tools/file/pptx/parser/XmlParser';
import { renderTable } from '../../../../../../src/tools/file/pptx/renderer/TableRenderer';
import { parseTableNode } from '../../../../../../src/tools/file/pptx/model/nodes/TableNode';
import { createMockRenderContext } from '../helpers/mockContext';

export function borderXml(side: string, color: string, width = 38100) {
  return `<a:${side}><a:ln w="${width}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></a:${side}>`;
}

export function tableFixture(
  styles: string,
  flags = '',
  rows = ['<a:tc/><a:tc/>', '<a:tc/><a:tc/>'],
  cols = 2,
) {
  const ctx = createMockRenderContext();
  ctx.presentation.tableStyles = parseXml(
    `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:tblStyle styleId="coverage">${styles}</a:tblStyle></a:tblStyleLst>`,
  );
  const frame = parseXml(
    `<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:xfrm><a:off x="0" y="0"/><a:ext cx="3810000" cy="1905000"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblPr ${flags}><a:tableStyleId>coverage</a:tableStyleId></a:tblPr><a:tblGrid>${Array(cols).fill('<a:gridCol w="1905000"/>').join('')}</a:tblGrid>${rows.map((row) => `<a:tr h="952500">${row}</a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
  );
  const node = parseTableNode(frame);
  return renderTable(node, ctx);
}

export function cornerStyles() {
  return [
    ['wholeTbl', 'FFFFFF'],
    ['firstRow', 'AAAAAA'],
    ['lastRow', 'BBBBBB'],
    ['firstCol', 'CCCCCC'],
    ['lastCol', 'DDDDDD'],
    ['nwCell', 'FF0000'],
    ['neCell', '00FF00'],
    ['swCell', '0000FF'],
    ['seCell', 'FFFF00'],
  ]
    .map(
      ([section, color]) =>
        `<a:${section}><a:tcStyle><a:fill><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:fill></a:tcStyle></a:${section}>`,
    )
    .join('');
}

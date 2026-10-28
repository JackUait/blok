import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseBaseProps } from '../../../../../../src/tools/file/pptx/model/nodes/BaseNode';
import { xmlNode } from '../helpers/xmlNode';
import { createMockRenderContext } from '../helpers/mockContext';
import { renderChart } from '../../../../../../src/tools/file/pptx/renderer/ChartRenderer';
import { parseXml, SafeXmlNode } from '../../../../../../src/tools/file/pptx/parser/XmlParser';
import { chartXml, ser } from '../renderer/chart/chartXml';

describe('a pptx shape whose numbers are infinite', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('falls back to the default instead of carrying Infinity into the slide', () => {
    const sp = xmlNode(
      '<sp><spPr><xfrm rot="1e400"><off x="Infinity" y="-Infinity"/><ext cx="1e400" cy="NaN"/></xfrm></spPr></sp>'
    );

    const props = parseBaseProps(sp);

    expect(props.position).toEqual({ x: 0, y: 0 });
    expect(props.size).toEqual({ w: 0, h: 0 });
    expect(props.rotation).toBe(0);
  });

  it('still reads ordinary numbers, including negative and exponent forms', () => {
    const node = xmlNode('<off x="-914400" y="9.144e5"/>');

    expect(node.numAttr('x')).toBe(-914400);
    expect(node.numAttr('y')).toBe(914400);
  });

  it('draws a chart whose cached value is infinite without Infinity or NaN in the SVG', () => {
    const ctx = createMockRenderContext();
    const xml = chartXml(`<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${ser({ cats: ['a', 'b', 'c'], vals: [1, 2, 3] })}</c:barChart>`)
      .replace('<c:v>2</c:v>', '<c:v>1e400</c:v>');

    ctx.presentation.charts.set('ppt/charts/chart1.xml', parseXml(xml));
    const frame = renderChart({
      id: '1', name: 'Chart', nodeType: 'chart', chartPath: 'ppt/charts/chart1.xml',
      position: { x: 0, y: 0 }, size: { w: 400, h: 300 }, rotation: 0, flipH: false, flipV: false,
      source: new SafeXmlNode(null),
    }, ctx);

    expect(frame.innerHTML).not.toMatch(/Infinity|NaN/);
    expect(frame.querySelectorAll('[data-pptx-chart="series"] rect').length).toBeGreaterThan(0);
  });
});


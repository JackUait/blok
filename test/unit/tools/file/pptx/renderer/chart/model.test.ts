import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readChart } from '../../../../../../../src/tools/file/pptx/renderer/chart/model';
import { parseXml } from '../../../../../../../src/tools/file/pptx/parser/XmlParser';
import { applyLumMod } from '../../../../../../../src/tools/file/pptx/utils/color';
import { createMockRenderContext } from '../../helpers/mockContext';
import { chartXml, ser } from './chartXml';

const ctx = createMockRenderContext();

describe('readChart', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('reads a horizontal stacked bar chart with series in c:order order', () => {
    const model = readChart(parseXml(chartXml(`<c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/>
      ${ser({ name: 'Second', order: 1, cats: ['A', 'B'], vals: [3, 4] })}
      ${ser({ name: 'First', order: 0, cats: ['A', 'B'], vals: [1, 2] })}
      <c:gapWidth val="80"/><c:overlap val="100"/></c:barChart>`)), ctx);

    expect(model.kind).toBe('bar');
    expect(model.horizontal).toBe(true);
    expect(model.grouping).toBe('stacked');
    expect(model.gapWidth).toBe(80);
    expect(model.series.map((s) => s.name)).toEqual(['First', 'Second']);
    expect(model.series[0].values).toEqual([1, 2]);
    expect(model.categories).toEqual(['A', 'B']);
  });

  it('draws 3D plots as their 2D twins', () => {
    const kindOf = (el: string): string =>
      readChart(parseXml(chartXml(`<c:${el}>${ser({ vals: [1] })}</c:${el}>`)), ctx).kind;

    expect(kindOf('bar3DChart')).toBe('bar');
    expect(kindOf('line3DChart')).toBe('line');
    expect(kindOf('area3DChart')).toBe('area');
    expect(kindOf('pie3DChart')).toBe('pie');
    expect(kindOf('doughnutChart')).toBe('doughnut');
    expect(kindOf('scatterChart')).toBe('scatter');
  });

  it('marks radar, bubble and combo plots unsupported', () => {
    const one = `<c:radarChart>${ser({ vals: [1] })}</c:radarChart>`;
    const combo = `<c:barChart>${ser({ vals: [1] })}</c:barChart><c:lineChart>${ser({ vals: [1] })}</c:lineChart>`;

    expect(readChart(parseXml(chartXml(one)), ctx).kind).toBe('unsupported');
    expect(readChart(parseXml(chartXml(`<c:bubbleChart>${ser({ vals: [1] })}</c:bubbleChart>`)), ctx).kind).toBe('unsupported');
    expect(readChart(parseXml(chartXml(combo)), ctx).kind).toBe('unsupported');
  });

  it('colours series from c:spPr, else the theme accent cycle', () => {
    const model = readChart(parseXml(chartXml(`<c:lineChart>
      ${ser({ order: 0, vals: [1], spPr: '<a:solidFill><a:srgbClr val="112233"/></a:solidFill>' })}
      ${ser({ order: 1, vals: [1], spPr: '<a:ln><a:solidFill><a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr></a:solidFill></a:ln>' })}
      ${[2, 3, 4, 5, 6, 7].map((order) => ser({ order, vals: [1] })).join('')}
      </c:lineChart>`)), ctx);

    expect(model.series.map((s) => s.color.toLowerCase())).toEqual([
      '#112233',
      `#${applyLumMod('ED7D31', 75000).replace('#', '')}`.toLowerCase(),
      '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#4472c4', '#ed7d31',
    ]);
  });

  it('takes the palette from a chart colour style part when there is one', () => {
    const styled = createMockRenderContext();
    styled.presentation.chartColorStyles = new Map([['ppt/charts/chart1.xml', parseXml(
      `<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:schemeClr val="accent6"/><a:srgbClr val="00FF00"/></cs:colorStyle>`)]]);
    const model = readChart(parseXml(chartXml(`<c:barChart>${ser({ order: 0, vals: [1] })}${ser({ order: 1, vals: [1] })}${ser({ order: 2, vals: [1] })}</c:barChart>`)), styled, 'ppt/charts/chart1.xml');

    expect(model.series.map((s) => s.color.toLowerCase())).toEqual(['#70ad47', '#00ff00', '#70ad47']);
  });

  it('varies colours by point for one bar series and for pies', () => {
    const bar = readChart(parseXml(chartXml(`<c:barChart>${ser({ cats: ['a', 'b'], vals: [1, 2] })}</c:barChart>`)), ctx);
    const pie = readChart(parseXml(chartXml(`<c:pieChart><c:varyColors val="1"/>${ser({ cats: ['a', 'b'], vals: [1, 2],
      dPt: '<c:dPt><c:idx val="1"/><c:spPr><a:solidFill><a:srgbClr val="010203"/></a:solidFill></c:spPr></c:dPt>' })}</c:pieChart>`)), ctx);

    expect(bar.varyColors).toBe(true);
    expect(bar.series[0].pointColors.map((c) => c.toLowerCase())).toEqual(['#4472c4', '#ed7d31']);
    expect(pie.series[0].pointColors.map((c) => c.toLowerCase())).toEqual(['#4472c4', '#010203']);
  });

  it('keeps one colour for several bar series', () => {
    const model = readChart(parseXml(chartXml(`<c:barChart>${ser({ order: 0, vals: [1, 2] })}${ser({ order: 1, vals: [1, 2] })}</c:barChart>`)), ctx);

    expect(model.varyColors).toBe(false);
  });

  it('reads the title text, or the series name as Office auto title', () => {
    const titled = `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Sales </a:t></a:r><a:r><a:t>2024</a:t></a:r></a:p></c:rich></c:tx></c:title>`;
    const read = (head: string, body: string): string | undefined =>
      readChart(parseXml(chartXml(body, { head })), ctx).title?.text;

    expect(read(titled, `<c:barChart>${ser({ vals: [1] })}</c:barChart>`)).toBe('Sales 2024');
    expect(read('<c:autoTitleDeleted val="0"/>', `<c:pieChart>${ser({ name: 'Share', vals: [1] })}</c:pieChart>`)).toBe('Share');
    expect(read('<c:autoTitleDeleted val="1"/>', `<c:pieChart>${ser({ name: 'Share', vals: [1] })}</c:pieChart>`)).toBeUndefined();
    expect(read('<c:autoTitleDeleted val="0"/>', `<c:barChart>${ser({ name: 'a', order: 0, vals: [1] })}${ser({ name: 'b', order: 1, vals: [1] })}</c:barChart>`)).toBeUndefined();
  });

  it('reads the legend position, defaulting to the right', () => {
    const at = (legend: string): string | undefined =>
      readChart(parseXml(chartXml(`<c:barChart>${ser({ vals: [1] })}</c:barChart>`, { tail: legend })), ctx).legend?.position;

    expect(at('<c:legend/>')).toBe('r');
    expect(at('<c:legend><c:legendPos val="t"/></c:legend>')).toBe('t');
    expect(at('')).toBeUndefined();
  });

  it('reads the axes: scaling, major unit, number format, gridlines and deletion', () => {
    const model = readChart(parseXml(chartXml(`<c:barChart>${ser({ vals: [1] })}<c:axId val="1"/><c:axId val="2"/></c:barChart>
      <c:catAx><c:axId val="1"/><c:delete val="1"/><c:axPos val="b"/></c:catAx>
      <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/><c:max val="90"/><c:min val="-10"/></c:scaling>
        <c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="0%" sourceLinked="0"/><c:majorUnit val="20"/></c:valAx>`)), ctx);

    expect(model.categoryAxis.deleted).toBe(true);
    expect(model.valueAxis).toMatchObject({ deleted: false, min: -10, max: 90, major: 20, numFmt: '0%', gridlines: true });
  });

  it('draws implicit axis lines black on Office 2007 themes and gray otherwise', () => {
    const legacy = createMockRenderContext();
    legacy.theme.colorScheme.set('accent1', '4F81BD');
    legacy.theme.colorScheme.set('accent2', 'C0504D');
    const xml = chartXml(`<c:barChart>${ser({ vals: [1] })}</c:barChart><c:catAx/><c:valAx><c:majorGridlines/></c:valAx>`);

    expect(readChart(parseXml(xml), legacy).valueAxis.gridColor.toLowerCase()).toBe('#000000');
    expect(readChart(parseXml(xml), ctx).valueAxis.lineColor.toLowerCase()).toBe('#898989');
  });

  it('lets series data labels override the plot-level ones', () => {
    const model = readChart(parseXml(chartXml(`<c:barChart>
      ${ser({ order: 0, vals: [1], dLbls: '<c:dLbls><c:numFmt formatCode="0.0" sourceLinked="0"/><c:showVal val="1"/><c:showPercent val="0"/></c:dLbls>' })}
      ${ser({ order: 1, vals: [1] })}
      ${ser({ order: 2, vals: [1], dLbls: '<c:dLbls><c:delete val="1"/></c:dLbls>' })}
      <c:dLbls><c:showVal val="0"/><c:showPercent val="1"/></c:dLbls></c:barChart>`)), ctx);

    expect(model.series[0].labels).toMatchObject({ showVal: true, showPercent: false, formatCode: '0.0' });
    expect(model.series[1].labels).toMatchObject({ showVal: false, showPercent: true });
    expect(model.series[2].labels).toMatchObject({ showVal: false, showPercent: false });
  });

  it('shows line markers unless the series says none', () => {
    const model = readChart(parseXml(chartXml(`<c:lineChart><c:grouping val="standard"/>
      ${ser({ order: 0, vals: [1] })}
      ${ser({ order: 1, vals: [1], marker: '<c:marker><c:symbol val="none"/></c:marker>' })}
      ${ser({ order: 2, vals: [1], marker: '<c:marker><c:symbol val="circle"/><c:size val="10"/></c:marker>' })}
      <c:marker val="1"/></c:lineChart>`)), ctx);

    expect(model.series[0].marker?.symbol).toBe('diamond');
    expect(model.series[1].marker).toBeUndefined();
    expect(model.series[2].marker).toMatchObject({ symbol: 'circle' });
    expect(model.series[2].marker?.size).toBeCloseTo(13.333, 2);
  });

  it('reads scatter x values, hidden lines and smoothing', () => {
    const model = readChart(parseXml(chartXml(`<c:scatterChart><c:scatterStyle val="lineMarker"/>
      ${ser({ order: 0, xs: [1, 2], vals: [3, 4], spPr: '<a:ln><a:noFill/></a:ln>' })}
      ${ser({ order: 1, xs: [1, 2], vals: [3, 4], extra: '<c:smooth val="1"/>' })}
      </c:scatterChart>`)), ctx);

    expect(model.series[0].xValues).toEqual([1, 2]);
    expect(model.series[0].noLine).toBe(true);
    expect(model.series[1]).toMatchObject({ noLine: false, smooth: true });
  });

  it('reads doughnut hole size, first slice angle and explosion', () => {
    const model = readChart(parseXml(chartXml(`<c:doughnutChart>${ser({ cats: ['a', 'b'], vals: [1, 2], extra: '<c:explosion val="10"/>',
      dPt: '<c:dPt><c:idx val="1"/><c:explosion val="25"/></c:dPt>' })}
      <c:firstSliceAng val="90"/><c:holeSize val="60"/></c:doughnutChart>`)), ctx);

    expect(model.holeSize).toBe(60);
    expect(model.firstSliceAngle).toBe(90);
    expect(model.series[0].explosion).toEqual([10, 25]);
  });

  it('reads the chart font size from c:txPr, defaulting to 10pt', () => {
    const big = chartXml(`<c:barChart>${ser({ vals: [1] })}</c:barChart>`, { txPr: '<c:txPr><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1800"/></a:pPr></a:p></c:txPr>' });

    expect(readChart(parseXml(big), ctx).text.size).toBe(24);
    expect(readChart(parseXml(chartXml(`<c:barChart>${ser({ vals: [1] })}</c:barChart>`)), ctx).text.size).toBeCloseTo(13.333, 2);
  });

  it('returns an unsupported empty model for a part without a plot area', () => {
    expect(readChart(parseXml('<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>'), ctx))
      .toMatchObject({ kind: 'unsupported', series: [] });
  });
});

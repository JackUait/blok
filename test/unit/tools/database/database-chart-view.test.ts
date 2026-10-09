import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DatabaseChartView } from '../../../../src/tools/database/database-chart-view';
import type { ChartViewOptions } from '../../../../src/tools/database/database-chart-view';
import type { ChartData, ChartPoint } from '../../../../src/tools/database/chart-data';
import { resolveChartSettings } from '../../../../src/tools/database/chart-settings';
import * as tooltip from '../../../../src/components/utils/tooltip';

vi.mock('../../../../src/components/utils/tooltip', () => ({ show: vi.fn(), hide: vi.fn() }));
import type { DatabaseViewConfig } from '../../../../src/tools/database/types';

const point = (key: string, value: number, values: Record<string, number> = {}): ChartPoint => ({
  key,
  label: key.toUpperCase(),
  value,
  values,
  rowIds: [`row-${key}`],
  hidden: false,
});

const data = (overrides: Partial<ChartData> = {}): ChartData => ({
  points: [point('a', 2), point('b', 5), point('c', 1)],
  series: [],
  stacked: true,
  max: 5,
  total: 8,
  truncated: false,
  ...overrides,
});

const chartView = (fields: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1', name: 'Chart', type: 'chart', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...fields,
});

const handlers = { drilldown: vi.fn(), toggle: vi.fn() };

const render = (fields: Partial<DatabaseViewConfig> = {}, input: ChartData = data()): HTMLElement => {
  const options: ChartViewOptions = {
    settings: resolveChartSettings(chartView(fields), []),
    data: input,
    xName: 'Status',
    yName: 'Count',
    i18n: { t: (key: string, vars?: Record<string, string | number>) => (vars === undefined ? key : `${key} ${JSON.stringify(vars)}`) },
    formatValue: (n) => String(n),
    handlers,
  };
  const el = new DatabaseChartView(options).createView();

  document.body.appendChild(el);

  return el;
};

const marks = (el: HTMLElement): Element[] => [...el.querySelectorAll('[data-blok-database-chart-mark]')];

describe('DatabaseChartView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws one column per group in an accessible svg', () => {
    const el = render();
    const svg = el.querySelector('svg');

    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toContain('Status');
    expect(marks(el).map((m) => m.getAttribute('data-key'))).toEqual(['a', 'b', 'c']);
  });

  it('opens a drilldown when a group is clicked, and from the keyboard', () => {
    const el = render();
    const hit = el.querySelector<SVGElement>('[data-blok-database-chart-hit][data-key="b"]');

    hit?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handlers.drilldown).toHaveBeenCalledWith(expect.objectContaining({ key: 'b' }), undefined);

    hit?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(handlers.drilldown).toHaveBeenCalledTimes(2);
    expect(hit?.getAttribute('aria-label')).toContain('B');
  });

  it('asks tooltip.ts for a delayed hint on hover, anchored on the hovered mark, and hides it on leave', () => {
    const el = render();
    const hit = el.querySelector<SVGElement>('[data-blok-database-chart-hit][data-key="b"]');

    hit?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(tooltip.show).toHaveBeenCalledTimes(1);
    const [anchor, content, options] = vi.mocked(tooltip.show).mock.calls[0];

    expect(anchor).toBeInstanceOf(HTMLElement);
    expect((anchor as HTMLElement).hasAttribute('data-blok-database-chart-anchor')).toBe(true);
    expect((content as HTMLElement).textContent).toContain('B');
    expect((content as HTMLElement).textContent).toContain('5');
    expect(options?.delay).toBeUndefined();

    hit?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tooltip.hide).toHaveBeenCalledTimes(1);
  });

  it('never asks for a hint on focus', () => {
    const el = render();

    el.querySelector<SVGElement>('[data-blok-database-chart-hit][data-key="b"]')?.dispatchEvent(new FocusEvent('focus'));
    expect(tooltip.show).not.toHaveBeenCalled();
  });

  it('has no legend for one series', () => {
    expect(render().querySelector('[data-blok-database-chart-legend]')).toBeNull();
  });

  it('lists each series in the legend; a click toggles it and the button reads pressed', () => {
    const input = data({
      series: [{ key: 's1', label: 'One', hidden: false }, { key: 's2', label: 'Two', hidden: true }],
      points: [point('a', 3, { s1: 1, s2: 2 })],
    });
    const el = render({}, input);
    const entries = [...el.querySelectorAll<HTMLButtonElement>('[data-blok-database-chart-legend-entry]')];

    expect(entries.map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['One', 'true'], ['Two', 'false']]);
    entries[1].click();
    expect(handlers.toggle).toHaveBeenCalledWith('s2');
    expect(marks(el).filter((m) => m.getAttribute('data-series') === 's2')).toHaveLength(0);
  });

  it('puts the legend where the view says, or nowhere', () => {
    const input = data({ series: [{ key: 's1', label: 'One', hidden: false }, { key: 's2', label: 'Two', hidden: false }], points: [point('a', 3, { s1: 1, s2: 2 })] });

    expect(render({ chartLegend: 'side' }, input).getAttribute('data-legend')).toBe('side');
    expect(render({ chartLegend: 'off' }, input).querySelector('[data-blok-database-chart-legend]')).toBeNull();
  });

  it('draws horizontal bars', () => {
    const el = render({ chartType: 'bar' });

    expect(el.getAttribute('data-chart-type')).toBe('bar');
    expect(marks(el)).toHaveLength(3);
  });

  it('draws a line with a marker per point and an area when gradient is on', () => {
    const el = render({ chartType: 'line', chartGradient: true, chartSmooth: true });

    expect(el.querySelectorAll('[data-blok-database-chart-line]')).toHaveLength(1);
    expect(el.querySelectorAll('[data-blok-database-chart-area]')).toHaveLength(1);
    expect(marks(el)).toHaveLength(3);
  });

  it('draws a donut slice per group, with the total in the center unless turned off', () => {
    const el = render({ chartType: 'donut' });

    expect(marks(el)).toHaveLength(3);
    expect(el.querySelector('[data-blok-database-chart-center]')?.textContent).toBe('8');
    expect(render({ chartType: 'donut', chartCenterValue: false }).querySelector('[data-blok-database-chart-center]')).toBeNull();
  });

  it('lists every donut slice in the legend', () => {
    expect(render({ chartType: 'donut' }).querySelectorAll('[data-blok-database-chart-legend-entry]')).toHaveLength(3);
  });

  it('shows one big number for the number chart', () => {
    const el = render({ chartType: 'number' });

    expect(el.querySelector('[data-blok-database-chart-number]')?.textContent).toBe('8');
    expect(el.querySelector('svg')).toBeNull();
  });

  it('draws grid lines only when asked', () => {
    expect(render({ chartGridLines: 'none' }).querySelectorAll('[data-blok-database-chart-grid]')).toHaveLength(0);
    expect(render({ chartGridLines: 'horizontal' }).querySelectorAll('[data-blok-database-chart-grid]').length).toBeGreaterThan(0);
  });

  it('names the axes and labels the values when asked', () => {
    const el = render({ chartAxisNames: true, chartDataLabels: true });

    expect([...el.querySelectorAll('[data-blok-database-chart-axis-name]')].map((n) => n.textContent)).toEqual(['Status', 'Count']);
    expect([...el.querySelectorAll('[data-blok-database-chart-data-label]')].map((n) => n.textContent)).toEqual(['2', '5', '1']);
  });

  it('says so when there is nothing to draw', () => {
    const el = render({}, data({ points: [], max: 0, total: 0 }));

    expect(el.querySelector('[data-blok-database-chart-empty]')?.textContent).toBe('tools.database.chartEmpty');
  });

  it('notes when groups past the limit are left out', () => {
    expect(render({}, data({ truncated: true })).querySelector('[data-blok-database-chart-truncated]')).not.toBeNull();
  });

  it('exports a standalone svg with its colors resolved', () => {
    const view = new DatabaseChartView({
      settings: resolveChartSettings(chartView(), []),
      data: data(),
      xName: 'Status',
      yName: 'Count',
      i18n: { t: (key: string) => key },
      formatValue: (n) => String(n),
      handlers,
    });

    document.body.appendChild(view.createView());
    const svg = view.toSvgString();

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).not.toContain('var(--');
    expect(svg).not.toContain('data-blok-database-chart-hit');
  });
});

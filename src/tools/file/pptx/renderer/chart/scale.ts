// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.

export interface AxisScale {
  min: number;
  max: number;
  major: number;
}

export interface ScaleInput {
  /** Plotted values; stack totals for stacked charts. */
  values: number[];
  desiredTicks: number;
  stacked?: boolean;
  /** From c:scaling and c:majorUnit; each one wins over the automatic value. */
  min?: number;
  max?: number;
  major?: number;
}

function roundNiceInterval(rawInterval: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const residual = rawInterval / magnitude;

  if (residual <= 1) {
    return magnitude;
  }
  if (residual <= 2) {
    return 2 * magnitude;
  }

  return residual <= 5 ? 5 * magnitude : 10 * magnitude;
}

export function niceAxisInterval(dataMax: number, dataMin: number, desiredTicks = 5): number {
  if (dataMax === 0 && dataMin === 0) {
    return 1;
  }
  const range = dataMax - Math.min(0, dataMin);

  if (range <= 0) {
    return dataMax > 0 ? roundNiceInterval(dataMax) : roundNiceInterval(Math.abs(dataMin) || 1);
  }

  return roundNiceInterval(range / desiredTicks);
}

export function niceAxisMax(dataMax: number, dataMin: number, desiredTicks = 5): number {
  const interval = niceAxisInterval(dataMax, dataMin, desiredTicks);
  const niceMax = Math.ceil(dataMax / interval) * interval;

  return niceMax <= dataMax ? niceMax + interval : niceMax;
}

function niceAxisMin(dataMax: number, dataMin: number, desiredTicks = 5): number {
  const interval = niceAxisInterval(dataMax, dataMin, desiredTicks);
  const niceMin = Math.floor(dataMin / interval) * interval;

  return niceMin >= dataMin ? niceMin - interval : niceMin;
}

/**
 * Office starts an automatic value axis above zero when all values are positive and the
 * minimum is at least 5/6 of the maximum (Microsoft KB214075). The minimum is the first major
 * unit at or below `dataMin - (dataMax - dataMin) / 2`.
 */
function zoomedAxisExtent(dataMax: number, dataMin: number, desiredTicks: number): AxisScale | undefined {
  if (dataMin <= 0 || dataMin >= dataMax || dataMin < (dataMax * 5) / 6) {
    return undefined;
  }
  const span = dataMax - dataMin;
  const major = roundNiceInterval((span * 1.1) / desiredTicks);
  const top = (Math.floor(dataMax / major) + 1) * major;

  return {
    min: Math.floor((dataMin - span / 2) / major) * major,
    max: top - dataMax < major * 0.25 ? top + major : top,
    major,
  };
}

/** Automatic min, max and major unit of a value axis, as Office picks them. */
export function autoValueAxis(input: ScaleInput): AxisScale {
  const finite = input.values.filter((v) => Number.isFinite(v));
  const dataMin = finite.length > 0 ? Math.min(...finite) : 0;
  const dataMax = finite.length > 0 ? Math.max(...finite) : 1;
  const { desiredTicks } = input;
  const explicit = input.min !== undefined || input.max !== undefined;
  const zoomed = !input.stacked && !explicit ? zoomedAxisExtent(dataMax, dataMin, desiredTicks) : undefined;
  const fixedMajor = input.major !== undefined && input.major > 0 ? input.major : undefined;

  if (zoomed) {
    return { ...zoomed, major: fixedMajor ?? zoomed.major };
  }
  const interval = niceAxisInterval(dataMax, dataMin, desiredTicks);
  const niceMax = niceAxisMax(dataMax, dataMin, desiredTicks);
  const headroom = desiredTicks > 1 && niceMax - dataMax < interval * 0.25;
  const autoMax = headroom ? niceMax + interval : niceMax;
  const autoMin = dataMin >= 0 ? 0 : niceAxisMin(dataMax, dataMin, desiredTicks);
  const min = input.min ?? autoMin;
  const max = input.max !== undefined && input.max > min ? input.max : Math.max(autoMax, min + interval);

  if (fixedMajor !== undefined) {
    return { min, max, major: fixedMajor };
  }

  return { min, max, major: explicit ? niceAxisInterval(max, min, desiredTicks) : interval };
}

/**
 * How many ticks fit along a value axis without labels overlapping.
 * Bar charts ask for 10 ticks and space labels wider; others ask for 8.
 */
export function desiredTickCount(plotSpanPx: number, fontSizePx: number, bars: boolean): number {
  const desired = bars ? 10 : 8;
  const spacing = Math.max(28, fontSizePx * (bars ? 2.6 : 2.0));
  const maxLabels = Math.max(2, Math.floor(plotSpanPx / spacing) + 1);

  return Math.max(1, Math.min(desired, maxLabels - 1));
}

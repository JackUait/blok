// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '../helpers/domShims';

import {
  evaluateOoxmlGuideFormula,
  getOoxmlPresetShapePaths,
  ooxmlPresetRuntimeMultiPathShapeNames,
  ooxmlPresetRuntimeShapeNames,
  ooxmlPresetRuntimeSourceSha256,
} from '../../../../../../src/tools/file/pptx/shapes/ooxmlGeometryRuntime';
// Upstream compared against its build-time compiler (scripts/ooxml-geometry), which Blok does not vendor.
// This file holds that compiler's output, captured from upstream 1.4.0.
import buildTime from '../fixtures/ooxml-preset-runtime-paths.json';

// sha256 of the pinned presetShapeDefinitions.xml (upstream source-manifest.json).
const PINNED_SOURCE_SHA256 = '2f7c868d857c1e3c4b5a6068759fe0e07d77ad58377a6618d1b02ba3507b6939';

const runtimeFlowchartShapeNames = [
  'flowChartProcess',
  'flowChartAlternateProcess',
  'flowChartDecision',
  'flowChartInputOutput',
  'flowChartPredefinedProcess',
  'flowChartInternalStorage',
  'flowChartDocument',
  'flowChartMultidocument',
  'flowChartTerminator',
  'flowChartPreparation',
  'flowChartManualInput',
  'flowChartManualOperation',
  'flowChartConnector',
  'flowChartOffpageConnector',
  'flowChartPunchedCard',
  'flowChartPunchedTape',
  'flowChartSummingJunction',
  'flowChartOr',
  'flowChartCollate',
  'flowChartSort',
  'flowChartExtract',
  'flowChartMerge',
  'flowChartOnlineStorage',
  'flowChartDelay',
  'flowChartMagneticTape',
  'flowChartMagneticDisk',
  'flowChartMagneticDrum',
  'flowChartDisplay',
] as const;

const runtimeMultiPathFlowchartShapeNames = [
  'flowChartPredefinedProcess',
  'flowChartInternalStorage',
  'flowChartMultidocument',
  'flowChartSummingJunction',
  'flowChartOr',
  'flowChartSort',
  'flowChartMagneticDisk',
  'flowChartMagneticDrum',
] as const;

const runtimeShapeNames = [...runtimeFlowchartShapeNames, 'donut'] as const;

describe('OOXML preset geometry runtime subset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the production subset explicit and leaves other presets on handwritten geometry', () => {
    expect(ooxmlPresetRuntimeShapeNames).toEqual(runtimeShapeNames);
    expect(ooxmlPresetRuntimeMultiPathShapeNames).toEqual(runtimeMultiPathFlowchartShapeNames);
    expect(ooxmlPresetRuntimeSourceSha256).toBe(PINNED_SOURCE_SHA256);
    expect(getOoxmlPresetShapePaths('flowChartOfflineStorage', 400, 280)).toBeNull();
    expect(getOoxmlPresetShapePaths('rect', 400, 280)).toBeNull();
    expect(getOoxmlPresetShapePaths('unknownShape', 400, 280)).toBeNull();
  });

  it.each([
    ['*/', [6, 7, 3], 14],
    ['+-', [10, 3, 4], 9],
    ['+/', [10, 2, 3], 4],
    ['?:', [1, 20, 30], 20],
    ['abs', [-7], 7],
    ['at2', [1, 1], 2700000],
    ['cat2', [10, 3, 4], 6],
    ['cos', [10, 5400000], 0],
    ['max', [-2, 3], 3],
    ['min', [-2, 3], -2],
    ['mod', [2, 3, 6], 7],
    ['pin', [0, 11, 10], 10],
    ['sat2', [10, 3, 4], 8],
    ['sin', [10, 5400000], 10],
    ['sqrt', [-9], 3],
    ['tan', [10, 2700000], 10],
    ['val', [-2], -2],
  ] as const)(
    'evaluates runtime operator %s with the M1 numeric contract',
    (operator, values, expected) => {
      expect(evaluateOoxmlGuideFormula(operator, [...values])).toBeCloseTo(expected, 6);
    },
  );

  it('emits the original accepted shape deterministically and accepts case-insensitive lookup', () => {
    const expected =
      'M64.351852,0 L335.648148,0 A64.351852,140 0 0,1 335.648148,280 L64.351852,280 A64.351852,140 0 0,1 64.351852,0 Z';

    expect(getOoxmlPresetShapePaths('flowChartTerminator', 400, 280)?.[0].d).toBe(expected);
    expect(getOoxmlPresetShapePaths('FLOWCHARTTERMINATOR', 400, 280)?.[0].d).toBe(expected);
  });

  it('preserves the accepted three-path flowchart metadata and order', () => {
    for (const shapeName of runtimeMultiPathFlowchartShapeNames) {
      const paths = getOoxmlPresetShapePaths(shapeName, 400, 280);
      expect(paths, shapeName).toHaveLength(3);
      expect(paths?.[0]).toMatchObject({ fill: 'norm', stroke: false, extrusionOk: false });
      expect(paths?.[1]).toMatchObject({ fill: 'none', stroke: true, extrusionOk: false });
      expect(paths?.[2]).toMatchObject({
        fill: 'none',
        stroke: shapeName !== 'flowChartMultidocument',
        extrusionOk: true,
      });
      expect(paths?.every(({ d }) => d.length > 0 && !/NaN|Infinity/.test(d))).toBe(true);
    }
  });

  it('matches the build-time compiler and emitter at square, wide, and tall extents', () => {
    for (const shapeName of runtimeShapeNames) {
      const expected = buildTime.paths[shapeName];
      expect(expected, `${shapeName} must exist in the captured output`).toBeDefined();
      buildTime.dimensions.forEach(([width, height], i) => {
        expect(
          getOoxmlPresetShapePaths(shapeName, width, height),
          `${shapeName} at ${width}x${height}`,
        ).toEqual(expected[i]);
      });
    }
  });

  it('matches the pinned donut definition across adjustment bounds and aspect ratios', () => {
    for (const [width, height] of buildTime.dimensions) {
      for (const adjustment of [0, 1, 25000, 49999, 50000]) {
        const expected = buildTime.donut[`${width}x${height}@${adjustment}` as keyof typeof buildTime.donut];
        const runtime = getOoxmlPresetShapePaths('donut', width, height, new Map([['adj', adjustment]]));

        expect(expected).toBeDefined();
        expect(runtime, `donut adj=${adjustment} at ${width}x${height}`).toEqual(expected);
        expect(runtime?.[0]?.d.match(/M/g)).toHaveLength(2);
        expect(runtime?.[0]?.d).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  it('uses the OOXML donut default and clamps overrides through the pinned guide formula', () => {
    const atDefault = getOoxmlPresetShapePaths('donut', 400, 180);
    expect(atDefault).toEqual(
      getOoxmlPresetShapePaths('donut', 400, 180, new Map([['adj', 25000]])),
    );
    expect(getOoxmlPresetShapePaths('donut', 400, 180, new Map([['adj', -1]]))).toEqual(
      getOoxmlPresetShapePaths('donut', 400, 180, new Map([['adj', 0]])),
    );
    expect(getOoxmlPresetShapePaths('donut', 400, 180, new Map([['adj', 50001]]))).toEqual(
      getOoxmlPresetShapePaths('donut', 400, 180, new Map([['adj', 50000]])),
    );
    expect(() =>
      getOoxmlPresetShapePaths('donut', 400, 180, new Map([['adj', Number.NaN]])),
    ).toThrow(/adjustment adj.*finite/i);
  });

  it('normalizes floating-point residue at the donut upper adjustment bound', () => {
    const [path] =
      getOoxmlPresetShapePaths(
        'donut',
        403.20000000000005,
        403.20000000000005,
        new Map([['adj', 50000]]),
      ) ?? [];

    expect(path?.d).toBeTruthy();
    expect(path?.d).not.toMatch(/NaN|Infinity/);
  });

  it('rejects invalid dimensions and ignores unrelated legacy adjustment entries', () => {
    expect(() => getOoxmlPresetShapePaths('flowChartTerminator', 0, 280)).toThrow(
      /width.*greater than zero/i,
    );
    expect(
      getOoxmlPresetShapePaths('flowChartTerminator', 400, 280, new Map([['unsupported', 1]])),
    ).toEqual(getOoxmlPresetShapePaths('flowChartTerminator', 400, 280));
  });

  it('rejects malformed runtime formulas before they can emit invalid SVG', () => {
    expect(() => evaluateOoxmlGuideFormula('*/', [1, 2, 0])).toThrow(/division by zero/i);
    expect(() => evaluateOoxmlGuideFormula('unknown', [])).toThrow(/unknown.*operator/i);
    expect(() => evaluateOoxmlGuideFormula('val', [Number.NaN])).toThrow(/finite/i);
  });
});

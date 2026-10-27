// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '../helpers/domShims';
import * as runtime from '../../../../../../src/tools/file/pptx/shapes/ooxmlGeometryRuntime';
// Upstream compared against its build-time compiler (scripts/ooxml-geometry), which Blok does not vendor.
// This file holds that compiler's text rectangles ([x, y, w, h] or null), captured from upstream 1.4.0.
import pinned from '../fixtures/ooxml-preset-text-rectangles.json';

describe('preset text rectangles (issue #37)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps cloud on handwritten path geometry', () => {
    expect(runtime.ooxmlPresetRuntimeShapeNames).not.toContain('cloud');
  });

  it('uses the document text rectangle and supports case-insensitive lookup', () => {
    expect(runtime.getOoxmlPresetTextRectangle('FLOWCHARTDOCUMENT', 288, 144)).toEqual({
      x: 0,
      y: 0,
      w: 288,
      h: 115.48,
    });
  });

  it('matches every pinned preset at square, wide and tall extents', () => {
    const shapes = Object.entries(pinned.textRectangles);
    expect(shapes).toHaveLength(186);
    const cases = pinned.dimensions.flatMap(([width, height], i) =>
      shapes.map(([name, rects]) => ({ name, width, height, expected: rects[i] })),
    );
    for (const { name, width, height, expected } of cases) {
      let actual;
      try {
        actual = runtime.getOoxmlPresetTextRectangle(name, width, height);
      } catch (error) {
        throw new Error(`${name}: ${String(error)}`);
      }
      if (!expected) {
        expect(actual, name).toBeNull();
        continue;
      }
      if (!actual) throw new Error(`${name}: expected a text rectangle, got null`);
      const [x, y, w, h] = expected;
      expect(actual.x, `${name}.x`).toBeCloseTo(x, 6);
      expect(actual.y, `${name}.y`).toBeCloseTo(y, 6);
      expect(actual.w, `${name}.w`).toBeCloseTo(w, 6);
      expect(actual.h, `${name}.h`).toBeCloseTo(h, 6);
    }
  });

  it('evaluates text guides against the authored wave and roundRect adjustments', () => {
    for (const [name, variants] of Object.entries(pinned.adjustedTextRectangles)) {
      for (const { adjustments, rect } of variants) {
        const overrides = new Map<string, number>(Object.entries(adjustments));
        const actual = runtime.getOoxmlPresetTextRectangle(name, 400, 180, overrides)!;
        expect(actual.x).toBeCloseTo(rect[0], 6);
        expect(actual.y).toBeCloseTo(rect[1], 6);
        expect(actual.w).toBeCloseTo(rect[2], 6);
        expect(actual.h).toBeCloseTo(rect[3], 6);
      }
    }
  });

  it.each(['leftUpArrow', 'leftRightUpArrow', 'quadArrow'])(
    'falls back for degenerate %s text guides with an explicit zero adjustment',
    (preset) => {
      expect(
        runtime.getOoxmlPresetTextRectangle(preset, 288, 144, new Map([['adj2', 0]])),
      ).toBeNull();
    },
  );

  it('falls back for unknown presets and zero/non-finite dimensions', () => {
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [Number.NaN, 100],
      [100, Number.POSITIVE_INFINITY],
    ])
      expect(runtime.getOoxmlPresetTextRectangle('rect', w, h)).toBeNull();
    expect(runtime.getOoxmlPresetTextRectangle('unknown', 100, 100)).toBeNull();
    expect(runtime.getOoxmlPresetTextRectangle('rect', 100, 80)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });
  });
});

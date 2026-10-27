// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '../../helpers/domShims';
import {
  projectAbsoluteMoveLineCubicPath,
  projectFlatPlane,
  projectiveTransformToCssMatrix3d,
} from '../../../../../../../src/tools/file/pptx/renderer/shape3d/CameraProjection';

describe('projectFlatPlane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies the DrawingML orthographic rotation chain around the shape center', () => {
    const projection = projectFlatPlane({
      kind: 'orthographic',
      width: 403.2,
      height: 403.2,
      presentationWidth: 1280,
      rotation: { latitude: 20, longitude: 30, revolution: 0 },
    });

    expect(projection).toBeDefined();
    expect(projection!.corners[0]).toMatchObject({ x: expect.closeTo(27.0, 1) });
    expect(projection!.corners[0].y).toBeCloseTo(-22.3, 1);
    expect(projection!.corners[1].x).toBeCloseTo(376.2, 1);
    expect(projection!.corners[1].y).toBeCloseTo(46.6, 1);
    expect(projection!.corners[2].x).toBeCloseTo(376.2, 1);
    expect(projection!.corners[2].y).toBeCloseTo(425.5, 1);
    expect(projection!.corners[3].x).toBeCloseTo(27.0, 1);
    expect(projection!.corners[3].y).toBeCloseTo(356.6, 1);
  });

  it('matches the native PowerPoint perspective corner model across aspect ratios', () => {
    const square = projectFlatPlane({
      kind: 'perspective',
      width: 403.2,
      height: 403.2,
      presentationWidth: 1280,
      fieldOfView: 120,
      presetViewportScale: 0.95,
      presetProjectionScale: 0.996,
      rotation: { latitude: 18590633 / 60000, longitude: 0, revolution: 0 },
    });
    const wide = projectFlatPlane({
      kind: 'perspective',
      width: 768,
      height: 307.2,
      presentationWidth: 1280,
      fieldOfView: 120,
      presetViewportScale: 0.95,
      presetProjectionScale: 0.996,
      rotation: { latitude: 18590633 / 60000, longitude: 0, revolution: 0 },
    });

    expect(square).toBeDefined();
    expect(square!.corners[0].x).toBeCloseTo(62.3, 1);
    expect(square!.corners[0].y).toBeCloseTo(112.3, 1);
    expect(square!.corners[2].x).toBeCloseTo(560.8, 1);
    expect(square!.corners[2].y).toBeCloseTo(431.7, 1);

    expect(wide).toBeDefined();
    expect(wide!.corners[0].x).toBeCloseTo(97.7, 1);
    expect(wide!.corners[0].y).toBeCloseTo(80.2, 1);
    expect(wide!.corners[2].x).toBeCloseTo(960.0, 1);
    expect(wide!.corners[2].y).toBeCloseTo(301.2, 1);
  });

  it('rejects a perspective plane that reaches or crosses the camera', () => {
    expect(
      projectFlatPlane({
        kind: 'perspective',
        width: 200,
        height: 2000,
        presentationWidth: 960,
        fieldOfView: 120,
        presetViewportScale: 0.95,
        rotation: { latitude: -50, longitude: 0, revolution: 0 },
      }),
    ).toBeUndefined();
  });

  it('matches the native perspective-contrasting-right-facing zero-depth corners', () => {
    const projection = projectFlatPlane({
      kind: 'perspective',
      width: 441.6,
      height: 384,
      presentationWidth: 1280,
      fieldOfView: 85,
      presetViewportScale: 0.95,
      rotation: { latitude: 0, longitude: 19532225 / 60000, revolution: 0 },
    });

    expect(projection).toBeDefined();
    expect(projection!.corners[0].x).toBeCloseTo(-3.5, 1);
    expect(projection!.corners[0].y).toBeCloseTo(-44.5, 1);
    expect(projection!.corners[1].x).toBeCloseTo(374.0, 1);
    expect(projection!.corners[1].y).toBeCloseTo(30.4, 1);
    expect(projection!.corners[2].x).toBeCloseTo(374.0, 1);
    expect(projection!.corners[2].y).toBeCloseTo(353.6, 1);
    expect(projection!.corners[3].x).toBeCloseTo(-3.5, 1);
    expect(projection!.corners[3].y).toBeCloseTo(428.5, 1);
  });

  it('encodes a rectangle-to-camera-quad homography as a CSS matrix3d', () => {
    const corners = [
      { x: -3.5, y: -44.5 },
      { x: 374.0, y: 30.4 },
      { x: 374.0, y: 353.6 },
      { x: -3.5, y: 428.5 },
    ] as const;
    const css = projectiveTransformToCssMatrix3d(441.6, 384, corners);

    expect(css).toMatch(/^matrix3d\(/);
    const values = css!.slice('matrix3d('.length, -1).split(',').map(Number);
    expect(values).toHaveLength(16);
    const apply = (x: number, y: number) => {
      const denominator = values[3] * x + values[7] * y + values[15];
      return {
        x: (values[0] * x + values[4] * y + values[12]) / denominator,
        y: (values[1] * x + values[5] * y + values[13]) / denominator,
      };
    };
    const projected = [apply(0, 0), apply(441.6, 0), apply(441.6, 384), apply(0, 384)];
    projected.forEach((point, index) => {
      expect(point.x).toBeCloseTo(corners[index].x, 5);
      expect(point.y).toBeCloseTo(corners[index].y, 5);
    });
  });

  it('rejects a degenerate projective text plane', () => {
    expect(
      projectiveTransformToCssMatrix3d(200, 100, [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ]),
    ).toBeUndefined();
  });
});

describe('projectAbsoluteMoveLineCubicPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const corners = [
    { x: 10, y: 20 },
    { x: 190, y: 0 },
    { x: 220, y: 120 },
    { x: -20, y: 100 },
  ] as const;

  it('projects rectangle corners exactly into the target camera quadrilateral', () => {
    const projected = projectAbsoluteMoveLineCubicPath(
      'M0,0 L200,0 L200,100 L0,100 Z',
      200,
      100,
      corners,
    );

    expect(projected).toBe('M10,20 L190,0 L220,120 L-20,100 Z');
  });

  it('preserves two closed contours while adaptively flattening projected cubics', () => {
    const projected = projectAbsoluteMoveLineCubicPath(
      'M0,50 C0,10 40,0 80,30 L0,90 Z M110,20 C160,0 200,30 180,80 C160,100 120,90 110,20 Z',
      200,
      100,
      corners,
    );

    expect(projected).toBeDefined();
    expect(projected!.match(/M/g)).toHaveLength(2);
    expect(projected!.match(/Z/g)).toHaveLength(2);
    expect(projected).not.toContain('C');
    expect(projected!.match(/L/g)!.length).toBeGreaterThan(8);
    expect(projected).not.toMatch(/NaN|Infinity/);
  });

  it.each([
    ['relative commands', 'm0,0 l10,10 z'],
    ['quadratic commands', 'M0,0 Q5,5 10,10 Z'],
    ['arc commands', 'M0,0 A10,10 0 0 1 20,20 Z'],
    ['ignored punctuation', 'M0,@0 L10,0 L10,10 Z'],
    ['open contours', 'M0,0 L10,10'],
    ['coordinates outside the source plane', 'M-1,0 L10,0 L10,10 Z'],
  ])('rejects %s', (_label, pathD) => {
    expect(projectAbsoluteMoveLineCubicPath(pathD, 200, 100, corners)).toBeUndefined();
  });
});

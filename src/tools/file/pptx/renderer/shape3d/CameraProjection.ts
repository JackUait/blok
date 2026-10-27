// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
import type { Shape3DRotation } from '../../model/nodes/Shape3D';
import { tokenizeSvgPathData } from '../pathData';

export interface ProjectedPoint {
  x: number;
  y: number;
}

interface FlatPlaneProjection {
  corners: readonly [ProjectedPoint, ProjectedPoint, ProjectedPoint, ProjectedPoint];
  cameraDistance?: number;
}

interface FlatPlaneProjectionOptions {
  kind: 'orthographic' | 'perspective';
  width: number;
  height: number;
  presentationWidth: number;
  rotation: Shape3DRotation;
  fieldOfView?: number;
  /** Preset-specific view-volume scale established by the native PowerPoint matrix. */
  presetViewportScale?: number;
  /** Preset-specific projected-plane scale around the local center. */
  presetProjectionScale?: number;
}

const HOMOGRAPHY_EPSILON = 1e-9;
const DEFAULT_PROJECTED_CURVE_TOLERANCE = 0.25;
const MAX_PROJECTED_CURVE_DEPTH = 10;
const MAX_PROJECTED_PATH_TOKENS = 16_384;
const MAX_PROJECTED_PATH_POINTS = 8_192;

interface ProjectiveTransform {
  h11: number;
  h12: number;
  h13: number;
  h21: number;
  h22: number;
  h23: number;
  h31: number;
  h32: number;
}

function finitePoint(point: ProjectedPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function rectangleToQuadTransform(
  width: number,
  height: number,
  corners: readonly [ProjectedPoint, ProjectedPoint, ProjectedPoint, ProjectedPoint],
): ProjectiveTransform | undefined {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !corners.every(finitePoint)
  ) {
    return undefined;
  }

  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const twiceArea = corners.reduce((sum, point, index) => {
    const next = corners[(index + 1) % corners.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (!Number.isFinite(twiceArea) || Math.abs(twiceArea) <= HOMOGRAPHY_EPSILON) return undefined;

  const dx1 = topRight.x - bottomRight.x;
  const dx2 = bottomLeft.x - bottomRight.x;
  const dx3 = topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const dy1 = topRight.y - bottomRight.y;
  const dy2 = bottomLeft.y - bottomRight.y;
  const dy3 = topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;

  let perspectiveX = 0;
  let perspectiveY = 0;
  if (Math.abs(dx3) > HOMOGRAPHY_EPSILON || Math.abs(dy3) > HOMOGRAPHY_EPSILON) {
    const denominator = dx1 * dy2 - dx2 * dy1;
    if (!Number.isFinite(denominator) || Math.abs(denominator) <= HOMOGRAPHY_EPSILON) {
      return undefined;
    }
    perspectiveX = (dx3 * dy2 - dx2 * dy3) / denominator;
    perspectiveY = (dx1 * dy3 - dx3 * dy1) / denominator;
  }

  const transform = {
    h11: (topRight.x - topLeft.x + perspectiveX * topRight.x) / width,
    h12: (bottomLeft.x - topLeft.x + perspectiveY * bottomLeft.x) / height,
    h13: topLeft.x,
    h21: (topRight.y - topLeft.y + perspectiveX * topRight.y) / width,
    h22: (bottomLeft.y - topLeft.y + perspectiveY * bottomLeft.y) / height,
    h23: topLeft.y,
    h31: perspectiveX / width,
    h32: perspectiveY / height,
  };
  return Object.values(transform).every(Number.isFinite) ? transform : undefined;
}

function projectPoint(
  transform: ProjectiveTransform,
  point: ProjectedPoint,
): ProjectedPoint | undefined {
  const denominator = transform.h31 * point.x + transform.h32 * point.y + 1;
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= HOMOGRAPHY_EPSILON) {
    return undefined;
  }
  const projected = {
    x: (transform.h11 * point.x + transform.h12 * point.y + transform.h13) / denominator,
    y: (transform.h21 * point.x + transform.h22 * point.y + transform.h23) / denominator,
  };
  return finitePoint(projected) ? projected : undefined;
}

function formatProjectedNumber(value: number): string {
  const normalized = Math.abs(value) < 0.0000005 ? 0 : value;
  return Number.isInteger(normalized) ? String(normalized) : String(Number(normalized.toFixed(6)));
}

function formatProjectedPoint(point: ProjectedPoint): string {
  return `${formatProjectedNumber(point.x)},${formatProjectedNumber(point.y)}`;
}

function midpoint(a: ProjectedPoint, b: ProjectedPoint): ProjectedPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function splitCubic(
  start: ProjectedPoint,
  control1: ProjectedPoint,
  control2: ProjectedPoint,
  end: ProjectedPoint,
): readonly [
  readonly [ProjectedPoint, ProjectedPoint, ProjectedPoint, ProjectedPoint],
  readonly [ProjectedPoint, ProjectedPoint, ProjectedPoint, ProjectedPoint],
] {
  const a = midpoint(start, control1);
  const b = midpoint(control1, control2);
  const c = midpoint(control2, end);
  const d = midpoint(a, b);
  const e = midpoint(b, c);
  const center = midpoint(d, e);
  return [
    [start, a, d, center],
    [center, e, c, end],
  ];
}

function pointLineDistance(
  point: ProjectedPoint,
  start: ProjectedPoint,
  end: ProjectedPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = Math.hypot(dx, dy);
  if (denominator <= HOMOGRAPHY_EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / denominator;
}

function appendProjectedCubic(
  output: string[],
  transform: ProjectiveTransform,
  cubic: readonly [ProjectedPoint, ProjectedPoint, ProjectedPoint, ProjectedPoint],
  tolerance: number,
  pointCount: { value: number },
  depth = 0,
): boolean {
  const projected = cubic.map((point) => projectPoint(transform, point));
  if (projected.some((point) => point === undefined)) return false;
  const [start, control1, control2, end] = projected as [
    ProjectedPoint,
    ProjectedPoint,
    ProjectedPoint,
    ProjectedPoint,
  ];
  const flatness = Math.max(
    pointLineDistance(control1, start, end),
    pointLineDistance(control2, start, end),
  );
  if (flatness <= tolerance || depth >= MAX_PROJECTED_CURVE_DEPTH) {
    pointCount.value += 1;
    if (pointCount.value > MAX_PROJECTED_PATH_POINTS) return false;
    output.push(`L${formatProjectedPoint(end)}`);
    return true;
  }

  const [left, right] = splitCubic(...cubic);
  return (
    appendProjectedCubic(output, transform, left, tolerance, pointCount, depth + 1) &&
    appendProjectedCubic(output, transform, right, tolerance, pointCount, depth + 1)
  );
}

/**
 * Project a tightly bounded absolute SVG path through the same rectangle-to-camera homography.
 *
 * A projective transform turns a polynomial cubic into a rational cubic. SVG has no rational
 * cubic command, so supported cubic segments are flattened adaptively with a sub-pixel screen-space
 * tolerance. The parser deliberately accepts only explicit absolute M/L/C/Z contours emitted by
 * the verified custom-geometry lane.
 */
export function projectAbsoluteMoveLineCubicPath(
  pathD: string,
  width: number,
  height: number,
  corners: readonly [ProjectedPoint, ProjectedPoint, ProjectedPoint, ProjectedPoint],
  tolerance = DEFAULT_PROJECTED_CURVE_TOLERANCE,
): string | undefined {
  if (!Number.isFinite(tolerance) || tolerance <= 0) return undefined;
  if (!/^[MLCZ0-9eE+.,\-\s]+$/.test(pathD)) return undefined;
  const transform = rectangleToQuadTransform(width, height, corners);
  const tokens = tokenizeSvgPathData(pathD);
  if (!transform || !tokens || tokens.length === 0 || tokens.length > MAX_PROJECTED_PATH_TOKENS) {
    return undefined;
  }

  const output: string[] = [];
  const pointCount = { value: 0 };
  let index = 0;
  let current: ProjectedPoint | undefined;
  let contourOpen = false;
  let contourCount = 0;
  const readPoint = (): ProjectedPoint | undefined => {
    if (index + 1 >= tokens.length) return undefined;
    const point = { x: Number(tokens[index]), y: Number(tokens[index + 1]) };
    index += 2;
    if (!finitePoint(point) || point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
      return undefined;
    }
    return point;
  };

  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') {
      if (contourOpen) return undefined;
      const point = readPoint();
      const projected = point && projectPoint(transform, point);
      if (!point || !projected) return undefined;
      output.push(`M${formatProjectedPoint(projected)}`);
      current = point;
      contourOpen = true;
      contourCount += 1;
      pointCount.value += 1;
    } else if (command === 'L') {
      if (!contourOpen || !current) return undefined;
      const point = readPoint();
      const projected = point && projectPoint(transform, point);
      if (!point || !projected) return undefined;
      output.push(`L${formatProjectedPoint(projected)}`);
      current = point;
      pointCount.value += 1;
    } else if (command === 'C') {
      if (!contourOpen || !current) return undefined;
      const control1 = readPoint();
      const control2 = readPoint();
      const end = readPoint();
      if (
        !control1 ||
        !control2 ||
        !end ||
        !appendProjectedCubic(
          output,
          transform,
          [current, control1, control2, end],
          tolerance,
          pointCount,
        )
      ) {
        return undefined;
      }
      current = end;
    } else if (command === 'Z') {
      if (!contourOpen) return undefined;
      output.push('Z');
      current = undefined;
      contourOpen = false;
    } else {
      return undefined;
    }
    if (pointCount.value > MAX_PROJECTED_PATH_POINTS) return undefined;
  }

  return contourCount > 0 && !contourOpen ? output.join(' ') : undefined;
}

/**
 * Encode the projective map from a local rectangle to a four-corner camera plane.
 *
 * CSS `matrix3d()` exposes the homogeneous W row needed for a true quadrilateral map, so live
 * text remains selectable while its line boxes follow the same zero-depth camera plane as SVG.
 */
export function projectiveTransformToCssMatrix3d(
  width: number,
  height: number,
  corners: readonly [ProjectedPoint, ProjectedPoint, ProjectedPoint, ProjectedPoint],
): string | undefined {
  const transform = rectangleToQuadTransform(width, height, corners);
  if (!transform) return undefined;
  const { h11, h12, h13, h21, h22, h23, h31, h32 } = transform;
  const values = [h11, h21, 0, h31, h12, h22, 0, h32, 0, 0, 1, 0, h13, h23, 0, 1];
  if (values.some((value) => !Number.isFinite(value))) return undefined;
  return `matrix3d(${values.map((value) => Number(value.toFixed(12))).join(',')})`;
}

function radians(degrees: number): number {
  const normalized = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return (normalized * Math.PI) / 180;
}

/**
 * Project a zero-depth DrawingML plane around its local center.
 *
 * DrawingML records the camera rotations but does not prescribe a browser rasterizer. The
 * rotation order and perspective division here are pinned to native PowerPoint corner evidence.
 */
export function projectFlatPlane(
  options: FlatPlaneProjectionOptions,
): FlatPlaneProjection | undefined {
  const { kind, width, height, presentationWidth, rotation } = options;
  if (
    ![width, height, presentationWidth].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    presentationWidth <= 0
  ) {
    return undefined;
  }

  const latitude = radians(rotation.latitude);
  const longitude = radians(rotation.longitude);
  const revolution = radians(rotation.revolution);
  const cosLatitude = Math.cos(latitude);
  const sinLatitude = Math.sin(latitude);
  const cosLongitude = Math.cos(longitude);
  const sinLongitude = Math.sin(longitude);
  const cosRevolution = Math.cos(revolution);
  const sinRevolution = Math.sin(revolution);

  let cameraDistance: number | undefined;
  if (kind === 'perspective') {
    const fieldOfView = options.fieldOfView;
    const viewportScale = options.presetViewportScale;
    if (
      fieldOfView === undefined ||
      viewportScale === undefined ||
      !Number.isFinite(fieldOfView) ||
      !Number.isFinite(viewportScale) ||
      fieldOfView <= 0 ||
      fieldOfView >= 180 ||
      viewportScale <= 0
    ) {
      return undefined;
    }
    cameraDistance =
      (presentationWidth / (2 * Math.tan((fieldOfView * Math.PI) / 360))) * viewportScale;
    if (!Number.isFinite(cameraDistance) || cameraDistance <= 0) return undefined;
  }

  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const sourceCorners = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ] as const;
  const projected: ProjectedPoint[] = [];

  for (const [sourceX, sourceY] of sourceCorners) {
    // A zero-depth plane first rotates around Y (longitude), then X (latitude). This order is
    // observable in the 20°/30° orthographic control, whose two vertical sides remain parallel.
    const rotatedX = sourceX * cosLongitude;
    const rotatedY = sourceY * cosLatitude + sourceX * sinLongitude * sinLatitude;
    const rotatedZ = sourceY * sinLatitude - sourceX * sinLongitude * cosLatitude;
    let projectedX = rotatedX;
    let projectedY = rotatedY;
    if (cameraDistance !== undefined) {
      const denominator = cameraDistance + rotatedZ;
      // Do not let an unverified large plane cross the camera and explode the SVG bounds.
      if (!Number.isFinite(denominator) || denominator <= cameraDistance * 0.1) return undefined;
      const scale = cameraDistance / denominator;
      projectedX *= scale;
      projectedY *= scale;
    }
    const projectionScale = options.presetProjectionScale ?? 1;
    if (!Number.isFinite(projectionScale) || projectionScale <= 0) return undefined;
    const revolvedX = (projectedX * cosRevolution - projectedY * sinRevolution) * projectionScale;
    const revolvedY = (projectedX * sinRevolution + projectedY * cosRevolution) * projectionScale;
    const point = { x: halfWidth + revolvedX, y: halfHeight + revolvedY };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
    projected.push(point);
  }

  return {
    corners: projected as [ProjectedPoint, ProjectedPoint, ProjectedPoint, ProjectedPoint],
    cameraDistance,
  };
}

// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
/* eslint-disable no-restricted-syntax, max-depth -- vendored upstream code: restyling it risks behaviour the parity suite cannot see */
import { interiorDistanceField } from './DistanceField';

interface CircleBevelLightingOptions {
  /** Width of the bevel band in raster pixels. */
  bandPx: number;
  /** Height of the circular bevel profile in raster pixels. */
  heightPx: number;
  /** Clockwise compass bearing: 0 is up and 90 is right. */
  lightAzimuthDeg: number;
  /** Optional shadow-only bearing for multi-light rigs whose key highlight and dark lobe diverge. */
  shadowAzimuthDeg?: number;
  /** Mix from the key-light shadow (0) to the shadow-only bearing (1). */
  shadowDirectionMix?: number;
  /** Optional edge-opacity floor used to approximate the broad shadow rim of a multi-light rig. */
  shadowFloor?: number;
  /** Optional multiplier that compresses the directional shadow lobe above the floor. */
  shadowScale?: number;
  /** Optional key-light multiplier that leaves the independently modelled shadow unchanged. */
  highlightScale?: number;
  /** Light elevation above the slide plane. */
  lightElevationDeg: number;
  /** Material-specific response strength applied to the signed Lambert delta. */
  intensity: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothScalarField(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  if (radius <= 0) return source;
  const horizontal = new Float32Array(source.length);
  const result = new Float32Array(source.length);

  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) {
      if (x >= 0 && x < width) sum += source[y * width + x];
    }
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = sum / (radius * 2 + 1);
      const outgoing = x - radius;
      const incoming = x + radius + 1;
      if (outgoing >= 0) sum -= source[y * width + outgoing];
      if (incoming < width) sum += source[y * width + incoming];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) {
      if (y >= 0 && y < height) sum += horizontal[y * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      result[y * width + x] = sum / (radius * 2 + 1);
      const outgoing = y - radius;
      const incoming = y + radius + 1;
      if (outgoing >= 0) sum -= horizontal[outgoing * width + x];
      if (incoming < height) sum += horizontal[incoming * width + x];
    }
  }

  return result;
}

function sampleField(
  field: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return field[y * width + x];
}

function assertLightingOptions(options: CircleBevelLightingOptions): void {
  if (
    !Number.isFinite(options.bandPx) ||
    !Number.isFinite(options.heightPx) ||
    options.bandPx <= 0 ||
    options.heightPx <= 0
  ) {
    throw new RangeError('bandPx and heightPx must be positive finite numbers');
  }
  if (
    !Number.isFinite(options.lightAzimuthDeg) ||
    (options.shadowAzimuthDeg !== undefined && !Number.isFinite(options.shadowAzimuthDeg)) ||
    !Number.isFinite(options.lightElevationDeg)
  ) {
    throw new RangeError('light angles must be finite numbers');
  }
  if (
    options.shadowDirectionMix !== undefined &&
    (!Number.isFinite(options.shadowDirectionMix) ||
      options.shadowDirectionMix < 0 ||
      options.shadowDirectionMix > 1)
  ) {
    throw new RangeError('shadow direction mix must be a finite normalized value');
  }
  if (!Number.isFinite(options.intensity) || options.intensity < 0) {
    throw new RangeError('intensity must be a non-negative finite number');
  }
  if (
    (options.shadowFloor !== undefined &&
      (!Number.isFinite(options.shadowFloor) ||
        options.shadowFloor < 0 ||
        options.shadowFloor > 0.72)) ||
    (options.shadowScale !== undefined &&
      (!Number.isFinite(options.shadowScale) ||
        options.shadowScale < 0 ||
        options.shadowScale > 1)) ||
    (options.highlightScale !== undefined &&
      (!Number.isFinite(options.highlightScale) ||
        options.highlightScale < 0 ||
        options.highlightScale > 2))
  ) {
    throw new RangeError('shadow floor and scale must be finite normalized values');
  }
}

/**
 * Build a transparent black/white lighting layer for a circular inward bevel.
 *
 * The base surface is intentionally excluded. Each alpha value represents only the difference
 * between the bevel's Lambert response and the flat plane, so the result can be composited over a
 * solid color or a picture without replacing its content.
 */
export function renderCircleBevelOverlay(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  options: CircleBevelLightingOptions,
): Uint8ClampedArray {
  assertLightingOptions(options);
  const distance = interiorDistanceField(alpha, width, height);
  const smoothingRadius = clamp(Math.round(options.bandPx * 0.16), 1, 3);
  const smoothDistance = smoothScalarField(distance, width, height, smoothingRadius);
  const output = new Uint8ClampedArray(width * height * 4);

  const azimuth = (options.lightAzimuthDeg * Math.PI) / 180;
  const elevation = (options.lightElevationDeg * Math.PI) / 180;
  const horizontalLight = Math.cos(elevation);
  const lightX = Math.sin(azimuth) * horizontalLight;
  const lightY = -Math.cos(azimuth) * horizontalLight;
  const lightZ = Math.sin(elevation);
  const shadowAzimuth = ((options.shadowAzimuthDeg ?? options.lightAzimuthDeg) * Math.PI) / 180;
  const shadowLightX = Math.sin(shadowAzimuth) * horizontalLight;
  const shadowLightY = -Math.cos(shadowAzimuth) * horizontalLight;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const coverage = clamp(alpha[pixelIndex] / 255, 0, 1);
      const depth = distance[pixelIndex];
      if (coverage <= 0 || depth <= 0 || depth >= options.bandPx) continue;

      const gradientX =
        (sampleField(smoothDistance, width, height, x + 1, y) -
          sampleField(smoothDistance, width, height, x - 1, y)) /
        2;
      const gradientY =
        (sampleField(smoothDistance, width, height, x, y + 1) -
          sampleField(smoothDistance, width, height, x, y - 1)) /
        2;
      const gradientLength = Math.hypot(gradientX, gradientY);
      if (gradientLength < 1e-6) continue;

      const inwardX = gradientX / gradientLength;
      const inwardY = gradientY / gradientLength;
      const profilePosition = clamp(depth / options.bandPx, 0, 1);
      const remainingRadius = 1 - profilePosition;
      const profileHeight = Math.sqrt(Math.max(1e-6, 1 - remainingRadius * remainingRadius));
      const profileSlope = (options.heightPx / options.bandPx) * (remainingRadius / profileHeight);

      let normalX = -inwardX * profileSlope;
      let normalY = -inwardY * profileSlope;
      let normalZ = 1;
      const normalLength = Math.hypot(normalX, normalY, normalZ);
      normalX /= normalLength;
      normalY /= normalLength;
      normalZ /= normalLength;

      const bevelResponse = Math.max(0, normalX * lightX + normalY * lightY + normalZ * lightZ);
      const highlightDelta = bevelResponse - Math.max(0, lightZ);
      const shadowResponse = Math.max(
        0,
        normalX * shadowLightX + normalY * shadowLightY + normalZ * lightZ,
      );
      const shadowDelta = shadowResponse - Math.max(0, lightZ);
      const coupledShadow = Math.max(-highlightDelta, 0);
      const steeredShadow = Math.max(-shadowDelta, 0);
      const shadowDirectionMix = options.shadowDirectionMix ?? 1;
      const shadowMagnitude = coupledShadow + (steeredShadow - coupledShadow) * shadowDirectionMix;
      const lightingDelta = highlightDelta > 0 ? highlightDelta : -shadowMagnitude;
      const directionalOpacity = Math.abs(lightingDelta) * options.intensity;
      const materialOpacity =
        lightingDelta > 0
          ? directionalOpacity * (options.highlightScale ?? 1)
          : directionalOpacity * (options.shadowScale ?? 1) +
            (options.shadowFloor ?? 0) * remainingRadius;
      const opacity = Math.round(clamp(materialOpacity * coverage, 0, 0.72) * 255);
      if (opacity <= 0) continue;

      const outputOffset = pixelIndex * 4;
      const channel = lightingDelta > 0 ? 255 : 0;
      output[outputOffset] = channel;
      output[outputOffset + 1] = channel;
      output[outputOffset + 2] = channel;
      output[outputOffset + 3] = opacity;
    }
  }

  return output;
}

/** Return the largest raster scale that respects a rounded width/height pixel budget. */
export function fitShape3DRasterScale(
  width: number,
  height: number,
  requestedScale: number,
  maxPixels: number,
): number {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(requestedScale) ||
    !Number.isFinite(maxPixels) ||
    width <= 0 ||
    height <= 0 ||
    requestedScale <= 0 ||
    maxPixels < 1
  ) {
    return 0;
  }

  const budget = Math.floor(maxPixels);
  const fits = (scale: number) =>
    Math.max(1, Math.ceil(width * scale)) * Math.max(1, Math.ceil(height * scale)) <= budget;
  if (fits(requestedScale)) return requestedScale;

  let lower = 0;
  let upper = requestedScale;
  let best = 0;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const candidate = (lower + upper) / 2;
    if (fits(candidate)) {
      best = candidate;
      lower = candidate;
    } else {
      upper = candidate;
    }
  }
  return best;
}

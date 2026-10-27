// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
const OUTSIDE_COST = Number.POSITIVE_INFINITY;

function assertRaster(alpha: ArrayLike<number>, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('width and height must be positive integers');
  }
  if (alpha.length !== width * height) {
    throw new RangeError('alpha length must equal width * height');
  }
}

/** Exact one-dimensional squared Euclidean distance transform of a sampled cost function. */
function squaredDistanceTransform1d(
  source: Float64Array,
  sourceOffset: number,
  sourceStride: number,
  length: number,
  target: Float64Array,
  targetOffset: number,
  targetStride: number,
  sites: Int32Array,
  boundaries: Float64Array,
): void {
  let firstSite = -1;
  for (let index = 0; index < length; index += 1) {
    if (Number.isFinite(source[sourceOffset + index * sourceStride])) {
      firstSite = index;
      break;
    }
  }

  if (firstSite < 0) {
    for (let index = 0; index < length; index += 1) {
      target[targetOffset + index * targetStride] = OUTSIDE_COST;
    }
    return;
  }

  let envelopeIndex = 0;
  sites[0] = firstSite;
  boundaries[0] = Number.NEGATIVE_INFINITY;
  boundaries[1] = Number.POSITIVE_INFINITY;

  for (let site = firstSite + 1; site < length; site += 1) {
    const siteCost = source[sourceOffset + site * sourceStride];
    if (!Number.isFinite(siteCost)) continue;

    let previousSite = sites[envelopeIndex];
    let intersection =
      (siteCost +
        site * site -
        (source[sourceOffset + previousSite * sourceStride] + previousSite * previousSite)) /
      (2 * (site - previousSite));

    while (envelopeIndex > 0 && intersection <= boundaries[envelopeIndex]) {
      envelopeIndex -= 1;
      previousSite = sites[envelopeIndex];
      intersection =
        (siteCost +
          site * site -
          (source[sourceOffset + previousSite * sourceStride] + previousSite * previousSite)) /
        (2 * (site - previousSite));
    }

    envelopeIndex += 1;
    sites[envelopeIndex] = site;
    boundaries[envelopeIndex] = intersection;
    boundaries[envelopeIndex + 1] = Number.POSITIVE_INFINITY;
  }

  let activeSiteIndex = 0;
  for (let sample = 0; sample < length; sample += 1) {
    while (activeSiteIndex < envelopeIndex && boundaries[activeSiteIndex + 1] < sample) {
      activeSiteIndex += 1;
    }
    const site = sites[activeSiteIndex];
    const delta = sample - site;
    target[targetOffset + sample * targetStride] =
      delta * delta + source[sourceOffset + site * sourceStride];
  }
}

/**
 * Return the Euclidean distance from each opaque pixel to the nearest transparent pixel.
 *
 * A one-pixel transparent frame is added around the source so shapes that touch the raster edge
 * still receive a finite, symmetric interior field. Transparent pixels always return zero.
 */
export function interiorDistanceField(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  threshold = 128,
): Float32Array {
  assertRaster(alpha, width, height);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) {
    throw new RangeError('threshold must be between 0 and 255');
  }

  const paddedWidth = width + 2;
  const paddedHeight = height + 2;
  const paddedLength = paddedWidth * paddedHeight;
  const source = new Float64Array(paddedLength);
  source.fill(0);

  for (let y = 0; y < height; y += 1) {
    const sourceRow = (y + 1) * paddedWidth + 1;
    const alphaRow = y * width;
    for (let x = 0; x < width; x += 1) {
      source[sourceRow + x] = alpha[alphaRow + x] >= threshold ? OUTSIDE_COST : 0;
    }
  }

  const vertical = new Float64Array(paddedLength);
  const sites = new Int32Array(Math.max(paddedWidth, paddedHeight));
  const boundaries = new Float64Array(sites.length + 1);
  for (let x = 0; x < paddedWidth; x += 1) {
    squaredDistanceTransform1d(
      source,
      x,
      paddedWidth,
      paddedHeight,
      vertical,
      x,
      paddedWidth,
      sites,
      boundaries,
    );
  }

  for (let y = 0; y < paddedHeight; y += 1) {
    const rowOffset = y * paddedWidth;
    squaredDistanceTransform1d(
      vertical,
      rowOffset,
      1,
      paddedWidth,
      source,
      rowOffset,
      1,
      sites,
      boundaries,
    );
  }

  const result = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const paddedRow = (y + 1) * paddedWidth + 1;
    const outputRow = y * width;
    for (let x = 0; x < width; x += 1) {
      if (alpha[outputRow + x] >= threshold) {
        result[outputRow + x] = Math.sqrt(source[paddedRow + x]);
      }
    }
  }
  return result;
}

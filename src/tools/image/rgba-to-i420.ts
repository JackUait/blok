// BT.709 luma weights.
const KR = 0.2126;
const KG = 0.7152;
const KB = 0.0722;

const lumaOf = (r: number, g: number, b: number): number => KR * r + KG * g + KB * b;

/**
 * Convert RGBA pixels to limited-range BT.709 I420: the Y plane, then the U and
 * V planes at half size (rounded up). Alpha is dropped.
 */
export const rgbaToI420 = (rgba: Uint8Array, width: number, height: number): Uint8Array<ArrayBuffer> => {
  const chromaWidth = Math.ceil(width / 2);
  const chromaSize = chromaWidth * Math.ceil(height / 2);

  const channel = (x: number, y: number, c: number): number => (x < width && y < height ? rgba[(y * width + x) * 4 + c] : 0);
  /** Mean of one channel over the pixels of chroma sample `i`'s 2×2 block that exist. */
  const mean = (i: number, c: number): number => {
    const x = (i % chromaWidth) * 2;
    const y = Math.floor(i / chromaWidth) * 2;
    const count = (x + 1 < width ? 2 : 1) * (y + 1 < height ? 2 : 1);

    return (channel(x, y, c) + channel(x + 1, y, c) + channel(x, y + 1, c) + channel(x + 1, y + 1, c)) / count;
  };
  /** Limited range: chroma spans 16..240 around 128. `c` is the channel the plane measures against luma. */
  const chroma = (c: 0 | 2, weight: number): Uint8Array => new Uint8Array(chromaSize).map((_unused, i) => {
    const luma = lumaOf(mean(i, 0), mean(i, 1), mean(i, 2));

    return Math.round(128 + (mean(i, c) - luma) / (2 * (1 - weight)) * 224 / 255);
  });

  const out = new Uint8Array(width * height + 2 * chromaSize);

  // Limited range: luma spans 16..235, not 0..255.
  out.set(new Uint8Array(width * height).map((_unused, i) =>
    Math.round(16 + lumaOf(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) * 219 / 255)));
  out.set(chroma(2, KB), width * height);
  out.set(chroma(0, KR), width * height + chromaSize);

  return out;
};

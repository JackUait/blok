/** Safari draws nothing on a larger canvas. pdf.js caps the same way (`canvasMaxAreaInBytes`). */
export const MAX_CANVAS_AREA = 16_777_216;
/** Browsers refuse a longer canvas side (pdf.js `maxCanvasDim`). */
export const MAX_CANVAS_SIDE = 32_767;

/**
 * Backing pixels per CSS px for a canvas of `width` × `height` CSS px: the
 * device ratio, lowered until the canvas fits the browser's limits. Every PDF
 * canvas goes through it, or a hostile page size makes a giant one.
 */
export function backingRatio(width: number, height: number): number {
  return Math.min(
    window.devicePixelRatio || 1,
    Math.sqrt(MAX_CANVAS_AREA / (width * height)),
    MAX_CANVAS_SIDE / width,
    MAX_CANVAS_SIDE / height,
  );
}

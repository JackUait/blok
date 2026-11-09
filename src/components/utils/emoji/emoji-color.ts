const cache = new Map<string, string | null>();
const canvasState: { context?: CanvasRenderingContext2D | null } = {};

const SIZE = 20;

/**
 * The emoji's dominant colour as `rgb(...)`, weighted toward saturated pixels
 * so a face reads yellow rather than its dark outline. Null when the page
 * cannot draw text to a canvas (jsdom, a blocked canvas).
 * @param native - the emoji to sample
 */
export function emojiColor(native: string): string | null {
  const cached = cache.get(native);

  if (cached !== undefined) {
    return cached;
  }

  const color = sample(native);

  cache.set(native, color);

  return color;
}

function drawingContext(): CanvasRenderingContext2D | null {
  if (canvasState.context === undefined) {
    const canvas = document.createElement('canvas');

    canvas.width = SIZE;
    canvas.height = SIZE;

    try {
      // jsdom has no canvas and answers undefined; keep null so it is asked once.
      canvasState.context = canvas.getContext('2d', { willReadFrequently: true }) ?? null;
    } catch {
      canvasState.context = null;
    }
  }

  return canvasState.context;
}

function sample(native: string): string | null {
  const context = drawingContext();

  if (context === null || native === '') {
    return null;
  }

  try {
    context.clearRect(0, 0, SIZE, SIZE);
    context.font = '16px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(native, SIZE / 2, SIZE / 2 + 1);

    const data = context.getImageData(0, 0, SIZE, SIZE).data;
    const pixels = Array.from({ length: data.length / 4 }, (_, pixel) => pixel * 4).filter(index => data[index + 3] >= 128);
    const { red, green, blue, weight } = pixels.reduce((sum, index) => {
      const max = Math.max(data[index], data[index + 1], data[index + 2]);
      const min = Math.min(data[index], data[index + 1], data[index + 2]);
      const pixelWeight = 0.1 + ((max - min) / 255) ** 2 * 3;

      return {
        red: sum.red + data[index] * pixelWeight,
        green: sum.green + data[index + 1] * pixelWeight,
        blue: sum.blue + data[index + 2] * pixelWeight,
        weight: sum.weight + pixelWeight,
      };
    }, { red: 0, green: 0, blue: 0, weight: 0 });

    return weight === 0 ? null : `rgb(${Math.round(red / weight)}, ${Math.round(green / weight)}, ${Math.round(blue / weight)})`;
  } catch {
    return null;
  }
}

// Derived from @aiden0z/pptx-renderer 1.4.0 test helpers (Apache-2.0); modified for Blok.
/**
 * jsdom lacks blob URLs and ImageData, which the engine uses for media and EMF bitmaps.
 * Import this module first in any test that renders pictures.
 */
const counter = { value: 0 };

if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = (): string => {
    counter.value += 1;

    return `blob:mock/${counter.value}`;
  };
}

if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = (): void => undefined;
}

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataShim {
    public readonly data: Uint8ClampedArray;

    constructor(public readonly width: number, public readonly height: number) {
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  }
  Object.defineProperty(globalThis, 'ImageData', { value: ImageDataShim, configurable: true });
}

export {};

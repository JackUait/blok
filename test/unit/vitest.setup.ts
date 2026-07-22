import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { vi } from 'vitest';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Guard for test files that opt into the node environment
// (e.g. the DOM-free view sanitizer tests) — no window to polyfill there.
const hasDom = typeof window !== 'undefined';

// Polyfill requestIdleCallback for jsdom environment
if (hasDom && !window.requestIdleCallback) {
  window.requestIdleCallback = vi.fn((cb: IdleRequestCallback) => {
    const start = Date.now();
    return window.setTimeout(() => {
      cb({
        didTimeout: false,
        timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
      });
    }, 1);
  });
}

if (hasDom && !window.cancelIdleCallback) {
  window.cancelIdleCallback = vi.fn((id: number) => {
    window.clearTimeout(id);
  });
}

// Polyfill document.adoptedStyleSheets for jsdom environment
if (hasDom && !document.adoptedStyleSheets) {
  document.adoptedStyleSheets = [];
}

// Polyfill ResizeObserver for jsdom environment
if (hasDom && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
}

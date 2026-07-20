import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { vi } from 'vitest';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Polyfill requestIdleCallback for jsdom environment
if (!window.requestIdleCallback) {
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

if (!window.cancelIdleCallback) {
  window.cancelIdleCallback = vi.fn((id: number) => {
    window.clearTimeout(id);
  });
}

// Polyfill document.adoptedStyleSheets for jsdom environment
if (!document.adoptedStyleSheets) {
  document.adoptedStyleSheets = [];
}

// Polyfill ResizeObserver for jsdom environment
if (!window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
}

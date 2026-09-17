import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { vi } from 'vitest';

import { toDOMRectList } from './helpers/dom-rect-list';

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

// Polyfill Range.getBoundingClientRect for jsdom, which implements the Range
// API without any layout. Every real engine has it; code that measures a Range
// (remote presence carets) would otherwise throw only under test.
if (hasDom && typeof window.Range.prototype.getBoundingClientRect !== 'function') {
  window.Range.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return new window.DOMRect(0, 0, 0, 0);
  };
}

// Same gap, the other measuring call: jsdom implements no Range.getClientRects
// at all, so presence selection shading (one rect per wrapped line) would throw
// under test rather than measure. Suites that need geometry stub this.
if (hasDom && typeof window.Range.prototype.getClientRects !== 'function') {
  window.Range.prototype.getClientRects = function getClientRects(): DOMRectList {
    return toDOMRectList([]);
  };
}

// Polyfill Element.scrollIntoView for jsdom, which ships no layout and so
// implements neither scrollIntoView nor scrollIntoViewIfNeeded. Every real
// engine has it; roving-focus code (Flipper, block selection) calls it on every
// move, and without this the call throws asynchronously inside a jsdom event
// listener, surfacing as an unhandled error that fails the whole run.
// Installed on Element.prototype on purpose: several suites stub and then
// `Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')` in teardown,
// which must not strip the baseline back out.
if (hasDom && typeof window.Element.prototype.scrollIntoView !== 'function') {
  window.Element.prototype.scrollIntoView = vi.fn();
}

import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { vi } from 'vitest';
import { configure } from '@testing-library/dom';

// Configure Testing Library to recognize data-blok-testid as a test ID attribute
configure({ testIdAttribute: 'data-blok-testid' });

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Mock window.matchMedia for responsive components
// jsdom 28+ has native matchMedia — configurable: true allows per-test overrides
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
class MockIntersectionObserver {
  root: Element | null = null;
  rootMargin: string = '';
  thresholds: ReadonlyArray<number> = [];
  callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}
global.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

// Mock requestAnimationFrame
global.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
  return setTimeout(cb, 16) as unknown as number;
});

// Mock cancelAnimationFrame
global.cancelAnimationFrame = vi.fn(clearTimeout);

// Mock scrollIntoView
HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock scrollTo for elements (used by ApiSidebar)
HTMLElement.prototype.scrollTo = vi.fn();

import { describe, it, expect } from 'vitest';

import { bem } from '../../../src/components/utils/bem';

describe('bem', () => {
  it('returns block class when no element or modifier is provided', () => {
    const className = bem('blok-popover');

    expect(className()).toBe('blok-popover');
  });

  it('appends element to block when element is provided', () => {
    const className = bem('blok-popover');

    expect(className('container')).toBe('blok-popover__container');
  });

  it('appends modifier to element when modifier is provided', () => {
    const className = bem('blok-popover');

    expect(className('container', 'hidden')).toBe('blok-popover__container--hidden');
  });

  it('appends modifier to block when element is not provided', () => {
    const className = bem('blok-popover');

    expect(className(null, 'hidden')).toBe('blok-popover--hidden');
    expect(className(undefined, 'hidden')).toBe('blok-popover--hidden');
  });

  it('omits falsy element or modifier values', () => {
    const className = bem('blok-popover');

    expect(className('')).toBe('blok-popover');
    expect(className('container', '')).toBe('blok-popover__container');
  });
});


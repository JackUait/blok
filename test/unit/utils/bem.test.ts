import { describe, it, expect } from 'vitest';

import { bem } from '../../../src/components/utils/bem';

describe('bem', () => {
  it('returns block class when no element or modifier is provided', () => {
    const className = bem('ce-popover');

    expect(className()).toBe('ce-popover');
  });

  it('appends element to block when element is provided', () => {
    const className = bem('ce-popover');

    expect(className('container')).toBe('ce-popover__container');
  });

  it('appends modifier to element when modifier is provided', () => {
    const className = bem('ce-popover');

    expect(className('container', 'hidden')).toBe('ce-popover__container--hidden');
  });

  it('appends modifier to block when element is not provided', () => {
    const className = bem('ce-popover');

    expect(className(null, 'hidden')).toBe('ce-popover--hidden');
    expect(className(undefined, 'hidden')).toBe('ce-popover--hidden');
  });

  it('omits falsy element or modifier values', () => {
    const className = bem('ce-popover');

    expect(className('')).toBe('ce-popover');
    expect(className('container', '')).toBe('ce-popover__container');
  });
});


// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { markerSanitize } from '../../../src/shared/tool-descriptions/sanitize/inline';
import { sanitizeHtmlFragment } from '../../../src/view/sanitize';

describe('marker sanitization in Node', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      name: 'color without background',
      input: '<mark style="color: red; position: fixed; font-size: 3px">m</mark>',
      expected: '<mark style="color: red; background-color: transparent;">m</mark>',
    },
    {
      name: 'color with invisible background',
      input: '<mark style="color: blue; background-color: white">m</mark>',
      expected: '<mark style="color: blue; background-color: transparent;">m</mark>',
    },
    {
      name: 'transparent background',
      input: '<mark style="background-color: transparent">m</mark>',
      expected: '<mark>m</mark>',
    },
    {
      name: 'visible pale gray highlight',
      input: '<mark style="background-color: rgb(241, 241, 239)">m</mark>',
      expected: '<mark style="background-color: rgb(241, 241, 239)">m</mark>',
    },
  ])('$name matches the captured DOM output', ({ input, expected }) => {
    const result = sanitizeHtmlFragment(input, markerSanitize());

    expect(result).toBe(expected);
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });
});

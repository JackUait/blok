// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type * as ReactModule from 'react';

// React 18 warns on a server useLayoutEffect and React 19 does not, so the spy is the signal.
const { layoutEffect } = vi.hoisted(() => ({ layoutEffect: vi.fn() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();

  return {
    ...actual,
    useLayoutEffect: (...args: Parameters<typeof actual.useLayoutEffect>) => {
      layoutEffect();

      return actual.useLayoutEffect(...args);
    },
  };
});

describe('BlokTitle on the server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders its div without a layout effect', async () => {
    const { BlokTitle } = await import('../../../packages/react/src/BlokTitle');

    expect(typeof window).toBe('undefined');
    expect(renderToString(<BlokTitle editor={null} id="title" />)).toBe('<div id="title"></div>');
    expect(layoutEffect).not.toHaveBeenCalled();
  });
});

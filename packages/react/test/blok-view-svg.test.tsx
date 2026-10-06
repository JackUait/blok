import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

import { BlokView } from '../src';

/**
 * Its own file on purpose: React prints each "Invalid DOM property" warning
 * once per module instance, so an earlier SVG render in the same file would
 * hide the warning from this spy.
 */
describe('BlokView SVG attributes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the fallback page glyph as SVG without React warnings', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <BlokView data={{ blocks: [{ type: 'page', data: { pageId: 'p1', cache: { title: 'Roadmap' } } }] }} />
    );
    const svg = container.querySelector('svg');
    const path = svg?.querySelector('path');

    expect(consoleError).not.toHaveBeenCalled();
    expect(svg?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(path?.getAttribute('stroke-width')).toBe('1.25');
    expect(path?.getAttribute('stroke-linecap')).toBe('round');
    expect(svg?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('leaves hyphenated attributes outside SVG as written', () => {
    const { container } = render(
      <BlokView
        data={{ blocks: [{ type: 'widget', data: {} }] }}
        renderers={{ widget: () => '<my-widget some-prop="x"></my-widget>' }}
      />
    );
    const widget = container.querySelector('my-widget');

    expect(widget?.getAttribute('some-prop')).toBe('x');
    expect(widget?.hasAttribute('someProp')).toBe(false);
  });
});

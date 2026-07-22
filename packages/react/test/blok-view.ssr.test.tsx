// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Deep imports on purpose: the package index re-exports the full editor
// bindings, whose core import pollutes globalThis.window. The view bindings
// themselves must stay importable in bare Node with zero DOM globals.
import { BlokView } from '../src/BlokView';
import { useBlokView } from '../src/useBlokView';

/**
 * SSR smoke: the view bindings must render in bare Node (no DOM globals, no
 * effects, no warnings) — the whole point of the synchronous renderer.
 */
describe('BlokView SSR', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renderToStaticMarkup produces the document markup without DOM globals or warnings', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const html = renderToStaticMarkup(
      <BlokView
        data={{
          blocks: [
            { type: 'header', data: { text: 'SSR Title', level: 3 } },
            { type: 'list', data: { style: 'checklist', text: 'Task', checked: true } },
          ],
        }}
        className="rich"
      />
    );

    expect(html).toContain('<div class="rich">');
    expect(html).toContain('<h3>SSR Title</h3>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
    expect(errorSpy).not.toHaveBeenCalled();
    expect(Reflect.get(globalThis, 'window')).toBeUndefined();
    expect(Reflect.get(globalThis, 'document')).toBeUndefined();
  });

  it('useBlokView renders unwrapped in static markup', () => {
    const Label = (): React.ReactNode => <label>{useBlokView({ blocks: [{ type: 'paragraph', data: { text: 'hi' } }] })}</label>;

    expect(renderToStaticMarkup(<Label />)).toBe('<label><p>hi</p></label>');
  });
});

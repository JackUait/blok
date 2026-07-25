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

    /**
     * The wrapper is a soft isolation root (so the emitted classes compute the
     * same way they do inside a read-only editor) AND still carries the
     * caller's className.
     */
    expect(html).toContain('<div data-blok-interface="view" class="rich">');
    /** Level-3 typography comes from the shared tool-classes module. */
    expect(html).toContain('<h3 class="');
    expect(html).toContain('text-xl');
    expect(html).toContain('>SSR Title</h3>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
    expect(errorSpy).not.toHaveBeenCalled();
    expect(Reflect.get(globalThis, 'window')).toBeUndefined();
    expect(Reflect.get(globalThis, 'document')).toBeUndefined();
  });

  it('useBlokView renders unwrapped in static markup', () => {
    const Label = (): React.ReactNode => <label>{useBlokView({ blocks: [{ type: 'paragraph', data: { text: 'hi' } }] })}</label>;

    /**
     * "Unwrapped" is the contract under test: the block element is a DIRECT
     * child of the caller's `<label>`, with no interposed element. The
     * presentational classes come from the shared tool-classes modules — this
     * path enables them so it matches a read-only editor render — and are inert
     * until `@bloklabs/core/view.css` is imported.
     */
    expect(renderToStaticMarkup(<Label />)).toBe(
      '<label><p class="blok-block leading-[1.5] mt-px mb-px [&amp;&gt;p:first-of-type]:mt-0 [&amp;&gt;p:last-of-type]:mb-0">hi</p></label>'
    );
  });
});

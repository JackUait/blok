import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Mock the lazy KaTeX loader so the test stays deterministic and offline —
 * `renderLatex` echoes a predictable rendered string instead of loading KaTeX.
 */
vi.mock('../../../../src/tools/code/katex-loader', () => ({
  renderLatex: vi.fn(async (latex: string) => `<span class="katex">rendered:${latex}</span>`),
}));

import { Core } from '../../../../src/components/core';
import { EquationInlineTool } from '../../../../src/components/inline-tools/inline-tool-equation';
import { Header, Paragraph } from '../../../../src/tools';

/**
 * ROOT CAUSE this covers: `EquationInlineTool` renders KaTeX when a formula is
 * inserted, and its sanitizer keeps ONLY the `data-latex` source on save —
 * documented as "regenerated on load". Nothing ever regenerated it: the tool's
 * `hydrate()` had no call site anywhere in the codebase, so every reload of a
 * document turned its equations into inert text and no test noticed (the e2e
 * suite only ever asserted what `save()` produced).
 */
describe('inline equation hydration on load', () => {
  let holder: HTMLDivElement;
  let core: Core | null = null;

  const equationDocument = {
    blocks: [
      { type: 'paragraph', data: { text: 'mass: <span data-latex="E=mc^2">E=mc^2</span>' } },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    await core?.moduleInstances?.BlockManager?.destroy?.();
    core = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  /**
   * Boot a real editor over the given saved document.
   * @param options - extra core configuration (e.g. an onChange spy)
   */
  const boot = async (options: Record<string, unknown> = {}): Promise<void> => {
    core = new Core({
      holder,
      tools: {
        paragraph: { class: Paragraph, inlineToolbar: ['equation'] },
        equation: { class: EquationInlineTool },
      },
      data: equationDocument,
      ...options,
    });

    await core.isReady;
  };

  it('re-renders a persisted LaTeX source into KaTeX markup', async () => {
    await boot();

    await vi.waitFor(() => {
      expect(holder.querySelector('span[data-latex] .katex')?.textContent).toBe('rendered:E=mc^2');
    });
  });

  it('leaves the source attribute intact so the block still saves as its source', async () => {
    await boot();

    await vi.waitFor(() => {
      expect(holder.querySelector('span[data-latex]')).not.toBeNull();
    });

    expect(holder.querySelector('span[data-latex]')?.getAttribute('data-latex')).toBe('E=mc^2');
  });

  it('re-renders after an in-place data update rewrote the block DOM', async () => {
    await boot();

    await vi.waitFor(() => {
      expect(holder.querySelector('span[data-latex] .katex')).not.toBeNull();
    });

    const blocksApi = core?.moduleInstances?.API?.methods?.blocks;
    const blockId = core?.moduleInstances?.BlockManager?.blocks?.[0]?.id;

    expect(blockId).toBeDefined();

    // `blocks.update` writes new text over the block — in place when the tool
    // supports it, by recomposing otherwise. Either way the rendered markup is
    // replaced by the stored source, and either way it must come back.
    await blocksApi?.update(blockId as string, { text: 'now: <span data-latex="a^2">a^2</span>' });

    await vi.waitFor(() => {
      expect(holder.querySelector('span[data-latex] .katex')?.textContent).toBe('rendered:a^2');
    });
  });

  it('re-renders when data is applied IN PLACE, with no Block to rebuild', async () => {
    /**
     * `Block.setData` is the in-place entry point — a tool that implements
     * `setData` (header here) rewrites its OWN DOM and the Block survives, so
     * there is no fresh Block whose render would hydrate the marks. It is what
     * a remote Yjs update replays through, and what `blocks.update` prefers
     * over recomposing, so the rendered markup has to be rebuilt right here.
     */
    core = new Core({
      holder,
      tools: {
        paragraph: { class: Paragraph },
        header: { class: Header, inlineToolbar: ['equation'] },
        equation: { class: EquationInlineTool },
      },
      data: { blocks: [{ id: 'h', type: 'header', data: { text: 'plain', level: 2 } }] },
    });

    await core.isReady;

    const block = core.moduleInstances.BlockManager.blocks[0];
    const appliedInPlace = await block.setData({ text: 'about <span data-latex="a^2">a^2</span>', level: 2 });

    // Guard the premise: if the tool had refused, a recompose would hydrate and
    // this test would be proving nothing.
    expect(appliedInPlace).toBe(true);

    await vi.waitFor(() => {
      expect(holder.querySelector('span[data-latex] .katex')?.textContent).toBe('rendered:a^2');
    });
  });

  it('re-renders content a tool wrote itself on paste', async () => {
    await boot();

    await vi.waitFor(() => {
      expect(holder.querySelector('span[data-latex] .katex')).not.toBeNull();
    });

    const block = core?.moduleInstances?.BlockManager?.blocks?.[0];
    const pluginsContent = block?.pluginsContent;

    expect(pluginsContent).toBeDefined();

    // What a text tool's `onPaste` does: write the sanitized clipboard HTML —
    // a formula source, with no rendering — into its own element. Core follows
    // it with `refreshToolRootElement`, the documented "the tool replaced its
    // DOM" step, which is where the marks get rebuilt over what it wrote.
    if (pluginsContent !== undefined) {
      pluginsContent.innerHTML = 'pasted <span data-latex="b^2">b^2</span>';
    }
    block?.refreshToolRootElement();

    await vi.waitFor(() => {
      expect(holder.querySelector('span[data-latex] .katex')?.textContent).toBe('rendered:b^2');
    });
  });

  it('does not report the document as changed (rendering is not an edit)', async () => {
    const onChange = vi.fn();

    await boot({ onChange });

    await vi.waitFor(() => {
      expect(holder.querySelector('span[data-latex] .katex')).not.toBeNull();
    });

    // Let any queued mutation batch settle before asserting nothing fired.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onChange).not.toHaveBeenCalled();
  });
});

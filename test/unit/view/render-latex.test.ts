// @vitest-environment node
import { describe, expect, it } from 'vitest';

/**
 * `renderLatex` is the KaTeX call blok already bundles (a 259 KB chunk shipped
 * for the code tool, the equation inline tool and the markdown importer) with
 * the untrusted-input hardening already applied: `trust: false`, capped
 * `maxExpand`/`maxSize`, `throwOnError: false`.
 *
 * Until it was exported, `types/view.d.ts` told hosts to call
 * `katex.renderToString` themselves from a `ViewInlineRenderer` — which meant
 * adding katex as a direct dependency, re-deriving those options, and (for hosts
 * that did not) booting a whole read-only `BlokEditor` per surface just to get
 * an equation rendered.
 *
 * Run in NODE: the view entry's purity contract means every value it exports has
 * to survive being imported and called with no DOM at all (`blocksToHtml` is
 * built for SSR, so an equation renderer reached from it runs server-side too).
 */
describe('view entry exposes renderLatex', () => {
  it('is exported as a function', async () => {
    const view = await import('../../../src/view');

    expect(typeof view.renderLatex).toBe('function');
  });

  it('renders math with no DOM present', async () => {
    const { renderLatex } = await import('../../../src/view');

    const html = await renderLatex('c = \\pm\\sqrt{a^2 + b^2}', { displayMode: false });

    expect(html).toContain('katex');
    expect(html).toContain('\\pm\\sqrt{a^2 + b^2}');
    expect(Reflect.get(globalThis, 'document')).toBeUndefined();
  });

  it('keeps the markup-injecting commands disarmed', async () => {
    const { renderLatex } = await import('../../../src/view');

    // `trust: false` renders \href as a red error node; the source survives only
    // as escaped text inside <annotation>, never as a navigable link.
    const html = await renderLatex('\\href{javascript:alert(1)}{click}');

    expect(html).not.toMatch(/<a[\s>]/i);
    expect(html).not.toContain('href="javascript:');
  });
});

/**
 * `inlineRenderers` is SYNCHRONOUS by contract, so the async `renderLatex`
 * cannot be plugged into it — it would stringify as `[object Promise]`. Awaiting
 * the loader once and getting a sync renderer back is what actually lets a host
 * render equations through `blocksToHtml` instead of booting a read-only editor.
 */
describe('createLatexRenderer feeds the synchronous inlineRenderers hook', () => {
  it('resolves to a renderer that returns markup synchronously', async () => {
    const { createLatexRenderer } = await import('../../../src/view');

    const render = await createLatexRenderer();
    const html = render('x^2', { displayMode: false });

    expect(typeof html).toBe('string');
    expect(html).toContain('katex');
  });

  it('renders an equation mark through blocksToHtml', async () => {
    const { createLatexRenderer, blocksToHtml } = await import('../../../src/view');

    const render = await createLatexRenderer();
    const html = blocksToHtml(
      { blocks: [{ type: 'paragraph', data: { text: 'see <span data-latex="a^2"></span>' } }] },
      {
        inlineRenderers: {
          span: ({ attrs }) => {
            const latex = attrs['data-latex'];

            return latex === undefined ? undefined : render(latex, { displayMode: false });
          },
        },
      }
    );

    expect(html).toContain('katex');
    expect(html).not.toContain('[object Promise]');
  });

  it('reaches the REACT display path too, via blocksToViewNodes', async () => {
    // `BlokView`/`useBlokView` map from `blocksToViewNodes`, not from
    // `blocksToHtml`. That is the path the claim is about — a host dropping
    // `BlokEditor readOnly` for `BlokView` — so the renderer has to survive it.
    const { createLatexRenderer, blocksToViewNodes } = await import('../../../src/view');

    const render = await createLatexRenderer();
    const nodes = blocksToViewNodes(
      { blocks: [{ type: 'paragraph', data: { text: 'see <span data-latex="a^2"></span>' } }] },
      {
        inlineRenderers: {
          span: ({ attrs }) => {
            const latex = attrs['data-latex'];

            return latex === undefined ? undefined : render(latex, { displayMode: false });
          },
        },
      }
    );

    const flatten = (node: unknown): string => {
      const element = node as { tag?: string; attrs?: Record<string, string>; children?: unknown[]; text?: string };

      if (element.text !== undefined) {
        return element.text;
      }

      return `<${element.tag ?? ''} ${Object.values(element.attrs ?? {}).join(' ')}>` +
        (element.children ?? []).map(flatten).join('');
    };
    const serialized = nodes.map(flatten).join('');

    // KaTeX markup arrived as real view NODES, not as an escaped string or a
    // stringified promise.
    expect(serialized).toContain('katex');
    expect(serialized).not.toContain('[object Promise]');
    // The stored LaTeX source is not left in the tree as a bare attribute.
    expect(serialized).not.toContain('data-latex');
  });
});

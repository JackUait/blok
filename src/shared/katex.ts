import type KatexType from 'katex';

const state = {
  katexPromise: null as Promise<typeof KatexType> | null,
  cssInjected: false,
};

function injectCss(): void {
  /**
   * `renderLatex` is reachable from the DOM-free `./view` entry (SSR, workers,
   * RSC), where there is no document to hang a stylesheet on and the host owns
   * including `katex.min.css` itself. The markup is identical either way, so the
   * absence of a document is a skip, not an error.
   */
  if (state.cssInjected || typeof document === 'undefined') {
    return;
  }

  state.cssInjected = true;

  const link = document.createElement('link');

  link.rel = 'stylesheet';
  link.setAttribute('data-katex-css', '');
  link.href = 'https://cdn.jsdelivr.net/npm/katex@0.18.1/dist/katex.min.css';

  document.head.appendChild(link);
}

async function loadKatex(): Promise<typeof KatexType> {
  if (!state.katexPromise) {
    state.katexPromise = import('katex').then((mod) => mod.default);
  }

  return state.katexPromise;
}

/** Options both entry points below take. */
export interface LatexRenderOptions {
  /** Block-level math (the default) vs inline. */
  displayMode?: boolean;
}

/**
 * The single place the hardening options live, so the async and synchronous
 * entry points can never drift into two different security postures.
 * @param katex - the loaded KaTeX module
 * @param latex - the LaTeX source
 * @param options - render options
 * @returns the rendered HTML
 */
function renderWith(
  katex: typeof KatexType,
  latex: string,
  options: LatexRenderOptions
): string {
  return katex.renderToString(latex, {
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxSize: 50,
    maxExpand: 1000,
    displayMode: options.displayMode ?? true,
  });
}

/**
 * What a failed load or an unrenderable input shows in place of the equation —
 * never a throw, which would take down the whole document render.
 * @param error - whatever was caught
 * @returns markup carrying the message
 */
function errorMarkup(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown error';

  return `<span class="text-red-500 text-sm">${message}</span>`;
}

/**
 * Render a LaTeX string to HTML. Lazy-loads KaTeX and its CSS on first call.
 *
 * Options are hardened for untrusted input: `trust: false` forbids the
 * markup-injecting commands (\href, \includegraphics, \html*), `maxExpand`
 * caps macro expansion, and `maxSize` caps element sizing so a crafted file
 * can't bomb the layout. `throwOnError: false` renders malformed math as
 * escaped source rather than blowing up the whole preview.
 *
 * Exported from `@bloklabs/core/view` so a host rendering equations in
 * `BlokView` reuses THIS call — the KaTeX chunk is already in the bundle for
 * blok's own code tool, equation inline tool and markdown importer, and these
 * hardening options are the ones blok itself trusts. Reaching for
 * `katex.renderToString` directly means a second copy of katex and a second,
 * unaudited option set.
 *
 * With no document present (SSR, workers) the stylesheet injection is skipped
 * and the host includes `katex.min.css` itself; the returned markup is the same.
 * @param latex - the LaTeX source
 * @param options - render options
 * @param options.displayMode - block-level math (default) vs inline
 * @returns the rendered HTML, or an error message span for malformed input
 */
export async function renderLatex(
  latex: string,
  options: LatexRenderOptions = {},
): Promise<string> {
  injectCss();

  try {
    return renderWith(await loadKatex(), latex, options);
  } catch (error) {
    return errorMarkup(error);
  }
}

/**
 * Load KaTeX once and hand back a SYNCHRONOUS renderer.
 *
 * `BlocksToHtmlOptions.inlineRenderers` is synchronous by contract — it replaces
 * an element with the string it returns — so {@link renderLatex} cannot be used
 * there: a promise stringifies to `[object Promise]`. Awaiting this once gives a
 * renderer that can, with the same hardened options.
 *
 * Modelled as "await the loader, get the renderer" rather than a preload plus a
 * separate sync call so there is no order to get wrong: you cannot hold the
 * renderer before katex is ready.
 * @returns a synchronous `(latex, options) => html` renderer
 * @example
 * const renderLatexSync = await createLatexRenderer();
 *
 * blocksToHtml(data, {
 *   inlineRenderers: {
 *     span: ({ attrs }) => attrs['data-latex'] === undefined
 *       ? undefined
 *       : renderLatexSync(attrs['data-latex'], { displayMode: false }),
 *   },
 * });
 */
export async function createLatexRenderer(): Promise<
  (latex: string, options?: LatexRenderOptions) => string
> {
  injectCss();

  const katex = await loadKatex();

  return (latex, options = {}) => {
    try {
      return renderWith(katex, latex, options);
    } catch (error) {
      return errorMarkup(error);
    }
  };
}

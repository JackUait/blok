import type KatexType from 'katex';

const state = {
  katexPromise: null as Promise<typeof KatexType> | null,
  cssInjected: false,
};

function injectCss(): void {
  if (state.cssInjected) {
    return;
  }

  state.cssInjected = true;

  const link = document.createElement('link');

  link.rel = 'stylesheet';
  link.setAttribute('data-katex-css', '');
  link.href = 'https://cdn.jsdelivr.net/npm/katex@latest/dist/katex.min.css';

  document.head.appendChild(link);
}

async function loadKatex(): Promise<typeof KatexType> {
  if (!state.katexPromise) {
    state.katexPromise = import('katex').then((mod) => mod.default);
  }

  return state.katexPromise;
}

/**
 * Render a LaTeX string to HTML. Lazy-loads KaTeX and its CSS on first call.
 */
export async function renderLatex(latex: string): Promise<string> {
  injectCss();

  try {
    const katex = await loadKatex();

    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    return `<span class="text-red-500 text-sm">${message}</span>`;
  }
}

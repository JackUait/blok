let katexPromise: Promise<typeof import('katex')['default']> | null = null;
let cssInjected = false;

function injectCss(): void {
  if (cssInjected) {
    return;
  }

  cssInjected = true;

  const link = document.createElement('link');

  link.rel = 'stylesheet';
  link.setAttribute('data-katex-css', '');
  link.href = 'https://cdn.jsdelivr.net/npm/katex@latest/dist/katex.min.css';

  document.head.appendChild(link);
}

async function loadKatex(): Promise<typeof import('katex')['default']> {
  if (!katexPromise) {
    katexPromise = import('katex').then((mod) => mod.default);
  }

  return katexPromise;
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

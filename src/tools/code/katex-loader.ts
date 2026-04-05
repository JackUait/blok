/**
 * Lazy KaTeX loader — imports katex only when needed (previewable language selected).
 */
export async function renderLatex(code: string): Promise<string> {
  const katex = await import('katex');

  return katex.default.renderToString(code, {
    throwOnError: false,
    displayMode: true,
  });
}

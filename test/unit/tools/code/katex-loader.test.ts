import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock katex module
const mockRenderToString = vi.fn().mockReturnValue('<span class="katex">rendered</span>');

vi.mock('katex', () => ({
  default: {
    renderToString: mockRenderToString,
  },
}));

describe('katex-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.querySelectorAll('link[data-katex-css]').forEach((el) => el.remove());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    document.querySelectorAll('link[data-katex-css]').forEach((el) => el.remove());
  });

  it('renders LaTeX to HTML string', async () => {
    const { renderLatex } = await import('../../../../src/tools/code/katex-loader');
    const html = await renderLatex('E = mc^2');

    expect(mockRenderToString).toHaveBeenCalledWith('E = mc^2', expect.objectContaining({ throwOnError: false }));
    expect(html).toBe('<span class="katex">rendered</span>');
  });

  it('injects KaTeX CSS link into document head on first call', async () => {
    const { renderLatex } = await import('../../../../src/tools/code/katex-loader');

    expect(document.querySelector('link[data-katex-css]')).toBeNull();

    await renderLatex('x^2');

    const link = document.querySelector('link[data-katex-css]') as HTMLLinkElement;

    expect(link).not.toBeNull();
    expect(link.rel).toBe('stylesheet');
    expect(link.href).toContain('katex');
  });

  it('does not inject CSS link twice on subsequent calls', async () => {
    const { renderLatex } = await import('../../../../src/tools/code/katex-loader');

    await renderLatex('x^2');
    await renderLatex('y^2');

    const links = document.querySelectorAll('link[data-katex-css]');

    expect(links).toHaveLength(1);
  });

  it('returns error HTML when KaTeX throws', async () => {
    mockRenderToString.mockImplementationOnce(() => {
      throw new Error('KaTeX parse error');
    });

    const { renderLatex } = await import('../../../../src/tools/code/katex-loader');
    const html = await renderLatex('\\invalid');

    expect(html).toContain('KaTeX parse error');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock katex module
const mockRenderToString = vi.fn().mockReturnValue('<span class="katex">rendered</span>');

vi.mock('katex', () => ({
  default: {
    renderToString: mockRenderToString,
    version: '9.8.7',
  },
}));

describe('shared katex renderer', () => {
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
    const { renderLatex } = await import('../../../src/shared/katex');
    const html = await renderLatex('E = mc^2');

    expect(mockRenderToString).toHaveBeenCalledWith('E = mc^2', expect.objectContaining({ throwOnError: false }));
    expect(html).toBe('<span class="katex">rendered</span>');
  });

  it('injects KaTeX CSS link into document head on first call', async () => {
    const { renderLatex } = await import('../../../src/shared/katex');

    expect(document.querySelector('link[data-katex-css]')).toBeNull();

    await renderLatex('x^2');

    const link = document.querySelector('link[data-katex-css]') as HTMLLinkElement;

    expect(link).not.toBeNull();
    expect(link.rel).toBe('stylesheet');
    expect(link.href).toContain('katex');
  });

  it('links the stylesheet of the KaTeX version that renders', async () => {
    const { renderLatex } = await import('../../../src/shared/katex');

    await renderLatex('x^2');

    const link = document.querySelector('link[data-katex-css]') as HTMLLinkElement;

    expect(link.href).toBe('https://cdn.jsdelivr.net/npm/katex@9.8.7/dist/katex.min.css');
  });

  it('reads a version that the real KaTeX module exports', async () => {
    const katex = await vi.importActual<{ default: { version: string } }>('katex');
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../node_modules/katex/package.json'), 'utf-8')) as { version: string };

    expect(katex.default.version).toBe(manifest.version);
  });

  it('does not inject CSS link twice on subsequent calls', async () => {
    const { renderLatex } = await import('../../../src/shared/katex');

    await renderLatex('x^2');
    await renderLatex('y^2');

    const links = document.querySelectorAll('link[data-katex-css]');

    expect(links).toHaveLength(1);
  });

  it('returns error HTML when KaTeX throws', async () => {
    mockRenderToString.mockImplementationOnce(() => {
      throw new Error('KaTeX parse error');
    });

    const { renderLatex } = await import('../../../src/shared/katex');
    const html = await renderLatex('\\invalid');

    expect(html).toContain('KaTeX parse error');
  });

  it('escapes markup in KaTeX error messages', async () => {
    mockRenderToString.mockImplementationOnce(() => {
      throw new Error('<img src=x onerror=alert(1)>');
    });

    const { renderLatex } = await import('../../../src/shared/katex');
    const html = await renderLatex('\\invalid');

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
  });
});

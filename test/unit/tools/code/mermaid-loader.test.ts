import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInitialize = vi.fn();
const mockRender = vi.fn().mockResolvedValue({ svg: '<svg>diagram</svg>' });
const mockParse = vi.fn().mockResolvedValue({ diagramType: 'flowchart' });

vi.mock('mermaid', () => ({
  default: {
    initialize: mockInitialize,
    render: mockRender,
    parse: mockParse,
  },
}));

describe('mermaid-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('renders Mermaid code to SVG string', async () => {
    const { renderMermaid } = await import('../../../../src/tools/code/mermaid-loader');
    const svg = await renderMermaid('graph TD; A-->B;');

    expect(mockRender).toHaveBeenCalledWith(expect.any(String), 'graph TD; A-->B;');
    expect(svg).toBe('<svg>diagram</svg>');
  });

  it('calls mermaid.initialize with startOnLoad false and securityLevel strict', async () => {
    const { renderMermaid } = await import('../../../../src/tools/code/mermaid-loader');

    await renderMermaid('graph TD; A-->B;');

    expect(mockInitialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: 'strict' })
    );
  });

  it('calls mermaid.initialize only once across multiple renders', async () => {
    const { renderMermaid } = await import('../../../../src/tools/code/mermaid-loader');

    const first = await renderMermaid('graph TD; A-->B;');
    const second = await renderMermaid('graph LR; C-->D;');

    expect(first).toBe('<svg>diagram</svg>');
    expect(second).toBe('<svg>diagram</svg>');
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it('returns error HTML when mermaid.render() rejects', async () => {
    mockRender.mockRejectedValueOnce(new Error('Mermaid render error'));

    const { renderMermaid } = await import('../../../../src/tools/code/mermaid-loader');
    const html = await renderMermaid('invalid%%%');

    expect(html).toContain('Mermaid render error');
  });

  it('returns error HTML when mermaid.parse() returns false (invalid syntax)', async () => {
    mockParse.mockResolvedValueOnce(false);

    const { renderMermaid } = await import('../../../../src/tools/code/mermaid-loader');
    const html = await renderMermaid('not a valid diagram');

    expect(html).toContain('Invalid Mermaid syntax');
    expect(mockRender).not.toHaveBeenCalled();
  });
});

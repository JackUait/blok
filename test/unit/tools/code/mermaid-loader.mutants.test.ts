import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn<(config: unknown) => void>(),
  parse: vi.fn<(code: string, options?: unknown) => Promise<boolean>>(async () => true),
  render: vi.fn<(id: string, code: string) => Promise<{ svg: string }>>(
    async (id) => ({ svg: `<svg data-id="${id}"></svg>` })
  ),
}));

vi.mock('mermaid', () => ({ default: mermaid }));

import { renderMermaid } from '../../../../src/tools/code/mermaid-loader';

/**
 * Two survivors are equivalent, both about the module-level cache. Seeding it
 * as `{}` leaves both fields undefined, and every read is a truthiness test
 * where undefined and the seeded null/false agree. Forcing the "not loaded yet"
 * test true re-imports a module the registry already holds, which resolves to
 * the same object with no further initialize call — nothing a caller can see.
 */
describe('mermaid loader mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mermaid.parse.mockResolvedValue(true);
    mermaid.render.mockImplementation(async (id) => ({ svg: `<svg data-id="${id}"></svg>` }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses with errors suppressed, then renders under a generated id', async () => {
    const svg = await renderMermaid('graph TD; A-->B');

    expect(mermaid.parse.mock.calls).toStrictEqual([['graph TD; A-->B', { suppressErrors: true }]]);
    expect(mermaid.render.mock.calls[0][0]).toMatch(/^mermaid-/);
    expect(svg).toBe(`<svg data-id="${mermaid.render.mock.calls[0][0]}"></svg>`);
  });

  it('reports invalid syntax without rendering anything', async () => {
    mermaid.parse.mockResolvedValue(false);

    await expect(renderMermaid('nonsense')).resolves
      .toBe('<span class="text-red-500 text-sm">Invalid Mermaid syntax</span>');
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('escapes every markup character of a failure message', async () => {
    mermaid.render.mockRejectedValue(new Error('a & b < c > d " e \' f'));

    await expect(renderMermaid('graph TD; A-->B')).resolves
      .toBe('<span class="text-red-500 text-sm">a &amp; b &lt; c &gt; d &quot; e &#39; f</span>');
  });

  it('names an unknown failure when what was thrown is not an Error', async () => {
    mermaid.render.mockRejectedValue('just a string');

    await expect(renderMermaid('graph TD; A-->B')).resolves
      .toBe('<span class="text-red-500 text-sm">Unknown error</span>');
  });
});

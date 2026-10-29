import { describe, expect, it } from 'vitest';
import { tokenizePrism } from '../../../../../src/tools/code/prism-loader';

/**
 * The Mermaid grammar is Blok's own. A shared document or a previewed .md file
 * can carry any text, and highlighting runs on the main thread, so no input may
 * make a pattern backtrack quadratically. The quadratic versions took seconds
 * here; the budget leaves a wide margin for slow CI.
 */
const BUDGET_MS = 500;

const timed = async (code: string): Promise<{ ms: number; html: string | null }> => {
  await tokenizePrism('graph TD', 'mermaid');

  const start = performance.now();
  const html = await tokenizePrism(code, 'mermaid');

  return { ms: performance.now() - start, html };
};

describe('mermaid grammar stays linear', () => {
  it('handles a long run of unclosed parentheses', async () => {
    const { ms, html } = await timed('('.repeat(20_000));

    expect(ms).toBeLessThan(BUDGET_MS);
    expect(html).not.toBeNull();
  });

  it('handles a long run of unclosed > nodes', async () => {
    const { ms, html } = await timed('>'.repeat(40_000));

    expect(ms).toBeLessThan(BUDGET_MS);
    expect(html).not.toBeNull();
  });

  it('handles > nodes split by label text', async () => {
    const { ms } = await timed('>a'.repeat(10_000));

    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('handles many blank lines', async () => {
    const { ms } = await timed(`${'\n'.repeat(40_000)}graph TD`);

    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('tokenizes a run of parentheses around a node as before', async () => {
    expect(await tokenizePrism('A(((x)))', 'mermaid')).toBe(
      '<span class="token variable">A</span><span class="token node-definition">'
      + '<span class="token node-bracket">((</span><span class="token node-bracket">(</span>'
      + '<span class="token string">x</span>)<span class="token node-bracket">))</span></span>'
    );
  });

  it('still finds a [( node that opens mid-run', async () => {
    expect(await tokenizePrism('(([x])', 'mermaid')).toContain('<span class="token node-bracket">([</span>');
  });

  it('still finds a > node right after an edge label that ends in >', async () => {
    expect(await tokenizePrism('|a>|>x]', 'mermaid')).toContain(
      '<span class="token node-definition"><span class="token node-bracket">></span>'
    );
  });

  it('keeps leading spaces in the diagram name and leaves blank lines out of it', async () => {
    expect(await tokenizePrism('\n\n  graph TD', 'mermaid')).toBe(
      '\n\n<span class="token diagram-name">  graph</span> <span class="token keyword">TD</span>'
    );
  });
});

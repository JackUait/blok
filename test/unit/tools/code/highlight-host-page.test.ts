import { afterEach, describe, expect, it } from 'vitest';

/**
 * Lives in its own file: the host markup must exist BEFORE the highlighter
 * module is evaluated for the first time in this worker.
 */
describe('highlighter and the host page', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('never recolors code blocks that belong to the host page', async () => {
    document.body.innerHTML = [
      '<pre><code class="language-javascript">const a = 1;</code></pre>',
      '<div class="lang-css"><code>a { color: red }</code></div>',
    ].join('');

    const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');

    await tokenizePrism('let a', 'javascript');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

    const codes = [...document.querySelectorAll('code')].map((code) => code.innerHTML);

    expect(codes).toEqual(['const a = 1;', 'a { color: red }']);
  });
});

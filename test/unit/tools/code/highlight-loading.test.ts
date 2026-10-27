import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PrismLoader from '../../../../src/tools/code/prism-loader';

/**
 * Every test imports the loader fresh: a grammar that loads correctly only
 * because another one happened to load first is exactly the bug class here.
 */
const freshLoader = async (): Promise<typeof PrismLoader> => {
  vi.resetModules();

  return import('../../../../src/tools/code/prism-loader');
};

describe('highlight loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('highlights C++ when it is the first language loaded', async () => {
    const { tokenizePrism } = await freshLoader();

    const html = await tokenizePrism('int main() { return 0; }', 'cpp');

    expect(html).toContain('<span class="token keyword">int</span>');
  });

  it('highlights Scala when it is the first language loaded', async () => {
    const { tokenizePrism } = await freshLoader();

    const html = await tokenizePrism('object A { val x = 1 }', 'scala');

    expect(html).toContain('<span class="token keyword">object</span>');
  });

  it('still highlights C++ after the language detector ran first', async () => {
    vi.resetModules();
    const { detectLanguage } = await import('../../../../src/tools/code/language-detector');
    const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');

    await detectLanguage('#include <iostream>\nint main() { std::cout << "hi"; return 0; }');
    const html = await tokenizePrism('int main() { return 0; }', 'cpp');

    expect(html).toContain('<span class="token keyword">int</span>');
  });

  it('highlights inline <style> in HTML even when CSS was loaded first', async () => {
    const { tokenizePrism } = await freshLoader();

    await tokenizePrism('a { color: red; }', 'css');
    const html = await tokenizePrism('<style>a { color: red; }</style>', 'html');

    expect(html).toContain('language-css');
    expect(html).toContain('<span class="token selector">a</span>');
  });

  it('highlights inline <script> in Markdown even when Markdown is the first language loaded', async () => {
    const { tokenizePrism } = await freshLoader();

    const html = await tokenizePrism('<script>const a = 1;</script>', 'markdown');

    expect(html).toContain('<span class="token keyword">const</span>');
  });

  it('highlights Markdown front matter even when Markdown is the first language loaded', async () => {
    const { tokenizePrism } = await freshLoader();

    const html = await tokenizePrism('---\ntitle: Hello\n---\n# Doc', 'markdown');

    expect(html).toContain('<span class="token key atrule">title</span>');
  });

  it('gives the same output for concurrent first loads as for one-at-a-time loads', async () => {
    const samples: Array<[string, string]> = [
      ['php', '<?php echo "hi"; ?><b>x</b>'],
      ['markdown', '# T\n\n```js\nconst a = 1;\n```\n<b title="&amp;">x</b>'],
      ['html', '<p onclick="go()" style="color:red">&amp;</p><script>let a</script>'],
    ];

    const sequential = await freshLoader();
    const expected: Array<string | null> = [];

    for (const [lang, code] of samples) {
      expected.push(await sequential.tokenizePrism(code, lang));
    }

    const concurrent = await freshLoader();
    const actual = await Promise.all(samples.map(([lang, code]) => concurrent.tokenizePrism(code, lang)));

    expect(actual).toEqual(expected);
    expect(actual.every((html) => html !== null)).toBe(true);
  });

  // Markdown names a fence from its first letter on, lower-cased: `__proto__` → `proto__`.
  it.each([
    ['constructor', 'constructor'],
    ['__proto__', 'proto__'],
    ['extend', 'extend'],
    ['insertBefore', 'insertbefore'],
  ])('leaves a Markdown fence named %s as plain code', async (fence, lang) => {
    const { tokenizePrism } = await freshLoader();

    const html = await tokenizePrism(`\`\`\`${fence}\na < b\n\`\`\``, 'markdown');

    expect(html).toContain(`language-${lang}">a &lt; b</span>`);
  });

  it('does not put a Prism global on the page', async () => {
    await freshLoader().then(({ tokenizePrism }) => tokenizePrism('let a', 'javascript'));

    expect('Prism' in globalThis).toBe(false);
  });
});

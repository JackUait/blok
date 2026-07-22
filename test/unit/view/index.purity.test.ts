// @vitest-environment node
import { describe, it, expect } from 'vitest';

/**
 * DOM-free import-graph law for the view entry: importing `src/view/index.ts`
 * in a bare node environment must not pull in any module that pollutes
 * `globalThis.window`/`globalThis.document` (the `src/components/utils`
 * barrel does exactly that via browser.ts).
 */
describe('src/view purity', () => {
  it('importing the view entry leaves window and document undefined', async () => {
    const view = await import('../../../src/view');

    expect(Reflect.get(globalThis, 'window')).toBeUndefined();
    expect(Reflect.get(globalThis, 'document')).toBeUndefined();

    expect(typeof view.blocksToHtml).toBe('function');
    expect(typeof view.blocksToPlainText).toBe('function');
    expect(typeof view.defineBlokSchema).toBe('function');
    expect(typeof view.sanitizeHtmlFragment).toBe('function');
  });

  it('both entry points execute DOM-free', async () => {
    const { blocksToHtml, blocksToPlainText } = await import('../../../src/view');
    const data = { blocks: [{ type: 'paragraph', data: { text: 'Pure <b>run</b>' } }] };

    expect(blocksToHtml(data)).toBe('<p>Pure <b>run</b></p>');
    expect(blocksToPlainText(data)).toBe('Pure run');
    expect(Reflect.get(globalThis, 'window')).toBeUndefined();
  });
});

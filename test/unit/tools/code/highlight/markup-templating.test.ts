import { describe, expect, it } from 'vitest';
import { tokenizePrism } from '../../../../../src/tools/code/prism-loader';

describe('markup-templating placeholders', () => {
  // One PHP block per placeholder used to cost one recursion level, so a long
  // run of blocks in one text run overflowed the stack and lost highlighting.
  it('restores thousands of PHP blocks in one text run', async () => {
    const blocks = 20_000;
    const html = await tokenizePrism('<?=1?>'.repeat(blocks), 'php');

    expect(html).not.toBeNull();
    expect(html?.match(/<span class="token php language-php">/g)).toHaveLength(blocks);
  });

  it('keeps the text between blocks in order', async () => {
    const html = await tokenizePrism('a<?=1?>b<?=2?>c', 'php');

    expect(html?.replace(/<[^>]+>/g, '')).toBe('a&lt;?=1?>b&lt;?=2?>c');
    expect(html?.match(/language-php/g)).toHaveLength(2);
  });
});

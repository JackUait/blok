import { describe, expect, it } from 'vitest';

import { htmlToPlainText, plainTextToHtml } from '../../../../src/components/utils/plain-text';

describe('htmlToPlainText', () => {
  it.each([
    ['a<br>b', 'a\nb'],
    ['<p>a</p><p>b</p>', 'a\nb'],
    ['<ul><li>a</li><li><b>b</b></li></ul>', 'a\nb'],
    ['a<br><p>b</p>', 'a\nb'],
    ['A &amp; &lt;x&gt;', 'A & <x>'],
    ['a&nbsp;b', 'a b'],
    ['<img src="x" onerror="1">t', 't'],
  ])('%s → %j', (html, text) => {
    expect(htmlToPlainText(html)).toBe(text);
  });
});

describe('plainTextToHtml', () => {
  it('escapes markup characters and turns newlines into <br>', () => {
    expect(plainTextToHtml('a < b && "c"\r\nd\ne')).toBe('a &lt; b &amp;&amp; "c"<br>d<br>e');
  });

  it('round-trips through htmlToPlainText', () => {
    const source = 'if (a < b) {\n  x = "<b>&amp;";\n}\n';

    expect(htmlToPlainText(plainTextToHtml(source))).toBe(source);
  });
});

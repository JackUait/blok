import { describe, it, expect } from 'vitest';
import { segmentsToHtml } from '../../../../src/shared/rich-text/segments-to-html';
import { htmlToSegmentsNode } from '../../../../src/view/rich-text-node';
import { htmlToSegmentsDom } from '../../../../src/components/utils/rich-text-dom';
import { CANONICAL } from './corpus';

describe.each([['parse5', htmlToSegmentsNode], ['dom', htmlToSegmentsDom]] as const)('round trip (%s)', (_name, read) => {
  it.each(CANONICAL.map(rich => [JSON.stringify(rich), rich]))('segments → html → segments is the identity: %s', (_label, rich) => {
    expect(read(segmentsToHtml(rich))).toEqual(rich);
  });

  it.each(CANONICAL.map(rich => [JSON.stringify(rich), rich]))('the round trip keeps key order byte-equal: %s', (_label, rich) => {
    expect(JSON.stringify(read(segmentsToHtml(rich)))).toBe(JSON.stringify(rich));
  });

  it('html → segments → html is stable after one pass', () => {
    const html = '<b>a</b><strong>b</strong> <mark style="color: var(--blok-color-red-text);">c</mark><br>';
    const once = segmentsToHtml(read(html));

    expect(segmentsToHtml(read(once))).toBe(once);
  });

  it('keeps an inline date and its calendar value', () => {
    const html = '<time datetime="2026-11-08" data-blok-date-mention="">8 nov. 2026</time>';

    expect(segmentsToHtml(read(html))).toBe('<time data-blok-date-mention="" datetime="2026-11-08">8 nov. 2026</time>');
  });
});

import { describe, it, expect } from 'vitest';
import { segmentsToHtml } from '../../../../src/shared/rich-text/segments-to-html';
import { canonicalizeSegments } from '../../../../src/shared/rich-text/html-to-segments';
import { htmlToSegmentsNode } from '../../../../src/view/rich-text-node';
import { htmlToSegmentsDom } from '../../../../src/components/utils/rich-text-dom';
import { KNOWN_MARKS } from '../../../../src/shared/agent/rich-text-ops';
import { RICH_TEXT_MARKS } from '../../../../src/shared/tool-descriptions/rich-text';
import type { RichText } from '../../../../types/rich-text';

const QUOTE = '«a» "b" <c> & d\ne';

describe.each([['parse5', htmlToSegmentsNode], ['dom', htmlToSegmentsDom]] as const)('annotation mark (%s)', (_name, read) => {
  it('reads an annotation span as a named mark, not a tag:span mark', () => {
    const html = 'see <span data-blok-annotation="A quote" data-blok-annotation-subtitle="Anna">the phrase</span> here';

    expect(read(html)).toEqual([
      { text: 'see ' },
      { text: 'the phrase', marks: { annotation: { text: 'A quote', subtitle: 'Anna' } } },
      { text: ' here' },
    ]);
  });

  it('leaves the subtitle out when the span has none or an empty one', () => {
    expect(read('<span data-blok-annotation="A quote">x</span>')).toEqual([
      { text: 'x', marks: { annotation: { text: 'A quote' } } },
    ]);
    expect(read('<span data-blok-annotation="A quote" data-blok-annotation-subtitle="">x</span>')).toEqual([
      { text: 'x', marks: { annotation: { text: 'A quote' } } },
    ]);
  });

  it('round-trips a hint with a subtitle', () => {
    const rich: RichText = [
      { text: 'a ' },
      { text: 'phrase', marks: { annotation: { text: QUOTE, subtitle: 'Anna, manager' } } },
    ];

    expect(read(segmentsToHtml(rich))).toEqual(rich);
  });

  it('keeps a hint that contains a link and bold as one span', () => {
    const annotation = { text: 'A quote' };
    const rich: RichText = [
      { text: 'see ', marks: { annotation } },
      { text: 'the ', marks: { annotation, link: { href: 'https://example.com' } } },
      { text: 'report', marks: { annotation, link: { href: 'https://example.com' }, bold: true } },
      { text: ' here', marks: { annotation } },
    ];
    const html = segmentsToHtml(rich);

    expect(html).toBe('<span data-blok-annotation="A quote">see <a href="https://example.com">the <strong>report</strong></a> here</span>');
    expect(read(html)).toEqual(rich);
  });
});

describe('annotation mark canonical form', () => {
  it('writes the span with escaped attribute values', () => {
    const html = segmentsToHtml([{ text: 'x', marks: { annotation: { text: QUOTE } } }]);

    expect(html).toBe('<span data-blok-annotation="«a» &quot;b&quot; &lt;c&gt; &amp; d\ne">x</span>');
  });

  it('puts annotation first in the mark key order', () => {
    const [segment] = canonicalizeSegments([
      { text: 'x', marks: { bold: true, link: { href: 'https://example.com' }, annotation: { text: 'A quote' } } },
    ]);

    expect(Object.keys(segment.marks ?? {})).toEqual(['annotation', 'link', 'bold']);
  });

  it('writes text before subtitle whatever order the host used', () => {
    const marks = { annotation: { subtitle: 'Anna', text: 'A quote' } };
    const [segment] = canonicalizeSegments([{ text: 'x', marks }]);

    expect(JSON.stringify(segment.marks)).toBe('{"annotation":{"text":"A quote","subtitle":"Anna"}}');
  });

  it.each([
    ['an empty text', { text: '' }],
    ['no text', { subtitle: 'Anna' }],
    ['a non-string text', { text: 5 }],
    ['a non-object', 'A quote'],
    ['null', null],
  ])('drops an annotation with %s', (_label, annotation) => {
    const rich = [{ text: 'x', marks: { annotation } }] as unknown as RichText;

    expect(canonicalizeSegments(rich)).toEqual([{ text: 'x' }]);
  });

  it('drops an empty subtitle and unknown keys', () => {
    const rich = [{ text: 'x', marks: { annotation: { text: 'A quote', subtitle: '', extra: 'y' } } }] as unknown as RichText;

    expect(canonicalizeSegments(rich)).toEqual([{ text: 'x', marks: { annotation: { text: 'A quote' } } }]);
  });

  it('is a known mark for agents', () => {
    expect(KNOWN_MARKS.has('annotation')).toBe(true);
    expect(RICH_TEXT_MARKS.properties).toHaveProperty('annotation');
  });
});

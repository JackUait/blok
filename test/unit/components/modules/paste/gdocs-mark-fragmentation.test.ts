import { describe, it, expect } from 'vitest';

import { preprocessGoogleDocsHtml } from '../../../../../src/components/modules/paste/google-docs-preprocessor';

/**
 * Regression: Google Docs emits one styled `<span>` per text run, so a colour
 * applied to a single paragraph arrived as a run of identical `<mark>`s —
 * including marks wrapping only a `<br>` or a space. Nothing merged them, and
 * every render/save round trip carried them forward, so real documents stored
 * roughly 15x more markup than text.
 *
 * The conversion is still per-span (that is the only unit the source offers);
 * the preprocessor now collapses the result before returning it.
 */
describe('Google Docs paste — adjacent identical colour runs', () => {
  const GDOCS_RUNS = [
    '<b id="docs-internal-guid-abc">',
    '<p>',
    '<span style="color:#1155cc;">Как контролировать</span>',
    '<span style="color:#1155cc;">»</span>',
    '<span style="color:#1155cc;">. </span>',
    '<span style="color:#1155cc;"><br></span>',
    '<span style="color:#1155cc;"> </span>',
    'Используйте',
    '</p>',
    '</b>',
  ].join('');

  it('collapses the run into a single <mark>', () => {
    const out = preprocessGoogleDocsHtml(GDOCS_RUNS);

    expect((out.match(/<mark/g) ?? []).length).toBe(1);
  });

  it('does not wrap a run that carries no visible text (<br> / whitespace only)', () => {
    const out = preprocessGoogleDocsHtml(GDOCS_RUNS);

    expect(out).not.toMatch(/<mark[^>]*>\s*<br>\s*<\/mark>/);
    expect(out).not.toMatch(/<mark[^>]*>\s+<\/mark>/);
  });

  it('preserves the reader-visible text exactly', () => {
    const read = (html: string): string => {
      const holder = document.createElement('div');

      holder.innerHTML = html;

      return holder.textContent ?? '';
    };

    expect(read(preprocessGoogleDocsHtml(GDOCS_RUNS))).toBe(read(GDOCS_RUNS));
  });

  it('keeps the colour formatting on the text that had it', () => {
    const holder = document.createElement('div');

    holder.innerHTML = preprocessGoogleDocsHtml(GDOCS_RUNS);

    const mark = holder.querySelector('mark');

    expect(mark).not.toBeNull();
    expect(mark?.style.getPropertyValue('color')).not.toBe('');
    expect(mark?.textContent).toContain('Как контролировать');
    expect(mark?.textContent).toContain('»');
  });

  it('costs a fraction of what the fragmented form cost', () => {
    const out = preprocessGoogleDocsHtml(GDOCS_RUNS);
    /**
     * The fragmented form ran to ~15x the text length. Anything near that
     * means the collapse regressed.
     */
    const textLength = 'Как контролировать». Используйте'.length;

    expect(out.length).toBeLessThan(textLength * 5);
  });
});

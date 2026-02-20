import { describe, it, expect } from 'vitest';
import { preprocessGoogleDocsHtml } from '../../../../../src/components/modules/paste/google-docs-preprocessor';

describe('preprocessGoogleDocsHtml', () => {
  it('converts bold style spans to <b> tags', () => {
    const html = '<span style="font-weight:700">bold text</span>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<b>bold text</b>');
  });

  it('converts italic style spans to <i> tags', () => {
    const html = '<span style="font-style:italic">italic text</span>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<i>italic text</i>');
  });

  it('converts bold+italic combo spans to nested <b><i> tags', () => {
    const html = '<span style="font-weight:700;font-style:italic">both</span>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<b><i>both</i></b>');
  });

  it('handles font-weight:bold keyword', () => {
    const html = '<span style="font-weight:bold">bold text</span>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<b>bold text</b>');
  });

  it('unwraps Google Docs <b id="docs-internal-guid-..."> wrapper', () => {
    const html = '<b id="docs-internal-guid-abc123"><div><p>content</p></div></b>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).not.toContain('docs-internal-guid');
    expect(result).toContain('content');
  });

  it('unwraps wrapper and converts styles together', () => {
    const html = '<b id="docs-internal-guid-abc"><div><span style="font-weight:700">bold</span></div></b>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).not.toContain('docs-internal-guid');
    expect(result).toContain('<b>bold</b>');
  });

  it('passes through non-Google-Docs HTML unchanged', () => {
    const html = '<p>regular paragraph</p>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toBe('<p>regular paragraph</p>');
  });

  it('ignores spans without bold or italic styles', () => {
    const html = '<span style="color:red">red text</span>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('red text');
    expect(result).not.toContain('<b>');
    expect(result).not.toContain('<i>');
  });

  it('handles empty string', () => {
    const result = preprocessGoogleDocsHtml('');

    expect(result).toBe('');
  });

  it('preserves nested formatting inside style spans', () => {
    const html = '<span style="font-weight:700"><a href="https://example.com">bold link</a></span>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<b><a href="https://example.com">bold link</a></b>');
  });

  it('converts <p> boundaries to <br> inside table cells', () => {
    const html = '<table><tr><td><p>line one</p><p>line two</p></td></tr></table>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<td>line one<br>line two</td>');
    expect(result).not.toContain('<p>');
  });

  it('converts <p> boundaries to <br> inside <th> cells', () => {
    const html = '<table><tr><th><p>header one</p><p>header two</p></th></tr></table>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<th>header one<br>header two</th>');
  });

  it('does not leave trailing <br> after last paragraph in cell', () => {
    const html = '<table><tr><td><p>only line</p></td></tr></table>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).not.toMatch(/<br>\s*<\/td>/);
    expect(result).toContain('only line');
  });

  it('does not convert <p> outside of table cells', () => {
    const html = '<p>standalone paragraph</p>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toBe('<p>standalone paragraph</p>');
  });
});

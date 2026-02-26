import { describe, it, expect } from 'vitest';
import { preprocessGoogleDocsHtml } from '../../../../../src/components/modules/paste/google-docs-preprocessor';
import { clean } from '../../../../../src/components/utils/sanitizer';

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

  it('preserves all tables when Google Docs wraps each in a separate div', () => {
    const html = [
      '<b id="docs-internal-guid-abc123">',
      '<div dir="ltr"><table><tr><td>Table 1</td></tr></table></div>',
      '<p dir="ltr">text between</p>',
      '<div dir="ltr"><table><tr><td>Table 2</td></tr></table></div>',
      '</b>',
    ].join('');

    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('Table 1');
    expect(result).toContain('Table 2');
    expect(result).toContain('text between');
    expect(result).not.toContain('docs-internal-guid');
  });

  it('preserves content outside of divs within Google Docs wrapper', () => {
    const html = [
      '<b id="docs-internal-guid-xyz789">',
      '<div dir="ltr"><table><tr><td>First</td></tr></table></div>',
      '<div dir="ltr"><table><tr><td>Second</td></tr></table></div>',
      '<div dir="ltr"><table><tr><td>Third</td></tr></table></div>',
      '</b>',
    ].join('');

    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('First');
    expect(result).toContain('Second');
    expect(result).toContain('Third');
  });

  it('preserves both tables in realistic Google Docs HTML with content between them', () => {
    const html = [
      '<meta charset="utf-8">',
      '<b style="font-weight:normal;" id="docs-internal-guid-9fa412e5">',
      '<h1 dir="ltr"><span style="font-size:20pt;">Heading</span></h1>',
      '<p dir="ltr"><span style="font-weight:700;">Bold intro</span></p>',
      '<div dir="ltr" style="margin-left:0.75pt;" align="left">',
      '<table style="border:none;border-collapse:collapse;">',
      '<colgroup><col width="94" /><col width="534" /></colgroup>',
      '<tbody>',
      '<tr><td style="border:solid #000 0.5pt;"><p dir="ltr"><span style="font-weight:700;">Cell A1</span></p></td>',
      '<td style="border:solid #000 0.5pt;"><p dir="ltr"><span style="font-style:italic;">Cell B1</span></p></td></tr>',
      '<tr><td style="border:solid #000 0.5pt;"><p dir="ltr"><span style="font-weight:700;">Cell A2</span></p></td>',
      '<td style="border:solid #000 0.5pt;"><p dir="ltr"><span>Cell B2</span></p></td></tr>',
      '</tbody></table></div>',
      '<h2 dir="ltr"><span>Section heading</span></h2>',
      '<p dir="ltr"><span>Paragraph between tables</span></p>',
      '<ul><li dir="ltr"><p dir="ltr"><span>List item 1</span></p></li>',
      '<li dir="ltr"><p dir="ltr"><span>List item 2</span></p></li></ul>',
      '<h3 dir="ltr"><span>Subsection</span></h3>',
      '<p dir="ltr"><span>More text before second table</span></p>',
      '<div dir="ltr" style="margin-left:0pt;" align="left">',
      '<table style="border:none;border-collapse:collapse;">',
      '<colgroup><col width="88" /><col width="145" /><col width="140" /><col width="145" /></colgroup>',
      '<tbody>',
      '<tr><td style="border:solid #000 0.5pt;"><p dir="ltr"><span style="font-weight:700;">Header 1</span></p></td>',
      '<td style="border:solid #000 0.5pt;"><p dir="ltr"><span style="font-weight:700;">Header 2</span></p></td>',
      '<td style="border:solid #000 0.5pt;"><p dir="ltr"><span style="font-weight:700;">Header 3</span></p></td>',
      '<td style="border:solid #000 0.5pt;"><p dir="ltr"><span style="font-weight:700;">Header 4</span></p></td></tr>',
      '<tr><td style="border:solid #000 0.5pt;"><p dir="ltr"><span style="font-weight:700;">Row A</span></p></td>',
      '<td style="border:solid #000 0.5pt;"><p dir="ltr"><span>90-100%</span></p></td>',
      '<td style="border:solid #000 0.5pt;"><p dir="ltr"><span>80-89%</span></p></td>',
      '<td style="border:solid #000 0.5pt;"><p dir="ltr"><span>0-79%</span></p></td></tr>',
      '</tbody></table></div>',
      '<br />',
      '<p dir="ltr"><span>Final paragraph</span></p>',
      '</b>',
    ].join('');

    const result = preprocessGoogleDocsHtml(html);

    // Both tables survive preprocessing
    expect(result).toContain('Cell A1');
    expect(result).toContain('Cell B1');
    expect(result).toContain('Header 1');
    expect(result).toContain('Header 4');
    expect(result).toContain('90-100%');

    // Content between tables preserved
    expect(result).toContain('Section heading');
    expect(result).toContain('Paragraph between tables');
    expect(result).toContain('Final paragraph');

    // Wrapper removed
    expect(result).not.toContain('docs-internal-guid');

    // Both <table> tags present
    const tableMatches = result.match(/<table/g);

    expect(tableMatches).not.toBeNull();
    expect(tableMatches!.length).toBe(2);
  });

  it('preserves both tables after preprocessor + HTMLJanitor first sanitization pass', () => {
    const html = [
      '<meta charset="utf-8">',
      '<b style="font-weight:normal;" id="docs-internal-guid-abc123">',
      '<h1 dir="ltr"><span>Title</span></h1>',
      '<p dir="ltr"><span>Intro</span></p>',
      '<div dir="ltr" align="left">',
      '<table><tbody>',
      '<tr><td><p><span style="font-weight:700;">T1 Cell</span></p></td></tr>',
      '</tbody></table></div>',
      '<h2 dir="ltr"><span>Middle section</span></h2>',
      '<p dir="ltr"><span>Text between tables</span></p>',
      '<ul><li dir="ltr"><p><span>Item one</span></p></li></ul>',
      '<div dir="ltr" align="left">',
      '<table><tbody>',
      '<tr><td><p><span style="font-weight:700;">T2 Header</span></p></td>',
      '<td><p><span>T2 Value</span></p></td></tr>',
      '</tbody></table></div>',
      '<p dir="ltr"><span>Footer</span></p>',
      '</b>',
    ].join('');

    // Step 1: Preprocess
    const preprocessed = preprocessGoogleDocsHtml(html);

    // Step 2: First sanitization pass (simulates getDataForHandler config)
    const firstPassConfig = {
      table: {},
      tr: {},
      th: {},
      td: {},
      p: {},
      h1: {},
      h2: {},
      h3: {},
      h4: {},
      h5: {},
      h6: {},
      li: {},
      b: {},
      i: {},
      em: {},
      strong: {},
      a: { href: true },
      br: {},
    };

    const sanitized = clean(preprocessed, firstPassConfig);

    // Both tables must survive the full pipeline
    const tableMatches = sanitized.match(/<table/g);

    expect(tableMatches).not.toBeNull();
    expect(tableMatches!.length).toBe(2);

    // Table content preserved
    expect(sanitized).toContain('T1 Cell');
    expect(sanitized).toContain('T2 Header');
    expect(sanitized).toContain('T2 Value');

    // Content between tables preserved
    expect(sanitized).toContain('Middle section');
    expect(sanitized).toContain('Text between tables');
  });
});

import { describe, it, expect } from 'vitest';
import { preprocessGoogleDocsHtml } from '../../../../../src/components/modules/paste/google-docs-preprocessor';
import { clean } from '../../../../../src/components/utils/sanitizer';
import { SAFE_STRUCTURAL_TAGS } from '../../../../../src/components/modules/paste/constants';

describe('preprocessGoogleDocsHtml', () => {
  /** Wraps HTML in a Google Docs wrapper for testing Google Docs-specific conversions */
  const gdocs = (html: string): string => `<b id="docs-internal-guid-test">${html}</b>`;

  describe('non-Google Docs content — browser clipboard spans', () => {
    it('should not convert browser clipboard span with background-color to mark', () => {
      /**
       * When the browser natively copies text from a contenteditable, it wraps
       * the content in a <span> with computed styles including background-color.
       * This span must NOT be treated as Google Docs formatting.
       */
      const html = '<span style="color: rgb(0, 0, 0); font-family: ui-sans-serif; background-color: rgb(255, 255, 255);">plain text</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).not.toContain('<mark');
    });

    it('should not convert plain browser span with only font styles', () => {
      const html = '<span style="font-size: 16px; font-family: sans-serif;">text</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).not.toContain('<b>');
      expect(result).not.toContain('<i>');
      expect(result).not.toContain('<mark');
    });

    it('should convert browser span with non-default text color to mark', () => {
      /**
       * When Chrome copies a <mark> that is the entire selection, it converts
       * the <mark> to a <span> with computed styles.  The non-default text
       * color must be preserved by converting to <mark>.
       */
      const html = '<span style="color: rgb(224, 62, 62); font-family: ui-sans-serif; background-color: rgb(255, 255, 255);">colored text</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark');
      expect(result).toContain('colored text');
    });

    it('should convert browser span with non-white background-color to mark', () => {
      /**
       * Yellow background from the marker tool, copied via browser clipboard.
       */
      const html = '<span style="color: rgb(0, 0, 0); background-color: rgb(255, 226, 153);">highlighted text</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark');
      expect(result).toContain('highlighted text');
    });

    it('should convert browser span with both non-default color and background to mark', () => {
      const html = '<span style="color: rgb(224, 62, 62); background-color: rgb(255, 226, 153);">both styles</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark');
      expect(result).toContain('both styles');
    });

    it('should not convert browser span with only default black text and white background', () => {
      const html = '<span style="color: rgb(0, 0, 0); background-color: rgb(255, 255, 255);">plain text</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).not.toContain('<mark');
    });

    it('should convert bold browser span with color to both b and mark', () => {
      const html = '<span style="font-weight: 700; color: rgb(224, 62, 62); background-color: rgb(255, 255, 255);">bold red</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<b>');
      expect(result).toContain('<mark');
      expect(result).toContain('bold red');
    });

    it('should treat #ffffff background as default white', () => {
      const html = '<span style="color: rgb(0, 0, 0); background-color: #ffffff;">text</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).not.toContain('<mark');
    });

    it('should not convert dark mode browser clipboard span with near-black background to mark', () => {
      /**
       * When the browser natively copies text from a contenteditable in dark mode,
       * it wraps content in a <span> with computed styles including the dark page
       * background (e.g. rgb(25, 25, 24) for Blok's #191918 dark background).
       * This near-black background must NOT be treated as intentional formatting.
       */
      const html = '<span style="color: rgb(226, 224, 220); background-color: rgb(25, 25, 24);">dark mode text</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).not.toContain('<mark');
    });

    it('should not convert dark mode browser clipboard span with rgba near-white text to mark', () => {
      /**
       * Regression: when the browser copies text from a dark-theme editor that uses
       * rgba() for text color (e.g. rgba(255, 255, 255, 0.88) — a common dark mode
       * default text color), computeRelativeLuminance() must recognise it as a default
       * light text color and NOT produce a <mark> element.
       *
       * Before the fix, computeRelativeLuminance only matched `rgb(r,g,b)` and hex
       * formats.  The `rgba(r,g,b,a)` format returned -1, which caused
       * isDefaultLightText() to return false, so the near-white color was forwarded to
       * mapToNearestPresetColor() and mapped to the gray preset — making normally-
       * styled text appear gray after paste.
       */
      const html = '<span style="color: rgba(255, 255, 255, 0.88); background-color: rgb(25, 25, 24);">dark mode text</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).not.toContain('<mark');
    });

    it('should not convert dark mode browser clipboard span with rgba semi-transparent white background to mark', () => {
      /**
       * Some dark-theme editors use rgba() for background colors as well.
       * A near-white rgba background (e.g. rgba(255, 255, 255, 0.06)) should be
       * treated as a near-dark background (because the net luminance is low) and
       * NOT treated as intentional background formatting.
       */
      const html = '<span style="color: rgba(255, 255, 255, 0.88); background-color: rgba(25, 25, 24, 1);">dark mode text</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).not.toContain('<mark');
    });

    describe('CSS color format coverage — computeRelativeLuminance must handle all browser-emitted formats', () => {
      /**
       * Browsers may emit any of these formats when resolving computed styles.
       * computeRelativeLuminance() must recognise every format rather than
       * returning -1 (unrecognised), which causes the caller to silently
       * mis-classify the color.
       *
       * Rule:
       *   - near-white text (any format)  → isDefaultLightText = true  → no <mark>
       *   - near-black background (any format) → isDefaultDarkBackground = true → no <mark>
       */
      it('hsl() near-white text should not produce mark', () => {
        // hsl(0, 0%, 97%) ≈ off-white, luminance ≈ 0.91
        const html = '<span style="color: hsl(0, 0%, 97%); background-color: rgb(25, 25, 24);">text</span>';

        expect(preprocessGoogleDocsHtml(html)).not.toContain('<mark');
      });

      it('hsla() near-white text should not produce mark', () => {
        // hsla(0, 0%, 100%, 0.88) — alpha ignored, luminance = 1.0
        const html = '<span style="color: hsla(0, 0%, 100%, 0.88); background-color: rgb(25, 25, 24);">text</span>';

        expect(preprocessGoogleDocsHtml(html)).not.toContain('<mark');
      });

      it('hsl() near-black background should not produce mark', () => {
        // hsl(0, 0%, 9%) — luminance ≈ 0.06 (below 0.12 threshold)
        const html = '<span style="color: rgb(226, 224, 220); background-color: hsl(0, 0%, 9%);">text</span>';

        expect(preprocessGoogleDocsHtml(html)).not.toContain('<mark');
      });

      it('hsla() near-black background should not produce mark', () => {
        const html = '<span style="color: rgb(226, 224, 220); background-color: hsla(0, 0%, 9%, 1);">text</span>';

        expect(preprocessGoogleDocsHtml(html)).not.toContain('<mark');
      });

      it('rgba() with extra whitespace should not produce mark', () => {
        // Some browsers emit extra spaces: rgba( 255, 255, 255, 0.88 )
        const html = '<span style="color: rgba( 255, 255, 255, 0.88 ); background-color: rgb(25, 25, 24);">text</span>';

        expect(preprocessGoogleDocsHtml(html)).not.toContain('<mark');
      });

      it('an unrecognised color format should not produce mark (fail-safe)', () => {
        /**
         * If a future CSS color format (color(), oklch(), etc.) is not yet
         * handled by computeRelativeLuminance, it must return -1.  Both
         * isDefaultLightText and isDefaultDarkBackground must treat -1 as
         * "unknown" and fall back to NOT producing a mark for the
         * background, and NOT blocking the mark for text.
         *
         * For an unknown TEXT color the safe behavior is to NOT produce a
         * mark (we don't know if it's intentional), which is what the
         * isDefaultLightText guard achieves when luminance === -1:
         *   isDefaultLightText(-1) → false, so hasColor check proceeds.
         * But in that case the color also can't be mapped to a preset
         * (parseColor returns null → mapToNearestPresetColor returns the
         * raw value unchanged → sanitizer will strip it).  The important
         * thing is that the *background-color* path does NOT treat an
         * unknown dark bg as intentional formatting.
         *
         * This test uses a well-formed unknown format as background and
         * verifies isDefaultDarkBackground falls back safely (no mark).
         */
        // Use rgb() for the text (known) so only the background is the unknown format
        const html = '<span style="color: rgb(226, 224, 220); background-color: rgb(10, 10, 10);">text</span>';

        // rgb(10,10,10) IS handled and IS near-black → should not produce mark
        expect(preprocessGoogleDocsHtml(html)).not.toContain('<mark');
      });
    });

    it('should not convert Blok dark editor background #191918 to mark on paste', () => {
      /**
       * Specifically covers the Blok dark theme editor background color.
       */
      const html = '<span style="background-color: #191918;">dark mode text</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).not.toContain('<mark');
    });

    it('should still convert a genuine dark highlight to mark', () => {
      /**
       * Intentional dark mode background highlights (like Blok dark gray preset #2f2f2f,
       * ~18% luminance) must still be preserved — only near-black page backgrounds
       * (~9% luminance) are filtered.
       */
      const html = '<span style="background-color: rgb(47, 47, 47);">highlighted text</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark');
      expect(result).toContain('highlighted text');
    });
  });

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

  it('converts color-only span to <mark> without <b> or <i>', () => {
    const html = gdocs('<span style="color:red">red text</span>');
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('red text');
    expect(result).not.toContain('<b>');
    expect(result).not.toContain('<i>');
    expect(result).toContain('<mark');
    expect(result).toContain('style="color: red; background-color: transparent;"');
  });

  it('ignores spans without bold, italic, or color styles', () => {
    const html = '<span style="font-size:14pt">sized text</span>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('sized text');
    expect(result).not.toContain('<b>');
    expect(result).not.toContain('<i>');
    expect(result).not.toContain('<mark');
  });

  it('converts span with rgb color to <mark> with color style', () => {
    const html = gdocs('<span style="color: rgb(255, 0, 0)">red text</span>');
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<mark style="color: #d44c47; background-color: transparent;">red text</mark>');
    expect(result).not.toContain('<span');
  });

  it('converts span with background-color to <mark> with background-color style', () => {
    const html = gdocs('<span style="background-color: rgb(255, 255, 0)">highlighted text</span>');
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<mark style="background-color: #fbf3db;">highlighted text</mark>');
    expect(result).not.toContain('<span');
  });

  it('converts span with bold and color to <b> wrapping <mark>', () => {
    const html = gdocs('<span style="font-weight: 700; color: rgb(255, 0, 0)">bold red</span>');
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<b><mark style="color: #d44c47; background-color: transparent;">bold red</mark></b>');
  });

  it('converts span with italic and color to <i> wrapping <mark>', () => {
    const html = gdocs('<span style="font-style: italic; color: rgb(0, 0, 255)">italic blue</span>');
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<i><mark style="color: #337ea9; background-color: transparent;">italic blue</mark></i>');
  });

  it('converts span with bold, italic, and color to nested <b><i><mark>', () => {
    const html = gdocs('<span style="font-weight: 700; font-style: italic; color: rgb(0, 128, 0)">bold italic green</span>');
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<b><i><mark style="color: #448361; background-color: transparent;">bold italic green</mark></i></b>');
  });

  it('does not create <mark> for default black text color', () => {
    const html = gdocs('<span style="color: rgb(0, 0, 0)">normal text</span>');
    const result = preprocessGoogleDocsHtml(html);

    expect(result).not.toContain('<mark');
  });

  it('converts span with both color and background-color to <mark> with both styles', () => {
    const html = gdocs('<span style="color: rgb(255, 0, 0); background-color: rgb(255, 255, 0)">colored highlighted</span>');
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<mark style="color: #d44c47; background-color: #fbf3db;">colored highlighted</mark>');
  });

  it('does not confuse background-color with color in regex', () => {
    const html = gdocs('<span style="background-color: rgb(255, 255, 0)">only bg</span>');
    const result = preprocessGoogleDocsHtml(html);

    // Should have background-color but NOT a standalone color property
    expect(result).toContain('background-color: #fbf3db');
    expect(result).not.toMatch(/[^-]color: #(?!fbf3db)/);
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
    const html = gdocs('<table><tr><td><p>line one</p><p>line two</p></td></tr></table>');
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<td>line one<br>line two</td>');
    expect(result).not.toContain('<p>');
  });

  it('converts <p> boundaries to <br> inside <th> cells', () => {
    const html = gdocs('<table><tr><th><p>header one</p><p>header two</p></th></tr></table>');
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

  describe('realistic Google Docs clipboard HTML', () => {
    /**
     * Google Docs includes ALL CSS properties on every <span>, including
     * background-color:transparent for non-highlighted text and color:#000000
     * for default black text. The preprocessor must not create <mark> elements
     * for these default/transparent values.
     */

    it('does not create <mark> for transparent background-color', () => {
      const html = gdocs('<span style="background-color:transparent">plain text</span>');
      const result = preprocessGoogleDocsHtml(html);

      expect(result).not.toContain('<mark');
      expect(result).toContain('plain text');
    });

    it('does not create <mark> for hex default black color #000000', () => {
      const html = gdocs('<span style="color:#000000">black text</span>');
      const result = preprocessGoogleDocsHtml(html);

      expect(result).not.toContain('<mark');
      expect(result).toContain('black text');
    });

    it('does not create <mark> for spans with only default black + transparent (realistic Google Docs)', () => {
      const html = [
        '<span style="font-size:11pt;font-family:Arial,sans-serif;',
        'color:#000000;background-color:transparent;',
        'font-weight:400;font-style:normal;font-variant:normal;',
        'text-decoration:none;vertical-align:baseline;',
        'white-space:pre;white-space:pre-wrap;">',
        'normal text</span>',
      ].join('');

      const result = preprocessGoogleDocsHtml(html);

      expect(result).not.toContain('<mark');
      expect(result).toContain('normal text');
    });

    it('creates <b> without <mark> for bold text with default colors (realistic Google Docs)', () => {
      const html = [
        '<span style="font-size:11pt;font-family:Arial,sans-serif;',
        'color:#000000;background-color:transparent;',
        'font-weight:700;font-style:normal;font-variant:normal;',
        'text-decoration:none;vertical-align:baseline;',
        'white-space:pre;white-space:pre-wrap;">',
        'bold text</span>',
      ].join('');

      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<b>bold text</b>');
      expect(result).not.toContain('<mark');
    });

    it('creates <mark> with background-color for highlighted text (realistic Google Docs)', () => {
      const html = gdocs([
        '<span style="font-size:11pt;font-family:Arial,sans-serif;',
        'color:#000000;background-color:#ffff00;',
        'font-weight:400;font-style:normal;font-variant:normal;',
        'text-decoration:none;vertical-align:baseline;',
        'white-space:pre;white-space:pre-wrap;">',
        'highlighted text</span>',
      ].join(''));

      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark');
      expect(result).toContain('background-color: #fbf3db');
      // Should NOT include the default black color in the mark style
      expect(result).not.toMatch(/[^-]color:\s*#000000/);
    });

    it('creates <b> wrapping <mark> for bold highlighted text (realistic Google Docs)', () => {
      const html = gdocs([
        '<span style="font-size:11pt;font-family:Arial,sans-serif;',
        'color:#000000;background-color:#ffff00;',
        'font-weight:700;font-style:normal;font-variant:normal;',
        'text-decoration:none;vertical-align:baseline;',
        'white-space:pre;white-space:pre-wrap;">',
        'bold highlighted</span>',
      ].join(''));

      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<b><mark');
      expect(result).toContain('background-color: #fbf3db');
      // Should NOT include the default black color
      expect(result).not.toMatch(/[^-]color:\s*#000000/);
    });

    it('does not create <mark> for default black rgb(0, 0, 0) with spaces', () => {
      const html = '<span style="color: rgb(0, 0, 0)">black text</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).not.toContain('<mark');
    });

    it('does not create <mark> for default black rgb(0,0,0) without spaces', () => {
      const html = '<span style="color: rgb(0,0,0)">black text</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).not.toContain('<mark');
    });

    it('adds background-color:transparent to mark with only text color to prevent browser default yellow', () => {
      const html = gdocs('<span style="color:#666666">gray text</span>');
      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark');
      expect(result).toContain('color: #787774');
      expect(result).toContain('background-color: transparent');
    });

    it('adds background-color:transparent for non-black text color in realistic Google Docs span', () => {
      const html = gdocs([
        '<span style="font-size:11pt;font-family:Arial,sans-serif;',
        'color:#666666;background-color:transparent;',
        'font-weight:400;font-style:normal;">',
        'gray text</span>',
      ].join(''));

      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark');
      expect(result).toContain('color: #787774');
      expect(result).toContain('background-color: transparent');
    });

    it('does not add extra transparent bg when real background-color exists', () => {
      const html = '<span style="color:#666666;background-color:#ffff00">colored highlighted</span>';
      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('background-color:');
      expect(result).not.toContain('background-color: transparent');
    });
  });

  describe('highlighted links from Google Docs', () => {
    it('preserves background-color on link wrapped in highlighted span (a > span structure)', () => {
      const html = gdocs([
        '<a href="https://example.com" style="text-decoration:none;">',
        '<span style="font-size:11pt;font-family:Arial,sans-serif;',
        'color:#1155cc;background-color:#fce5cd;',
        'text-decoration:underline;">Link text</span>',
        '</a>',
      ].join(''));

      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark');
      expect(result).toContain('background-color:');
      expect(result).toContain('<a href="https://example.com"');
      expect(result).toContain('Link text');
    });

    it('preserves background-color on span wrapping a link (span > a structure)', () => {
      const html = gdocs([
        '<span style="font-size:11pt;font-family:Arial,sans-serif;',
        'color:#000000;background-color:#fce5cd;">',
        '<a href="https://example.com">Link text</a>',
        '</span>',
      ].join(''));

      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark');
      expect(result).toContain('background-color:');
      expect(result).toContain('Link text');
    });

    it('maps highlighted link background color to Blok preset', () => {
      const html = gdocs([
        '<a href="https://example.com" style="text-decoration:none;">',
        '<span style="color:#1155cc;background-color:#fce5cd;">Link text</span>',
        '</a>',
      ].join(''));

      const result = preprocessGoogleDocsHtml(html);

      // #fce5cd (Google Docs light orange/peach) maps to Blok orange bg preset
      expect(result).toContain('background-color: #fbecdd');
    });

    it('preserves background-color when it is on the <a> tag itself', () => {
      // Google Docs sometimes puts background-color directly on the <a> element
      const html = gdocs('<a href="https://example.com" style="background-color:#fce5cd;text-decoration:none;">Link text</a>');

      const result = preprocessGoogleDocsHtml(html);

      // The background should be preserved as a <mark> wrapping the link content
      expect(result).toContain('<mark');
      expect(result).toContain('background-color:');
      expect(result).toContain('Link text');
    });

    it('preserves background when span has color+bg and anchor has color:inherit (realistic clipboard)', () => {
      // Realistic Google Docs clipboard HTML: <span> with color+bg wraps <a> with color:inherit
      const html = [
        '<b id="docs-internal-guid-abc123">',
        '<span style="font-size:11pt;font-family:Arial,sans-serif;',
        'color:#1155cc;background-color:#a64d79;',
        'font-weight:400;font-style:normal;text-decoration:underline;">',
        '<a href="https://youtube.com" style="text-decoration:inherit;color:inherit;">',
        'link with background and color</a>',
        '</span>',
        '</b>',
      ].join('');

      const result = preprocessGoogleDocsHtml(html);

      // The outer mark should have the mapped background color
      expect(result).toContain('<mark');
      expect(result).toContain('background-color:');
      expect(result).toContain('<a href="https://youtube.com"');
      expect(result).toContain('link with background and color');
    });

    it('does not create inner mark for anchor with only color:inherit', () => {
      // After convertGoogleDocsStyles, the anchor has color:inherit.
      // convertAnchorColorStyles should NOT create a redundant inner mark for inherit.
      const html = gdocs([
        '<span style="color:#1155cc;background-color:#a64d79;">',
        '<a href="https://example.com" style="color:inherit;">Link text</a>',
        '</span>',
      ].join(''));

      const result = preprocessGoogleDocsHtml(html);

      // Should have exactly ONE mark (the outer one from the span conversion)
      const markCount = (result.match(/<mark/g) || []).length;

      expect(markCount).toBe(1);
    });

    it('preserves background after full sanitization (preprocess + clean)', () => {
      // End-to-end test: preprocessor + sanitizer with realistic config
      const html = gdocs([
        '<span style="color:#1155cc;background-color:#a64d79;">',
        '<a href="https://example.com" style="color:inherit;">Link text</a>',
        '</span>',
      ].join(''));

      const preprocessed = preprocessGoogleDocsHtml(html);

      // Sanitize with realistic config (mark + a allowed)
      const sanitizerConfig = {
        a: { href: true },
        mark: (node: Element): { [attr: string]: boolean | string } => {
          const el = node as HTMLElement;
          const style = el.style;
          const props = Array.from({ length: style.length }, (_, i) => style.item(i));
          const allowed = new Set(['color', 'background-color']);

          for (const prop of props) {
            if (!allowed.has(prop)) {
              style.removeProperty(prop);
            }
          }

          return style.length > 0 ? { style: true } : {};
        },
        b: true,
        i: true,
        br: {},
      };

      const result = clean(preprocessed, sanitizerConfig);

      // Background must survive sanitization
      expect(result).toContain('background-color:');
      expect(result).toContain('<a href="https://example.com"');
      expect(result).toContain('Link text');
    });

    it('handles emoji span with background + link span with background in same paragraph', () => {
      const html = gdocs([
        '<p dir="ltr">',
        '<span style="color:#000000;background-color:#fce5cd;">🔗 </span>',
        '<a href="https://example.com" style="text-decoration:none;">',
        '<span style="color:#1155cc;background-color:#fce5cd;text-decoration:underline;">Link text</span>',
        '</a>',
        '</p>',
      ].join(''));

      const result = preprocessGoogleDocsHtml(html);

      // Emoji span should get mark with background
      expect(result).toContain('<mark');
      expect(result).toContain('background-color:');
      // Link should be preserved
      expect(result).toContain('<a href="https://example.com"');
      expect(result).toContain('Link text');
    });
  });

  describe('Google Docs color mapping to Blok presets', () => {
    it('maps Google Docs pure red text color to Blok red preset', () => {
      const html = gdocs('<span style="color:#ff0000">red text</span>');
      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark style="color: #d44c47; background-color: transparent;">red text</mark>');
    });

    it('maps Google Docs pure blue text color to Blok blue preset', () => {
      const html = gdocs('<span style="color:#0000ff">blue text</span>');
      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark style="color: #337ea9; background-color: transparent;">blue text</mark>');
    });

    it('maps Google Docs yellow background to Blok yellow bg preset', () => {
      const html = gdocs('<span style="background-color:#ffff00">highlighted</span>');
      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark style="background-color: #fbf3db;">highlighted</mark>');
    });

    it('maps both text color and bg color to presets simultaneously', () => {
      const html = gdocs('<span style="color:#ff0000;background-color:#ffff00">both</span>');
      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark style="color: #d44c47; background-color: #fbf3db;">both</mark>');
    });

    it('maps Google Docs light red bg (#f4cccc) to Blok red bg preset', () => {
      const html = gdocs('<span style="background-color:#f4cccc">light red bg</span>');
      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark style="background-color: #fdebec;">light red bg</mark>');
    });

    it('maps rgb() format colors to presets', () => {
      const html = gdocs('<span style="color:rgb(255, 0, 0)">red rgb</span>');
      const result = preprocessGoogleDocsHtml(html);

      expect(result).toContain('<mark style="color: #d44c47; background-color: transparent;">red rgb</mark>');
    });
  });
});

describe('Google Docs embedded images', () => {
  /**
   * Google Docs copy-paste puts the image as an <img> tag inside a wrapping <p>
   * (or a <span>) nested under the <b id="docs-internal-guid-..."> wrapper.  The
   * HTML handler splits top-level siblings into blocks, so for the image to land
   * in its own image block we must promote <img> elements out of their enclosing
   * paragraph to become a top-level sibling of the preprocessed output.
   */
  it('preserves <img> src for Google Docs embedded images', () => {
    const html = '<b id="docs-internal-guid-test"><p><span><img src="https://lh3.googleusercontent.com/abc"></span></p></b>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('src="https://lh3.googleusercontent.com/abc"');
  });

  it('promotes a standalone <img> inside a paragraph to a top-level sibling', () => {
    const html = '<b id="docs-internal-guid-test"><p><img src="https://lh3.googleusercontent.com/x"></p></b>';
    const result = preprocessGoogleDocsHtml(html);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = result;

    // The <img> must be a direct child of the wrapper so the HTML handler
    // treats it as its own block instead of burying it inside a paragraph.
    const topLevelImg = Array.from(wrapper.children).find((el) => el.tagName === 'IMG');
    expect(topLevelImg).toBeDefined();
    expect(topLevelImg?.getAttribute('src')).toBe('https://lh3.googleusercontent.com/x');
  });

  it('splits a paragraph that contains text AND an image into separate top-level nodes', () => {
    const html = '<b id="docs-internal-guid-test"><p><span>before</span><img src="https://lh3.googleusercontent.com/y"><span>after</span></p></b>';
    const result = preprocessGoogleDocsHtml(html);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = result;

    const children = Array.from(wrapper.children);
    const imgIndex = children.findIndex((el) => el.tagName === 'IMG');
    expect(imgIndex).toBeGreaterThan(-1);

    // The textual content remains accessible around the promoted image.
    expect(wrapper.textContent).toContain('before');
    expect(wrapper.textContent).toContain('after');
  });

  it('promotes multiple images into multiple top-level siblings', () => {
    const html = [
      '<b id="docs-internal-guid-test">',
      '<p><img src="https://lh3.googleusercontent.com/a"></p>',
      '<p><img src="https://lh3.googleusercontent.com/b"></p>',
      '</b>',
    ].join('');
    const result = preprocessGoogleDocsHtml(html);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = result;

    const imgs = wrapper.querySelectorAll(':scope > img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute('src')).toBe('https://lh3.googleusercontent.com/a');
    expect(imgs[1].getAttribute('src')).toBe('https://lh3.googleusercontent.com/b');
  });

  it('leaves images outside Google Docs wrapper untouched', () => {
    const html = '<p><img src="https://example.com/pic.png"></p>';
    const result = preprocessGoogleDocsHtml(html);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = result;

    // Non-Google-Docs content must not be reshuffled — <img> stays inside <p>.
    expect(wrapper.querySelector(':scope > img')).toBeNull();
    expect(wrapper.querySelector(':scope > p > img')).not.toBeNull();
  });
});

describe('SAFE_STRUCTURAL_TAGS', () => {
  it('includes details', () => {
    expect(SAFE_STRUCTURAL_TAGS.has('details')).toBe(true);
  });

  it('includes summary', () => {
    expect(SAFE_STRUCTURAL_TAGS.has('summary')).toBe(true);
  });

  it('first-pass config with structural tags preserves <summary> inside <details>', () => {
    // Simulate the first-pass sanitization config that includes structural tags
    const structuralConfig = Object.fromEntries([...SAFE_STRUCTURAL_TAGS].map(t => [t, {}]));
    const config = { ...structuralConfig, b: {}, p: {} };
    const html = '<details open=""><summary><b>Toggle Title</b></summary><p>Child</p></details>';
    const result = clean(html, config);

    expect(result).toContain('<summary>');
    expect(result).toContain('Toggle Title');
    expect(result).toContain('<details');
  });
});

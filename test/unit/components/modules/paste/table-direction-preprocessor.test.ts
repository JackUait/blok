import { describe, expect, it } from 'vitest';

import { stampPastedTableDirection } from '../../../../../src/components/modules/paste/table-direction-preprocessor';
import { parseUntrustedHtml } from '../../../../../src/components/utils/inert-html';

const tableDir = (html: string): string | null => parseUntrustedHtml(stampPastedTableDirection(html)).querySelector('table')?.getAttribute('dir') ?? null;

describe('stampPastedTableDirection', () => {
  it('copies a wrapper dir onto the table', () => {
    expect(tableDir('<div dir="rtl"><table><tr><td>A</td></tr></table></div>')).toBe('rtl');
  });

  it('copies the clipboard body dir onto the table', () => {
    expect(tableDir('<html><body dir="rtl"><table><tr><td>A</td></tr></table></body></html>')).toBe('rtl');
  });

  it('turns an inline direction style into dir', () => {
    expect(tableDir('<table style="direction: rtl"><tr><td>A</td></tr></table>')).toBe('rtl');
  });

  it('keeps an LTR table in an RTL body LTR', () => {
    expect(tableDir('<html><body dir="rtl"><table dir="ltr"><tr><td>A</td></tr></table></body></html>')).toBe('ltr');
  });

  it('returns the input untouched when nothing needs a stamp', () => {
    const html = '<p class=\'x\'>a &amp; b</p><table><tr><td>A</td></tr></table>';

    expect(stampPastedTableDirection(html)).toBe(html);
    expect(stampPastedTableDirection('<table dir="rtl"><tr><td>A</td></tr></table>')).toBe('<table dir="rtl"><tr><td>A</td></tr></table>');
  });
});

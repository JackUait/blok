import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseXml } from '../../../../../../src/tools/file/pptx/parser/XmlParser';

const NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

describe('parseXml and document type declarations', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('drops a part that declares a document type, without expanding its entities', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const xml = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "${'A'.repeat(1000)}">]>`
      + `<p:sld ${NS}><a:t>${'&a;'.repeat(50)}</a:t></p:sld>`;

    const root = parseXml(xml);

    expect(root.exists()).toBe(false);
  });

  it('spots the declaration however it is spelled or spaced', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const variants = [
      `<!doctype x><p:sld ${NS}/>`,
      `<?xml version="1.0"?>\n<!DocType x SYSTEM "x.dtd">\n<p:sld ${NS}/>`,
    ];

    variants.forEach((xml) => expect(parseXml(xml).exists()).toBe(false));
  });

  it('still parses an ordinary part that mentions the word in its text', () => {
    const root = parseXml(`<p:sld ${NS}><a:t>&lt;!DOCTYPE html&gt; is a tag</a:t></p:sld>`);

    expect(root.exists()).toBe(true);
    expect(root.child('t').text()).toBe('<!DOCTYPE html> is a tag');
  });
});

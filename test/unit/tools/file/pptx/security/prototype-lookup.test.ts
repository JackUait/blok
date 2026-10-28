import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../helpers/domShims';
import { presetColorToHex } from '../../../../../../src/tools/file/pptx/utils/color';
import { cssFontFamilyStack } from '../../../../../../src/tools/file/pptx/renderer/fontResolver';
import { getMimeType } from '../../../../../../src/tools/file/pptx/utils/media';
import { drawMarker } from '../../../../../../src/tools/file/pptx/renderer/chart/marker';
import { renderTable } from '../../../../../../src/tools/file/pptx/renderer/TableRenderer';
import { SafeXmlNode } from '../../../../../../src/tools/file/pptx/parser/XmlParser';
import { createMockRenderContext } from '../helpers/mockContext';
import { xmlNode } from '../helpers/xmlNode';

// Names every plain object inherits from Object.prototype.
const INHERITED = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf'];

describe('a pptx that names a built-in object property where a preset is expected', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('treats a preset colour such as "constructor" as unknown', () => {
    INHERITED.forEach((name) => expect(presetColorToHex(name)).toBeUndefined());
    expect(presetColorToHex('red')).toBe('#FF0000');
  });

  it('keeps a font named "constructor" as a plain font name', () => {
    expect(cssFontFamilyStack('constructor')).toBe('"constructor"');
    expect(cssFontFamilyStack('__proto__')).toBe('"__proto__"');
  });

  it('gives a media file ending in .constructor the generic type', () => {
    INHERITED.forEach((name) => expect(getMimeType(`ppt/media/image1.${name}`)).toBe('application/octet-stream'));
    expect(getMimeType('ppt/media/image1.png')).toBe('image/png');
  });

  it('draws the fallback circle for a chart marker symbol such as "constructor"', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    INHERITED.forEach((name) => expect(drawMarker(svg, name, 10, 10, 6, '#000').localName).toBe('circle'));
  });

  it('aligns a table cell anchored to "constructor" at the top, like an unknown anchor', () => {
    const cell = { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: xmlNode('<tcPr anchor="constructor"/>') };
    const node = {
      id: '1', name: 'Table', nodeType: 'table' as const, position: { x: 0, y: 0 }, size: { w: 100, h: 50 },
      rotation: 0, flipH: false, flipV: false, source: new SafeXmlNode(null),
      columns: [100], rows: [{ height: 50, cells: [cell] }],
    };

    const td = renderTable(node, createMockRenderContext()).querySelector('td');

    expect(td?.style.verticalAlign).toBe('top');
  });
});

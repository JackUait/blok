import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './domShims';
import { createMockRenderContext } from './mockContext';
import { xmlNode } from './xmlNode';

describe('pptx test helpers', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('build a render context and parse a DrawingML fragment', () => {
    expect(createMockRenderContext().presentation.width).toBe(960);
    expect(xmlNode('<solidFill><srgbClr val="FF0000"/></solidFill>').child('srgbClr').attr('val')).toBe('FF0000');
    expect(URL.createObjectURL(new Blob(['x']))).toMatch(/^blob:/);
  });
});

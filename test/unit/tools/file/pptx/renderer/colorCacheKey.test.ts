import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveColor } from '../../../../../../src/tools/file/pptx/renderer/StyleResolver';
import { createMockRenderContext } from '../helpers/mockContext';
import { xmlNode } from '../helpers/xmlNode';

describe('colour cache in one slide render', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('keeps two system colours with different last colours apart', () => {
    const ctx = createMockRenderContext();
    const red = resolveColor(xmlNode('<solidFill><sysClr val="window" lastClr="FF0000"/></solidFill>'), ctx);
    const green = resolveColor(xmlNode('<solidFill><sysClr val="window" lastClr="00FF00"/></solidFill>'), ctx);

    expect(green.color).not.toBe(red.color);
    expect(green.color.toUpperCase()).toContain('00FF00');
  });

  it('keeps two RGB percentage colours apart', () => {
    const ctx = createMockRenderContext();
    const red = resolveColor(xmlNode('<solidFill><scrgbClr r="100000" g="0" b="0"/></solidFill>'), ctx);
    const blue = resolveColor(xmlNode('<solidFill><scrgbClr r="0" g="0" b="100000"/></solidFill>'), ctx);

    expect(blue.color).not.toBe(red.color);
  });
});

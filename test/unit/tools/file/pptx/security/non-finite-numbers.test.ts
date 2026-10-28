import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseBaseProps } from '../../../../../../src/tools/file/pptx/model/nodes/BaseNode';
import { xmlNode } from '../helpers/xmlNode';

describe('a pptx shape whose numbers are infinite', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('falls back to the default instead of carrying Infinity into the slide', () => {
    const sp = xmlNode(
      '<sp><spPr><xfrm rot="1e400"><off x="Infinity" y="-Infinity"/><ext cx="1e400" cy="NaN"/></xfrm></spPr></sp>'
    );

    const props = parseBaseProps(sp);

    expect(props.position).toEqual({ x: 0, y: 0 });
    expect(props.size).toEqual({ w: 0, h: 0 });
    expect(props.rotation).toBe(0);
  });

  it('still reads ordinary numbers, including negative and exponent forms', () => {
    const node = xmlNode('<off x="-914400" y="9.144e5"/>');

    expect(node.numAttr('x')).toBe(-914400);
    expect(node.numAttr('y')).toBe(914400);
  });
});

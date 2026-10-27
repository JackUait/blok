// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '../../helpers/domShims';
import { parseGroupNode } from '../../../../../../../src/tools/file/pptx/model/nodes/GroupNode';
import { parseXml } from '../../../../../../../src/tools/file/pptx/parser/XmlParser';

function makeGroupXml(
  opts: {
    childCount?: number;
    noChOff?: boolean;
    noChExt?: boolean;
  } = {},
) {
  const childCount = opts.childCount ?? 2;
  const children = Array.from(
    { length: childCount },
    (_, i) => `
    <sp>
      <nvSpPr><cNvPr id="${i + 100}" name="child-${i}"/><nvPr/></nvSpPr>
      <spPr>
        <xfrm><off x="${i * 457200}" y="0"/><ext cx="457200" cy="457200"/></xfrm>
        <prstGeom prst="rect"><avLst/></prstGeom>
      </spPr>
    </sp>
  `,
  ).join('');

  const chOff = opts.noChOff ? '' : '<chOff x="0" y="0"/>';
  const chExt = opts.noChExt ? '' : '<chExt cx="1828800" cy="914400"/>';

  return parseXml(`
    <grpSp xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <nvGrpSpPr>
        <cNvPr id="20" name="Group 1"/>
        <nvPr/>
      </nvGrpSpPr>
      <grpSpPr>
        <xfrm>
          <off x="914400" y="914400"/>
          <ext cx="1828800" cy="914400"/>
          ${chOff}${chExt}
        </xfrm>
      </grpSpPr>
      ${children}
    </grpSp>
  `);
}

describe('parseGroupNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses basic group', () => {
    const node = parseGroupNode(makeGroupXml());
    expect(node.nodeType).toBe('group');
    expect(node.id).toBe('20');
    expect(node.name).toBe('Group 1');
  });

  it('retains group-level scene3d camera semantics for the renderer planner', () => {
    const node = parseGroupNode(
      parseXml(`
        <grpSp xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <nvGrpSpPr><cNvPr id="20" name="Picture Group"/><nvPr/></nvGrpSpPr>
          <grpSpPr>
            <xfrm>
              <off x="0" y="0"/><ext cx="1815283" cy="650783"/>
              <chOff x="3244850" y="5338935"/><chExt cx="3781425" cy="1355647"/>
            </xfrm>
            <scene3d>
              <camera prst="perspectiveLeft" fov="5700000">
                <rot lat="0" lon="1500000" rev="0"/>
              </camera>
              <lightRig rig="threePt" dir="t"/>
            </scene3d>
          </grpSpPr>
        </grpSp>
      `),
    );

    expect(node.shape3d).toEqual({
      scene: {
        cameraPreset: 'perspectiveLeft',
        fieldOfView: 95,
        cameraZoom: undefined,
        cameraRotation: { latitude: 0, longitude: 25, revolution: 0 },
        lightRig: 'threePt',
        lightDirection: 't',
        lightRotation: undefined,
      },
      shape: undefined,
      effectKinds: [],
      parseIssues: [],
    });
  });

  it('collects child shape nodes', () => {
    const node = parseGroupNode(makeGroupXml({ childCount: 3 }));
    expect(node.children).toHaveLength(3);
    expect(node.children[0].localName).toBe('sp');
  });

  it('parses child offset and extent', () => {
    const node = parseGroupNode(makeGroupXml());
    expect(node.childOffset.x).toBe(0);
    expect(node.childOffset.y).toBe(0);
    expect(node.childExtent.w).toBeGreaterThan(0);
    expect(node.childExtent.h).toBeGreaterThan(0);
  });

  it('uses group size as childExtent fallback when chExt missing', () => {
    const node = parseGroupNode(makeGroupXml({ noChExt: true }));
    // Falls back to base.size
    expect(node.childExtent.w).toBe(node.size.w);
    expect(node.childExtent.h).toBe(node.size.h);
  });

  it('uses 0,0 as childOffset fallback when chOff missing', () => {
    const node = parseGroupNode(makeGroupXml({ noChOff: true }));
    expect(node.childOffset.x).toBe(0);
    expect(node.childOffset.y).toBe(0);
  });

  it('defaults missing chOff attributes and non-positive chExt axes independently', () => {
    const node = parseGroupNode(
      parseXml(`
        <grpSp xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <nvGrpSpPr><cNvPr id="20" name="Group 1"/><nvPr/></nvGrpSpPr>
          <grpSpPr>
            <xfrm>
              <off x="0" y="0"/>
              <ext cx="1828800" cy="914400"/>
              <chOff/>
              <chExt cx="0" cy="-1"/>
            </xfrm>
          </grpSpPr>
        </grpSp>
      `),
    );

    expect(node.childOffset).toEqual({ x: 0, y: 0 });
    expect(node.childExtent).toEqual(node.size);
  });

  it('ignores non-shape children (e.g. grpSpPr)', () => {
    // grpSpPr is NOT a shape child, should not be in children[]
    const node = parseGroupNode(makeGroupXml({ childCount: 0 }));
    expect(node.children).toHaveLength(0);
  });

  it('does not flatten nested group children into the parent group', () => {
    const node = parseGroupNode(
      parseXml(`
      <grpSp xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <nvGrpSpPr><cNvPr id="20" name="Parent Group"/><nvPr/></nvGrpSpPr>
        <grpSpPr>
          <xfrm>
            <off x="0" y="0"/><ext cx="1828800" cy="914400"/>
            <chOff x="0" y="0"/><chExt cx="1828800" cy="914400"/>
          </xfrm>
        </grpSpPr>
        <grpSp>
          <nvGrpSpPr><cNvPr id="21" name="Nested Group"/><nvPr/></nvGrpSpPr>
          <grpSpPr>
            <xfrm>
              <off x="0" y="0"/><ext cx="914400" cy="914400"/>
              <chOff x="0" y="0"/><chExt cx="914400" cy="914400"/>
            </xfrm>
          </grpSpPr>
          <sp>
            <nvSpPr><cNvPr id="22" name="Nested Shape"/><nvPr/></nvSpPr>
            <spPr><xfrm><off x="0" y="0"/><ext cx="457200" cy="457200"/></xfrm></spPr>
          </sp>
        </grpSp>
      </grpSp>
    `),
    );

    expect(node.children).toHaveLength(1);
    expect(node.children[0].localName).toBe('grpSp');
  });

  it('does not collect fallback pictures nested inside a graphicFrame as direct group children', () => {
    const node = parseGroupNode(
      parseXml(`
      <grpSp xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <nvGrpSpPr><cNvPr id="20" name="Parent Group"/><nvPr/></nvGrpSpPr>
        <grpSpPr>
          <xfrm>
            <off x="0" y="0"/><ext cx="1828800" cy="914400"/>
            <chOff x="0" y="0"/><chExt cx="1828800" cy="914400"/>
          </xfrm>
        </grpSpPr>
        <graphicFrame>
          <nvGraphicFramePr><cNvPr id="30" name="OLE Object"/><nvPr/></nvGraphicFramePr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          <graphic>
            <graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole">
              <fallback>
                <pic>
                  <nvPicPr><cNvPr id="31" name="Fallback Picture"/><nvPr/></nvPicPr>
                  <blipFill><blip embed="rId1"/></blipFill>
                </pic>
              </fallback>
            </graphicData>
          </graphic>
        </graphicFrame>
      </grpSp>
    `),
    );

    expect(node.children).toHaveLength(1);
    expect(node.children[0].localName).toBe('graphicFrame');
  });
});

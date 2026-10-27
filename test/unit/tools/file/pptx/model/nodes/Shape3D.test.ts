// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '../../helpers/domShims';
import { parseShape3DProperties } from '../../../../../../../src/tools/file/pptx/model/nodes/Shape3D';
import { SafeXmlNode, parseXml } from '../../../../../../../src/tools/file/pptx/parser/XmlParser';

function parseSpPr(xml: string) {
  return parseShape3DProperties(parseXml(xml));
}

describe('parseShape3DProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns undefined when neither scene3d nor sp3d is present', () => {
    expect(
      parseSpPr('<spPr><solidFill><srgbClr val="4472C4"/></solidFill></spPr>'),
    ).toBeUndefined();
  });

  it('parses the supported explicit orthographic top-bevel tuple', () => {
    const result = parseSpPr(`
      <spPr>
        <effectLst>
          <outerShdw blurRad="55000" dist="18000" dir="5400000" algn="tl" rotWithShape="0">
            <srgbClr val="000000"><alpha val="40000"/></srgbClr>
          </outerShdw>
        </effectLst>
        <scene3d>
          <camera prst="orthographicFront"/>
          <lightRig rig="threePt" dir="t"/>
        </scene3d>
        <sp3d extrusionH="0" contourW="12700">
          <bevelT w="127000" h="127000" prst="circle"/>
          <contourClr><srgbClr val="FFFFFF"/></contourClr>
        </sp3d>
      </spPr>
    `);

    expect(result).toMatchObject({
      scene: {
        cameraPreset: 'orthographicFront',
        lightRig: 'threePt',
        lightDirection: 't',
      },
      shape: {
        extrusionHeight: 0,
        contourWidth: 4 / 3,
        bevelTop: {
          preset: 'circle',
          presetExplicit: true,
          width: 40 / 3,
          height: 40 / 3,
        },
        contourColor: { type: 'srgbClr', value: 'FFFFFF' },
      },
      effectKinds: ['outerShdw'],
      parseIssues: [],
    });
    expect(result!.shape!.contourColorSource).toBeInstanceOf(SafeXmlNode);
  });

  it('parses the real picture tuple with OOXML defaults and supported light rotation', () => {
    const result = parseSpPr(`
      <spPr>
        <scene3d>
          <camera prst="orthographicFront"/>
          <lightRig rig="twoPt" dir="t"><rot lat="0" lon="0" rev="7200000"/></lightRig>
        </scene3d>
        <sp3d>
          <bevelT w="25400" h="19050"/>
          <contourClr><schemeClr val="lt1"/></contourClr>
        </sp3d>
      </spPr>
    `);

    expect(result).toMatchObject({
      scene: {
        cameraPreset: 'orthographicFront',
        lightRig: 'twoPt',
        lightDirection: 't',
        lightRotation: { latitude: 0, longitude: 0, revolution: 120 },
      },
      shape: {
        extrusionHeight: 0,
        contourWidth: 0,
        bevelTop: {
          preset: 'circle',
          presetExplicit: false,
          width: 8 / 3,
          height: 2,
        },
        contourColor: { type: 'schemeClr', value: 'lt1' },
      },
      effectKinds: [],
      parseIssues: [],
    });
  });

  it('applies the DrawingML 76200 EMU bevel dimension defaults independently', () => {
    const result = parseSpPr(`
      <spPr>
        <scene3d>
          <camera prst="orthographicFront"/>
          <lightRig rig="threePt" dir="t"/>
        </scene3d>
        <sp3d>
          <bevelT/>
          <bevelB w="12700" prst="relaxedInset"/>
        </sp3d>
      </spPr>
    `);

    expect(result).toMatchObject({
      shape: {
        bevelTop: {
          preset: 'circle',
          presetExplicit: false,
          width: 8,
          height: 8,
        },
        bevelBottom: {
          preset: 'relaxedInset',
          presetExplicit: true,
          width: 4 / 3,
          height: 8,
        },
      },
      parseIssues: [],
    });
  });

  it('retains valid 3D observations without treating renderer support as a parse issue', () => {
    const result = parseSpPr(`
      <spPr>
        <effectLst><glow rad="12700"><srgbClr val="FFFFFF"/></glow></effectLst>
        <scene3d>
          <camera prst="perspectiveRelaxed"><rot lat="0" lon="0" rev="60000"/></camera>
          <lightRig rig="legacyFlat1" dir="br"><rot lat="60000" lon="0" rev="0"/></lightRig>
        </scene3d>
        <sp3d extrusionH="12700" contourW="0" prstMaterial="metal">
          <bevelT w="127000" h="127000" prst="angle"/>
          <bevelB w="12700" h="12700" prst="circle"/>
        </sp3d>
      </spPr>
    `);

    expect(result).toMatchObject({
      scene: {
        cameraPreset: 'perspectiveRelaxed',
        cameraRotation: { latitude: 0, longitude: 0, revolution: 1 },
        lightRig: 'legacyFlat1',
        lightDirection: 'br',
        lightRotation: { latitude: 1, longitude: 0, revolution: 0 },
      },
      shape: {
        extrusionHeight: 4 / 3,
        presetMaterial: 'metal',
        bevelTop: { preset: 'angle' },
        bevelBottom: { preset: 'circle' },
      },
      effectKinds: ['glow'],
      parseIssues: [],
    });
  });

  it('parses camera field of view and zoom in their OOXML units', () => {
    const result = parseSpPr(`
      <spPr>
        <scene3d>
          <camera prst="perspectiveRelaxedModerately" fov="7200000" zoom="95000">
            <rot lat="18590633" lon="0" rev="0"/>
          </camera>
          <lightRig rig="threePt" dir="t"/>
        </scene3d>
        <sp3d extrusionH="0"/>
      </spPr>
    `);

    expect(result).toMatchObject({
      scene: {
        cameraPreset: 'perspectiveRelaxedModerately',
        fieldOfView: 120,
        cameraZoom: 0.95,
        cameraRotation: {
          latitude: 18590633 / 60000,
          longitude: 0,
          revolution: 0,
        },
      },
      parseIssues: [],
    });
  });

  it('retains scene backdrop, shape depth, and extrusion paint as unsupported observations', () => {
    const result = parseSpPr(`
      <spPr>
        <effectDag/>
        <scene3d>
          <camera prst="orthographicFront"/>
          <lightRig rig="threePt" dir="t"/>
          <backdrop/>
        </scene3d>
        <sp3d z="-12700" extrusionH="0">
          <extrusionClr><srgbClr val="FFFFFF"/></extrusionClr>
        </sp3d>
      </spPr>
    `);

    expect(result).toMatchObject({
      scene: { hasBackdrop: true },
      shape: {
        zPosition: -4 / 3,
        extrusionColor: { type: 'srgbClr', value: 'FFFFFF' },
      },
      effectKinds: ['effectDag'],
      parseIssues: [],
    });
  });

  it('reports malformed camera field of view or zoom without discarding the shape', () => {
    const result = parseSpPr(`
      <spPr>
        <scene3d>
          <camera prst="perspectiveRelaxedModerately" fov="not-a-number" zoom="-1"/>
          <lightRig rig="threePt" dir="t"/>
        </scene3d>
        <sp3d extrusionH="0"/>
      </spPr>
    `);

    expect(result).toMatchObject({
      scene: {
        cameraPreset: 'perspectiveRelaxedModerately',
        fieldOfView: undefined,
        cameraZoom: undefined,
      },
      shape: { extrusionHeight: 0 },
      parseIssues: ['malformed-numeric'],
    });
  });

  it('rejects malformed or negative dimensions without throwing away the 2D node', () => {
    const result = parseSpPr(`
      <spPr>
        <scene3d><camera prst="orthographicFront"/><lightRig rig="threePt" dir="t"/></scene3d>
        <sp3d extrusionH="NaN" contourW="-12700">
          <bevelT w="Infinity" h="-1" prst="circle"/>
        </sp3d>
      </spPr>
    `);

    expect(result).toMatchObject({
      shape: {
        extrusionHeight: undefined,
        contourWidth: undefined,
        bevelTop: { width: undefined, height: undefined },
      },
      parseIssues: ['malformed-numeric'],
    });
  });

  it('preserves incomplete 3D tuples for the renderer planner', () => {
    expect(parseSpPr('<spPr><sp3d><bevelT w="12700" h="12700"/></sp3d></spPr>')).toMatchObject({
      scene: undefined,
      parseIssues: [],
    });
    expect(parseSpPr('<spPr><scene3d/></spPr>')).toMatchObject({
      scene: {},
      shape: undefined,
      parseIssues: [],
    });
    expect(
      parseSpPr(`
        <spPr>
          <scene3d><camera prst="orthographicFront"/><lightRig rig="threePt" dir="t"/></scene3d>
          <sp3d/>
        </spPr>
      `),
    ).toMatchObject({ shape: { bevelTop: undefined }, parseIssues: [] });
  });
});

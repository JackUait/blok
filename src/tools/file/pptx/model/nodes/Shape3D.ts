// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
/**
 * Typed observations for DrawingML `a:scene3d` and `a:sp3d` properties.
 *
 * The parser records source semantics without deciding which renderer backend can display them.
 * Capability classification belongs to the renderer planner.
 */

import { SafeXmlNode } from '../../parser/XmlParser';
import { angleToDeg, emuToPx, pctToDecimal } from '../../parser/units';

/** Problems with the source data itself, independent of renderer capability. */
export type Shape3DParseIssue = 'malformed-numeric';

export interface Shape3DRotation {
  latitude: number;
  longitude: number;
  revolution: number;
}

export interface Scene3DProperties {
  cameraPreset?: string;
  /** Camera field of view in degrees (`a:camera@fov` uses 60000ths of a degree). */
  fieldOfView?: number;
  /** Camera zoom as a decimal fraction (`a:camera@zoom` uses 100000ths). */
  cameraZoom?: number;
  cameraRotation?: Shape3DRotation;
  lightRig?: string;
  lightDirection?: string;
  lightRotation?: Shape3DRotation;
  /** Backdrop geometry is retained so unsupported camera semantics cannot be mistaken for support. */
  hasBackdrop?: true;
}

function parseCameraNumber(
  node: SafeXmlNode,
  attr: 'fov' | 'zoom',
  issues: Shape3DParseIssue[],
): number | undefined {
  const raw = node.attr(attr);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  const valid =
    Number.isFinite(value) && (attr === 'fov' ? value > 0 && value <= 180 * 60000 : value > 0);
  if (!valid) {
    addIssue(issues, 'malformed-numeric');
    return undefined;
  }
  return attr === 'fov' ? angleToDeg(value) : pctToDecimal(value);
}

export interface Shape3DBevelProperties {
  preset: string;
  presetExplicit: boolean;
  width?: number;
  height?: number;
}

export interface Shape3DColorObservation {
  type: string;
  value?: string;
}

export interface Shape3DFormatProperties {
  /** Shape depth coordinate in pixels (`a:sp3d@z`); absent means zero. */
  zPosition?: number;
  extrusionHeight?: number;
  contourWidth?: number;
  presetMaterial?: string;
  bevelTop?: Shape3DBevelProperties;
  bevelBottom?: Shape3DBevelProperties;
  extrusionColor?: Shape3DColorObservation;
  contourColor?: Shape3DColorObservation;
  /** @internal Wrapper color node consumed by the normal theme/color resolver. */
  contourColorSource?: SafeXmlNode;
}

export interface Shape3DProperties {
  scene?: Scene3DProperties;
  shape?: Shape3DFormatProperties;
  /** Direct child effect names observed beside the 3D properties. */
  effectKinds: string[];
  /** Invalid source values that could not be represented safely. */
  parseIssues: Shape3DParseIssue[];
}

// DrawingML CT_Bevel defaults both dimensions to 76200 EMU (6 pt).
const DEFAULT_BEVEL_DIMENSION_EMU = 76200;

function addIssue(issues: Shape3DParseIssue[], issue: Shape3DParseIssue): void {
  if (!issues.includes(issue)) issues.push(issue);
}

function parseRotation(
  node: SafeXmlNode,
  issues: Shape3DParseIssue[],
): Shape3DRotation | undefined {
  if (!node.exists()) return undefined;
  const rawValues = [node.attr('lat'), node.attr('lon'), node.attr('rev')];
  const values = rawValues.map((raw) => (raw === undefined ? 0 : Number(raw)));
  if (values.some((value) => !Number.isFinite(value))) {
    addIssue(issues, 'malformed-numeric');
    return undefined;
  }
  return {
    latitude: angleToDeg(values[0]),
    longitude: angleToDeg(values[1]),
    revolution: angleToDeg(values[2]),
  };
}

function parseLength(
  node: SafeXmlNode,
  attr: string,
  defaultEmu: number,
  issues: Shape3DParseIssue[],
): number | undefined {
  const raw = node.attr(attr);
  if (raw === undefined) return emuToPx(defaultEmu);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    addIssue(issues, 'malformed-numeric');
    return undefined;
  }
  return emuToPx(value);
}

function parseCoordinate(
  node: SafeXmlNode,
  attr: string,
  issues: Shape3DParseIssue[],
): number | undefined {
  const raw = node.attr(attr);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    addIssue(issues, 'malformed-numeric');
    return undefined;
  }
  return emuToPx(value);
}

function parseBevel(
  node: SafeXmlNode,
  issues: Shape3DParseIssue[],
): Shape3DBevelProperties | undefined {
  if (!node.exists()) return undefined;
  const explicitPreset = node.attr('prst');
  return {
    preset: explicitPreset ?? 'circle',
    presetExplicit: explicitPreset !== undefined,
    width: parseLength(node, 'w', DEFAULT_BEVEL_DIMENSION_EMU, issues),
    height: parseLength(node, 'h', DEFAULT_BEVEL_DIMENSION_EMU, issues),
  };
}

function parseColorObservation(node: SafeXmlNode): Shape3DColorObservation | undefined {
  if (!node.exists()) return undefined;
  const color = node.allChildren()[0];
  if (!color?.exists()) return undefined;
  return {
    type: color.localName,
    value: color.attr('val') ?? color.attr('lastClr'),
  };
}

/** Parse direct `a:scene3d`/`a:sp3d` children from one shape-properties node. */
export function parseShape3DProperties(spPr: SafeXmlNode): Shape3DProperties | undefined {
  const scene3d = spPr.child('scene3d');
  const sp3d = spPr.child('sp3d');
  if (!scene3d.exists() && !sp3d.exists()) return undefined;

  const parseIssues: Shape3DParseIssue[] = [];
  let scene: Scene3DProperties | undefined;
  let shape: Shape3DFormatProperties | undefined;

  if (scene3d.exists()) {
    const camera = scene3d.child('camera');
    const light = scene3d.child('lightRig');
    scene = {};

    if (camera.exists()) {
      scene.cameraPreset = camera.attr('prst');
      scene.fieldOfView = parseCameraNumber(camera, 'fov', parseIssues);
      scene.cameraZoom = parseCameraNumber(camera, 'zoom', parseIssues);
      const cameraRotationNode = camera.child('rot');
      scene.cameraRotation = parseRotation(cameraRotationNode, parseIssues);
    }

    if (light.exists()) {
      scene.lightRig = light.attr('rig');
      scene.lightDirection = light.attr('dir');
      const lightRotationNode = light.child('rot');
      scene.lightRotation = parseRotation(lightRotationNode, parseIssues);
    }
    if (scene3d.child('backdrop').exists()) scene.hasBackdrop = true;
  }

  if (sp3d.exists()) {
    const bevelTop = parseBevel(sp3d.child('bevelT'), parseIssues);
    const bevelBottom = parseBevel(sp3d.child('bevelB'), parseIssues);
    const contourColorSource = sp3d.child('contourClr');
    const extrusionColorSource = sp3d.child('extrusionClr');
    const zPosition = parseCoordinate(sp3d, 'z', parseIssues);
    const extrusionHeight = parseLength(sp3d, 'extrusionH', 0, parseIssues);
    const contourWidth = parseLength(sp3d, 'contourW', 0, parseIssues);
    const presetMaterial = sp3d.attr('prstMaterial');

    shape = {
      zPosition,
      extrusionHeight,
      contourWidth,
      presetMaterial,
      bevelTop,
      bevelBottom,
      extrusionColor: parseColorObservation(extrusionColorSource),
      contourColor: parseColorObservation(contourColorSource),
      contourColorSource: contourColorSource.exists() ? contourColorSource : undefined,
    };
  }

  const effectList = spPr.child('effectLst');
  const effectDag = spPr.child('effectDag');
  return {
    scene,
    shape,
    effectKinds: effectList.exists()
      ? effectList.allChildren().map((effect) => effect.localName)
      : effectDag.exists()
        ? ['effectDag']
        : [],
    parseIssues,
  };
}

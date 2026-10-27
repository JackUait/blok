// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
/**
 * Picture node parser — handles images, video placeholders, and audio placeholders.
 */

import { SafeXmlNode } from '../../parser/XmlParser';
import { BaseNodeData, parseBaseProps } from './BaseNode';
import { parseAdjustments } from './ShapeNode';
import { parseShape3DProperties, Shape3DProperties } from './Shape3D';

export interface CropRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PicNodeData extends BaseNodeData {
  nodeType: 'picture';
  blipEmbed?: string;
  blipLink?: string;
  crop?: CropRect;
  /** @internal Raw XML node — opaque to consumers. Use serializePresentation() for JSON-safe data. */
  fill?: SafeXmlNode;
  /** @internal Raw XML node — opaque to consumers. Use serializePresentation() for JSON-safe data. */
  line?: SafeXmlNode;
  shape3d?: Shape3DProperties;
  /** Picture preset geometry, when the picture is clipped to a non-rectangular preset. */
  presetGeometry?: string;
  /** Adjustment values for the picture's preset clipping geometry. */
  geometryAdjustments?: Map<string, number>;
  /** @internal Raw custom geometry used to clip the picture fill. */
  customGeometry?: SafeXmlNode;
  isVideo?: boolean;
  isAudio?: boolean;
  mediaRId?: string;
}

/** OOXML encodes srcRect percentages as 1/100000 of full extent. */
const CROP_DIVISOR = 100000;

/**
 * Parse a picture XML node (`p:pic`) into PicNodeData.
 */
export function parsePicNode(picNode: SafeXmlNode): PicNodeData {
  const base = parseBaseProps(picNode);

  // --- Blip fill ---
  const blipFill = picNode.child('blipFill');
  const blip = blipFill.child('blip');

  // PowerPoint stores SVG pictures in an Office extension relationship on the
  // blip, with the raster relationship (when present) acting as a fallback.
  // Prefer the SVG relationship so SVG-only pictures are not treated as
  // missing images and SVG-with-PNG-fallback pictures retain their fidelity.
  const svgBlip = blip
    .child('extLst')
    .children('ext')
    .map((ext) => ext.child('svgBlip'))
    .find((candidate) => candidate.exists());
  const svgEmbed = svgBlip?.attr('embed') ?? svgBlip?.attr('r:embed');
  const rasterEmbed = blip.attr('embed') ?? blip.attr('r:embed');
  const blipEmbed = svgEmbed ?? rasterEmbed;
  const blipLink = blip.attr('link') ?? blip.attr('r:link');

  // --- Crop (srcRect) ---
  const srcRect = blipFill.child('srcRect');
  let crop: CropRect | undefined;
  if (srcRect.exists()) {
    const t = srcRect.numAttr('t');
    const b = srcRect.numAttr('b');
    const l = srcRect.numAttr('l');
    const r = srcRect.numAttr('r');
    if (t !== undefined || b !== undefined || l !== undefined || r !== undefined) {
      crop = {
        top: (t ?? 0) / CROP_DIVISOR,
        bottom: (b ?? 0) / CROP_DIVISOR,
        left: (l ?? 0) / CROP_DIVISOR,
        right: (r ?? 0) / CROP_DIVISOR,
      };
    }
  }

  // --- Shape properties (fill + line) ---
  const spPr = picNode.child('spPr');
  const solidFill = spPr.child('solidFill');
  const gradFill = spPr.child('gradFill');
  const fill = solidFill.exists() ? solidFill : gradFill.exists() ? gradFill : undefined;

  const ln = spPr.child('ln');
  const line = ln.exists() ? ln : undefined;
  const shape3d = parseShape3DProperties(spPr);
  const prstGeom = spPr.child('prstGeom');
  const presetGeometry = prstGeom.exists() ? prstGeom.attr('prst') : undefined;
  const geometryAdjustments = prstGeom.exists()
    ? parseAdjustments(prstGeom.child('avLst'))
    : undefined;
  const custGeom = spPr.child('custGeom');
  const customGeometry = custGeom.exists() ? custGeom : undefined;

  // --- Video / Audio detection ---
  const nvPicPr = picNode.child('nvPicPr');
  const nvPr = nvPicPr.child('nvPr');

  const videoFile = nvPr.child('videoFile');
  const audioFile = nvPr.child('audioFile');

  const isVideo = videoFile.exists();
  const isAudio = audioFile.exists();

  let mediaRId: string | undefined;
  if (isVideo) {
    mediaRId = videoFile.attr('link') ?? videoFile.attr('r:link');
  } else if (isAudio) {
    mediaRId = audioFile.attr('link') ?? audioFile.attr('r:link');
  }

  return {
    ...base,
    nodeType: 'picture',
    blipEmbed,
    blipLink,
    crop,
    fill,
    line,
    shape3d,
    presetGeometry,
    geometryAdjustments,
    customGeometry,
    isVideo: isVideo || undefined,
    isAudio: isAudio || undefined,
    mediaRId,
  };
}

// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
/**
 * Slide parser — converts a slide XML into a structured SlideData
 * with typed node objects for each shape on the slide.
 */

import type { SafeXmlNode } from '../parser/XmlParser';
import type { RelEntry } from '../parser/RelParser';
import { parseRenderableChildren, type RenderableNode } from './RenderableChild';
import { parseOoxmlBool } from '../parser/booleans';
import { parseColorMapOverride, type ColorMapOverrideMode } from './Layout';

export { parseOleFrameAsPicture } from './RenderableChild';

export type SlideNode = RenderableNode;

export interface SlideData {
  index: number;
  /** True when p:sld@show is false/0; hidden slides stay addressable but are skipped by PDF exports. */
  hidden?: boolean;
  nodes: SlideNode[];
  background?: SafeXmlNode;
  layoutIndex: string;
  rels: Map<string, RelEntry>;
  /** Full path to the slide file (e.g. "ppt/slides/slide3.xml"). */
  slidePath: string;
  /** When false, shapes from the layout and master should NOT be rendered on this slide. */
  showMasterSp: boolean;
  colorMapOverride?: Map<string, string>;
  /** Whether clrMapOvr supplies an override map or explicitly resets to the master map. */
  colorMapOverrideMode?: ColorMapOverrideMode;
}

function parseDefaultTrueBoolAttr(value: string | undefined): boolean {
  return parseOoxmlBool(value, true);
}

/**
 * Find the layout relationship target from a slide's rels map.
 * The relationship type URI for slide layouts ends with "slideLayout".
 */
function findLayoutRel(rels: Map<string, RelEntry>): string {
  for (const [, entry] of rels) {
    if (entry.type.includes('slideLayout')) {
      return entry.target;
    }
  }
  return '';
}

/**
 * Parse a slide XML root (`p:sld`) into SlideData.
 *
 * @param root      Parsed XML root of the slide
 * @param index     Zero-based slide index
 * @param rels      Relationship entries for this slide
 * @param slidePath Full path to the slide file (e.g. "ppt/slides/slide1.xml")
 */
export function parseSlide(
  root: SafeXmlNode,
  index: number,
  rels: Map<string, RelEntry>,
  slidePath: string = '',
  diagramDrawings?: Map<string, string>,
): SlideData {
  const cSld = root.child('cSld');

  // --- Background ---
  const bg = cSld.child('bg');
  const background = bg.exists() ? bg : undefined;

  // --- Parse shape tree children ---
  const spTree = cSld.child('spTree');
  const nodes: SlideNode[] = [];

  for (const child of spTree.allChildren()) {
    const childNodes = parseRenderableChildren(child, {
      rels,
      partPath: slidePath,
      diagramDrawings,
    });
    nodes.push(...childNodes);
  }

  // --- Layout relationship ---
  const layoutIndex = findLayoutRel(rels);

  // --- showMasterSp: if false, layout/master shapes should not be rendered on this slide ---
  const showMasterSp = parseDefaultTrueBoolAttr(root.attr('showMasterSp'));
  const hidden = !parseDefaultTrueBoolAttr(root.attr('show'));
  const { colorMapOverride, colorMapOverrideMode } = parseColorMapOverride(root);

  return {
    index,
    hidden,
    nodes,
    background,
    layoutIndex,
    rels,
    slidePath,
    showMasterSp,
    colorMapOverride,
    colorMapOverrideMode,
  };
}

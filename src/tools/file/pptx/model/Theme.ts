// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
/**
 * Theme parser — extracts color scheme and font definitions from a:theme XML.
 */

import { SafeXmlNode } from '../parser/XmlParser';

export interface ThemeFontInfo {
  latin: string;
  ea: string;
  cs: string;
  scripts?: Record<string, string>;
}

export interface ThemeData {
  colorScheme: Map<string, string>;
  majorFont: ThemeFontInfo;
  minorFont: ThemeFontInfo;
  fillStyles: SafeXmlNode[]; // from a:fillStyleLst children (indexed 1-based)
  bgFillStyles?: SafeXmlNode[]; // from a:bgFillStyleLst children (indexed 1001-based for bgRef)
  lineStyles: SafeXmlNode[]; // from a:lnStyleLst children (indexed 1-based)
  effectStyles: SafeXmlNode[]; // from a:effectStyleLst children (indexed 1-based)
}

/** Known color scheme slot names in a:clrScheme. */
const COLOR_SLOTS = [
  'dk1',
  'dk2',
  'lt1',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
] as const;

/**
 * Extract a hex color value from a color definition node.
 * Handles both `a:srgbClr@val` and `a:sysClr@lastClr`.
 */
function extractColor(node: SafeXmlNode): string | undefined {
  const srgb = node.child('srgbClr');
  if (srgb.exists()) {
    return srgb.attr('val');
  }
  const sys = node.child('sysClr');
  if (sys.exists()) {
    return sys.attr('lastClr') ?? sys.attr('val');
  }
  return undefined;
}

/**
 * Parse font info from a majorFont or minorFont node.
 * Extracts typeface attributes from latin, ea, and cs child elements.
 * Office themes often leave <ea> empty and provide script-specific
 * <font script="Hans" .../> entries instead; preserve those for font resolution.
 */
function parseFontInfo(fontNode: SafeXmlNode): ThemeFontInfo {
  const scripts: Record<string, string> = {};
  for (const font of fontNode.children('font')) {
    const script = font.attr('script');
    const typeface = font.attr('typeface');
    if (script && typeface) {
      scripts[script] = typeface;
    }
  }

  const result: ThemeFontInfo = {
    latin: fontNode.child('latin').attr('typeface') ?? '',
    ea: fontNode.child('ea').attr('typeface') ?? '',
    cs: fontNode.child('cs').attr('typeface') ?? '',
  };
  if (Object.keys(scripts).length > 0) {
    result.scripts = scripts;
  }
  return result;
}

/**
 * Parse a theme XML root (`a:theme`) into ThemeData.
 */
export function parseTheme(root: SafeXmlNode): ThemeData {
  const themeElements = root.child('themeElements');
  const themeScope = themeElements.exists() ? themeElements : root;

  // --- Color scheme ---
  const clrScheme = themeScope.child('clrScheme');
  const colorScheme = new Map<string, string>();

  for (const slot of COLOR_SLOTS) {
    const slotNode = clrScheme.child(slot);
    if (slotNode.exists()) {
      const hex = extractColor(slotNode);
      if (hex !== undefined) {
        colorScheme.set(slot, hex);
      }
    }
  }

  // --- Font scheme ---
  const fontScheme = themeScope.child('fontScheme');
  const majorFont = parseFontInfo(fontScheme.child('majorFont'));
  const minorFont = parseFontInfo(fontScheme.child('minorFont'));

  // --- Format scheme ---
  const fmtScheme = themeScope.child('fmtScheme');
  const fillStyleLst = fmtScheme.child('fillStyleLst');
  const fillStyles: SafeXmlNode[] = fillStyleLst.allChildren();
  const bgFillStyleLst = fmtScheme.child('bgFillStyleLst');
  const bgFillStyles: SafeXmlNode[] = bgFillStyleLst.allChildren();
  const lnStyleLst = fmtScheme.child('lnStyleLst');
  const lineStyles: SafeXmlNode[] = lnStyleLst.allChildren();
  const effectStyleLst = fmtScheme.child('effectStyleLst');
  const effectStyles: SafeXmlNode[] = effectStyleLst.allChildren();

  return { colorScheme, majorFont, minorFont, fillStyles, bgFillStyles, lineStyles, effectStyles };
}

// Derived from @aiden0z/pptx-renderer 1.4.0 test helpers (Apache-2.0); modified for Blok.
/**
 * Test helper — convenient XML node creation for unit tests.
 */

import { parseXml, type SafeXmlNode } from '../../../../../../src/tools/file/pptx/parser/XmlParser';

/**
 * Parse a raw XML fragment into a SafeXmlNode.
 * Wraps with a default OOXML namespace for convenience.
 */
export function xmlNode(xml: string): SafeXmlNode {
  // If the XML already has xmlns, parse directly
  if (xml.includes('xmlns')) {
    return parseXml(xml);
  }
  // Otherwise wrap in a root with the DrawingML namespace
  const wrapped = xml.replace(
    /^<(\w+)/,
    '<$1 xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"',
  );
  return parseXml(wrapped);
}
